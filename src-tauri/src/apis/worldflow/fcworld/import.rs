use super::*;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

const KNOWN_ASSET_KINDS: &[&str] = &[
    "project_cover",
    "entry_image",
    "entry_cover",
    "map_background",
];

#[derive(Debug, Clone)]
pub(super) struct ValidatedFcworldPackage {
    pub manifest: FcworldManifest,
    pub csv_items: Vec<worldflow_core::CsvImportItem>,
    pub assets_index: FcworldAssetsIndex,
    pub asset_bytes_by_path: HashMap<String, Vec<u8>>,
    pub maps_json: String,
    pub input_file_size: u64,
}

fn validate_package_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("包内路径不能为空".to_string());
    }
    if path.contains('\\') {
        return Err(format!("包内路径不能包含反斜杠: {path}"));
    }
    if path.starts_with('/') || path.contains(':') {
        return Err(format!("包内路径不能是绝对路径: {path}"));
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("包内路径包含非法片段: {path}"));
    }
    Ok(())
}

fn validate_known_zip_entries(zip: &mut ZipArchive<File>) -> Result<HashSet<String>, String> {
    let mut names = HashSet::new();
    for index in 0..zip.len() {
        let file = zip
            .by_index(index)
            .map_err(|e| format!("读取 zip 文件项失败: {e}"))?;
        let name = file.name().to_string();
        validate_package_path(&name)?;
        if !names.insert(name.clone()) {
            return Err(format!("zip 包含重复文件项: {name}"));
        }
        let known = name == "manifest.json"
            || name == ASSETS_INDEX_PATH
            || name == MAPS_PATH
            || name
                .strip_prefix(WORLD_DATA_DIR)
                .map(|file_name| {
                    WorldflowCsvTable::ordered()
                        .iter()
                        .any(|table| table.file_name() == file_name)
                })
                .unwrap_or(false)
            || name.starts_with("assets/images/");
        if !known {
            return Err(format!("zip 包含未知文件项: {name}"));
        }
    }
    Ok(names)
}

fn read_zip_bytes(zip: &mut ZipArchive<File>, path: &str) -> Result<Vec<u8>, String> {
    let mut file = zip
        .by_name(path)
        .map_err(|e| format!("zip 缺少文件项 {path}: {e}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("读取 zip 文件项失败 {path}: {e}"))?;
    Ok(bytes)
}

fn read_zip_text(zip: &mut ZipArchive<File>, path: &str) -> Result<String, String> {
    let bytes = read_zip_bytes(zip, path)?;
    String::from_utf8(bytes).map_err(|e| format!("zip 文件项不是 UTF-8 {path}: {e}"))
}

fn table_from_name(name: &str) -> Option<WorldflowCsvTable> {
    WorldflowCsvTable::ordered()
        .iter()
        .copied()
        .find(|table| table_name(*table) == name)
}

fn csv_data_row_count(table: WorldflowCsvTable, content: &str) -> Result<usize, String> {
    if content.trim().is_empty() {
        return Ok(0);
    }

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let mut count = 0usize;
    for record in reader.records() {
        record.map_err(|e| format!("解析 {} 失败: {e}", table.file_name()))?;
        count += 1;
    }
    Ok(count)
}

fn validate_manifest(
    manifest_json: &str,
    current_schema_version: u32,
) -> Result<FcworldManifest, String> {
    let manifest = serde_json::from_str::<FcworldManifest>(manifest_json)
        .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
    if manifest.format != FCWORLD_FORMAT {
        return Err(format!("不支持的 fcworld 格式: {}", manifest.format));
    }
    if manifest.format_version != FCWORLD_FORMAT_VERSION {
        return Err(format!(
            "不支持的 fcworld 版本: {}",
            manifest.format_version
        ));
    }
    if manifest.generator.worldflow_schema_version != current_schema_version {
        return Err(format!(
            "worldflow schema 版本不匹配: 包内 {}，当前 {}",
            manifest.generator.worldflow_schema_version, current_schema_version
        ));
    }
    if manifest.contents.worldflow.schema_version != current_schema_version {
        return Err(format!(
            "CSV schema 版本不匹配: 包内 {}，当前 {}",
            manifest.contents.worldflow.schema_version, current_schema_version
        ));
    }
    if manifest.contents.worldflow.path != WORLD_DATA_DIR {
        return Err(format!(
            "worldflow 数据目录不匹配: {}",
            manifest.contents.worldflow.path
        ));
    }
    if manifest.contents.assets_index.path != ASSETS_INDEX_PATH {
        return Err(format!(
            "资源索引路径不匹配: {}",
            manifest.contents.assets_index.path
        ));
    }
    if manifest.contents.maps.path != MAPS_PATH {
        return Err(format!("地图路径不匹配: {}", manifest.contents.maps.path));
    }
    if manifest.contents.worldflow.tables.len() != WorldflowCsvTable::ordered().len() {
        return Err("CSV 表数量不匹配".to_string());
    }
    Ok(manifest)
}

fn validate_csv_items(
    zip: &mut ZipArchive<File>,
    manifest: &FcworldManifest,
) -> Result<Vec<worldflow_core::CsvImportItem>, String> {
    let mut items = Vec::with_capacity(WorldflowCsvTable::ordered().len());
    for (index, expected_table) in WorldflowCsvTable::ordered().iter().copied().enumerate() {
        let table_manifest = manifest
            .contents
            .worldflow
            .tables
            .get(index)
            .ok_or_else(|| format!("manifest 缺少 CSV 表索引: {index}"))?;
        let table = table_from_name(&table_manifest.name)
            .ok_or_else(|| format!("manifest 包含未知 CSV 表: {}", table_manifest.name))?;
        if table != expected_table {
            return Err(format!(
                "CSV 表顺序不匹配: 第 {} 项为 {}",
                index + 1,
                table_manifest.name
            ));
        }
        let expected_path = format!("{WORLD_DATA_DIR}{}", expected_table.file_name());
        if table_manifest.path != expected_path {
            return Err(format!(
                "CSV 路径不匹配: {} 应为 {}",
                table_manifest.path, expected_path
            ));
        }

        let content = read_zip_text(zip, &expected_path)?;
        let sha256 = sha256_hex(content.as_bytes());
        if sha256 != table_manifest.sha256 {
            return Err(format!("CSV 摘要不匹配: {expected_path}"));
        }
        let row_count = csv_data_row_count(expected_table, &content)?;
        if row_count != table_manifest.row_count {
            return Err(format!(
                "CSV 行数不匹配: {expected_path} manifest={} actual={row_count}",
                table_manifest.row_count
            ));
        }
        items.push(worldflow_core::CsvImportItem {
            table: expected_table,
            file_name: expected_table.file_name().to_string(),
            content,
        });
    }
    Ok(items)
}

fn validate_assets_index(
    zip: &mut ZipArchive<File>,
    zip_names: &HashSet<String>,
    manifest: &FcworldManifest,
) -> Result<(FcworldAssetsIndex, HashMap<String, Vec<u8>>), String> {
    let assets_index_json = read_zip_text(zip, ASSETS_INDEX_PATH)?;
    let assets_sha = sha256_hex(assets_index_json.as_bytes());
    if assets_sha != manifest.contents.assets_index.sha256 {
        return Err("assets/index.json 摘要不匹配".to_string());
    }
    let assets_index = serde_json::from_str::<FcworldAssetsIndex>(&assets_index_json)
        .map_err(|e| format!("解析 assets/index.json 失败: {e}"))?;
    if assets_index.version != 1 {
        return Err(format!("不支持的资源索引版本: {}", assets_index.version));
    }
    if assets_index.assets.len() != manifest.contents.assets_index.count {
        return Err(format!(
            "资源数量不匹配: manifest={} actual={}",
            manifest.contents.assets_index.count,
            assets_index.assets.len()
        ));
    }

    let mut asset_ids = HashSet::new();
    let mut asset_paths = HashSet::new();
    let mut bytes_by_path = HashMap::new();

    for asset in &assets_index.assets {
        if !asset_ids.insert(asset.id.clone()) {
            return Err(format!("资源 ID 重复: {}", asset.id));
        }
        if !KNOWN_ASSET_KINDS.contains(&asset.kind.as_str()) {
            return Err(format!("未知资源类型: {}", asset.kind));
        }
        validate_package_path(&asset.path)?;
        if !asset.path.starts_with("assets/images/") {
            return Err(format!("资源路径必须位于 assets/images/: {}", asset.path));
        }
        if !asset_paths.insert(asset.path.clone()) {
            return Err(format!("资源路径重复: {}", asset.path));
        }

        let bytes = read_zip_bytes(zip, &asset.path)?;
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if size != asset.size {
            return Err(format!("资源大小不匹配: {}", asset.path));
        }
        let sha256 = sha256_hex(&bytes);
        if sha256 != asset.sha256 {
            return Err(format!("资源摘要不匹配: {}", asset.path));
        }
        let guessed_mime = mime_guess::from_path(&asset.path)
            .first_or_octet_stream()
            .to_string();
        if guessed_mime != asset.mime {
            return Err(format!(
                "资源 MIME 不匹配: {} manifest={} actual={guessed_mime}",
                asset.path, asset.mime
            ));
        }
        let (width, height) = image_dimensions(&bytes)?;
        if asset.width != Some(width) || asset.height != Some(height) {
            return Err(format!("资源尺寸不匹配: {}", asset.path));
        }
        bytes_by_path.insert(asset.path.clone(), bytes);
    }

    for name in zip_names
        .iter()
        .filter(|name| name.starts_with("assets/images/"))
    {
        if !asset_paths.contains(name) {
            return Err(format!("zip 包含未登记资源: {name}"));
        }
    }

    Ok((assets_index, bytes_by_path))
}

fn validate_maps_json(zip: &mut ZipArchive<File>, manifest: &FcworldManifest) -> Result<String, String> {
    let maps_json = read_zip_text(zip, MAPS_PATH)?;
    let maps_sha = sha256_hex(maps_json.as_bytes());
    if maps_sha != manifest.contents.maps.sha256 {
        return Err("maps/maps.json 摘要不匹配".to_string());
    }
    let maps_value = serde_json::from_str::<Value>(&maps_json)
        .map_err(|e| format!("解析 maps/maps.json 失败: {e}"))?;
    let maps = maps_value
        .get("maps")
        .and_then(Value::as_array)
        .ok_or_else(|| "maps/maps.json 缺少 maps 数组".to_string())?;
    if maps.len() != manifest.contents.maps.count {
        return Err(format!(
            "地图数量不匹配: manifest={} actual={}",
            manifest.contents.maps.count,
            maps.len()
        ));
    }
    Ok(maps_json)
}

pub(super) fn read_and_validate_fcworld_package(
    input_path: &Path,
    current_schema_version: u32,
) -> Result<ValidatedFcworldPackage, String> {
    if !input_path.exists() {
        return Err(format!("导入文件不存在: {:?}", input_path));
    }
    if !input_path.is_file() {
        return Err(format!("导入路径不是文件: {:?}", input_path));
    }

    let input_file_size = std::fs::metadata(input_path)
        .map_err(|e| format!("读取导入文件信息失败 {:?}: {e}", input_path))?
        .len();
    let file = File::open(input_path).map_err(|e| format!("打开导入文件失败 {:?}: {e}", input_path))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("读取 fcworld zip 失败: {e}"))?;
    let zip_names = validate_known_zip_entries(&mut zip)?;

    let manifest_json = read_zip_text(&mut zip, "manifest.json")?;
    let manifest = validate_manifest(&manifest_json, current_schema_version)?;
    let csv_items = validate_csv_items(&mut zip, &manifest)?;
    let (assets_index, asset_bytes_by_path) =
        validate_assets_index(&mut zip, &zip_names, &manifest)?;
    let maps_json = validate_maps_json(&mut zip, &manifest)?;

    Ok(ValidatedFcworldPackage {
        manifest,
        csv_items,
        assets_index,
        asset_bytes_by_path,
        maps_json,
        input_file_size,
    })
}
