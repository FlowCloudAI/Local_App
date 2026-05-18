use super::*;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
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

#[derive(Debug, Clone, Default)]
pub(super) struct ImportIdMaps {
    pub projects: HashMap<String, String>,
    pub categories: HashMap<String, String>,
    pub tag_schemas: HashMap<String, String>,
    pub entry_types: HashMap<String, String>,
    pub entries: HashMap<String, String>,
    pub entry_relations: HashMap<String, String>,
    pub entry_links: HashMap<String, String>,
    pub idea_notes: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub(super) struct PreparedImportAsset {
    pub package_path: String,
    pub target_path: PathBuf,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub(super) struct PreparedFcworldImport {
    pub new_project_id: Uuid,
    pub project_name: String,
    pub csv_items: Vec<worldflow_core::CsvImportItem>,
    pub assets: Vec<PreparedImportAsset>,
    pub maps_json: String,
    pub asset_count: usize,
    pub map_count: usize,
    pub input_file_size: u64,
    pub warnings: Vec<String>,
    pub id_maps: ImportIdMaps,
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

fn new_uuid_string() -> String {
    Uuid::new_v4().to_string()
}

fn csv_item_content(
    items: &[worldflow_core::CsvImportItem],
    table: WorldflowCsvTable,
) -> Result<&str, String> {
    items
        .iter()
        .find(|item| item.table == table)
        .map(|item| item.content.as_str())
        .ok_or_else(|| format!("缺少 CSV 表: {:?}", table))
}

fn read_csv_rows(content: &str, context: &str) -> Result<Option<(StringRecord, Vec<Vec<String>>)>, String> {
    if content.trim().is_empty() {
        return Ok(None);
    }
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 {context} 表头失败: {e}"))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 {context} 记录失败: {e}"))?;
        rows.push(record.iter().map(|value| value.to_string()).collect());
    }
    Ok(Some((headers, rows)))
}

fn set_field(row: &mut [String], index: usize, value: String, context: &str) -> Result<(), String> {
    let field = row
        .get_mut(index)
        .ok_or_else(|| format!("{context} 记录字段数量不足"))?;
    *field = value;
    Ok(())
}

fn required_mapped_id(
    map: &HashMap<String, String>,
    old_id: &str,
    context: &str,
) -> Result<String, String> {
    map.get(old_id)
        .cloned()
        .ok_or_else(|| format!("{context} 引用了未导入的 ID: {old_id}"))
}

fn optional_mapped_id(
    map: &HashMap<String, String>,
    old_id: &str,
    context: &str,
) -> Result<String, String> {
    if old_id.trim().is_empty() {
        return Ok(String::new());
    }
    required_mapped_id(map, old_id, context)
}

fn collect_id_map(
    items: &[worldflow_core::CsvImportItem],
    table: WorldflowCsvTable,
) -> Result<HashMap<String, String>, String> {
    let content = csv_item_content(items, table)?;
    let Some((headers, rows)) = read_csv_rows(content, table.file_name())? else {
        return Ok(HashMap::new());
    };
    let id_index = header_index(&headers, "id")?;
    let mut map = HashMap::new();
    for row in rows {
        let old_id = row
            .get(id_index)
            .ok_or_else(|| format!("{} 记录缺少 id", table.file_name()))?
            .to_string();
        if old_id.trim().is_empty() {
            return Err(format!("{} 存在空 id", table.file_name()));
        }
        if map.insert(old_id.clone(), new_uuid_string()).is_some() {
            return Err(format!("{} 存在重复 id: {old_id}", table.file_name()));
        }
    }
    Ok(map)
}

fn collect_import_id_maps(
    package: &ValidatedFcworldPackage,
    new_project_id: Uuid,
) -> Result<ImportIdMaps, String> {
    let mut projects = collect_id_map(&package.csv_items, WorldflowCsvTable::Projects)?;
    if projects.len() != 1 {
        return Err(format!("projects.csv 必须包含 1 个项目，实际 {}", projects.len()));
    }
    if let Some(value) = projects.values_mut().next() {
        *value = new_project_id.to_string();
    }

    Ok(ImportIdMaps {
        projects,
        categories: collect_id_map(&package.csv_items, WorldflowCsvTable::Categories)?,
        tag_schemas: collect_id_map(&package.csv_items, WorldflowCsvTable::TagSchemas)?,
        entry_types: collect_id_map(&package.csv_items, WorldflowCsvTable::EntryTypes)?,
        entries: collect_id_map(&package.csv_items, WorldflowCsvTable::Entries)?,
        entry_relations: collect_id_map(&package.csv_items, WorldflowCsvTable::EntryRelations)?,
        entry_links: collect_id_map(&package.csv_items, WorldflowCsvTable::EntryLinks)?,
        idea_notes: collect_id_map(&package.csv_items, WorldflowCsvTable::IdeaNotes)?,
    })
}

fn unique_import_project_name(source_name: &str, existing_names: &[String]) -> String {
    let base = match source_name.trim() {
        "" => "导入世界",
        value => value,
    };
    let normalized_existing = existing_names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect::<HashSet<_>>();
    if !normalized_existing.contains(&base.to_lowercase()) {
        return base.to_string();
    }
    let mut index = 1usize;
    loop {
        let candidate = if index == 1 {
            format!("{base}（导入）")
        } else {
            format!("{base}（导入 {index}）")
        };
        if !normalized_existing.contains(&candidate.trim().to_lowercase()) {
            return candidate;
        }
        index += 1;
    }
}

fn sanitize_asset_file_stem(asset_id: &str) -> Result<String, String> {
    let stem = asset_id.trim();
    if stem.is_empty()
        || !stem
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("资源 ID 不能作为文件名: {asset_id}"));
    }
    Ok(stem.to_string())
}

fn imported_asset_file_name(asset: &FcworldAsset) -> Result<String, String> {
    let stem = sanitize_asset_file_stem(&asset.id)?;
    let extension = clean_extension_from_path(Path::new(&asset.path))
        .unwrap_or_else(|| extension_from_mime(&asset.mime).to_string());
    Ok(format!("{stem}.{extension}"))
}

fn import_images_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("images").join(project_id.to_string()))
}

fn prepare_import_assets(
    package: &ValidatedFcworldPackage,
    paths: &PathsState,
    project_id: &Uuid,
) -> Result<(Vec<PreparedImportAsset>, HashMap<String, PathBuf>), String> {
    let target_dir = import_images_dir(paths, project_id)?;
    let mut prepared = Vec::with_capacity(package.assets_index.assets.len());
    let mut by_package_path = HashMap::new();

    for asset in &package.assets_index.assets {
        let bytes = package
            .asset_bytes_by_path
            .get(&asset.path)
            .cloned()
            .ok_or_else(|| format!("资源内容缺失: {}", asset.path))?;
        let target_path = target_dir.join(imported_asset_file_name(asset)?);
        by_package_path.insert(asset.path.clone(), target_path.clone());
        prepared.push(PreparedImportAsset {
            package_path: asset.path.clone(),
            target_path,
            bytes,
        });
    }

    Ok((prepared, by_package_path))
}

fn target_path_for_package_asset(
    asset_targets: &HashMap<String, PathBuf>,
    package_path: &str,
    context: &str,
) -> Result<String, String> {
    asset_targets
        .get(package_path)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| format!("{context} 引用了未登记资源: {package_path}"))
}

fn rewrite_csv_asset_opt_string(
    raw: &str,
    asset_targets: &HashMap<String, PathBuf>,
    context: &str,
) -> Result<String, String> {
    let value = decode_csv_opt_string(raw)?;
    let Some(path) = value.filter(|path| !path.trim().is_empty()) else {
        return encode_csv_opt_string(None);
    };
    let target = target_path_for_package_asset(asset_targets, &path, context)?;
    encode_csv_opt_string(Some(&target))
}

fn rewrite_entry_images_json_for_import(
    raw: &str,
    entry_id: &str,
    asset_targets: &HashMap<String, PathBuf>,
) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Ok(raw.to_string());
    }
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.images JSON 失败 entry_id={entry_id}: {e}"))?;
    let images = value
        .as_array_mut()
        .ok_or_else(|| format!("entries.images 不是数组 entry_id={entry_id}"))?;
    for image in images {
        let Some(object) = image.as_object_mut() else {
            continue;
        };
        let Some(path) = object.get("path").and_then(Value::as_str) else {
            continue;
        };
        if path.trim().is_empty() {
            continue;
        }
        let target =
            target_path_for_package_asset(asset_targets, path, "entries.images")?;
        object.insert("path".to_string(), Value::String(target));
    }
    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.images JSON 失败 entry_id={entry_id}: {e}"))
}

fn rewrite_entry_tags_json(raw: &str, id_maps: &ImportIdMaps, entry_id: &str) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Ok(raw.to_string());
    }
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.tags JSON 失败 entry_id={entry_id}: {e}"))?;
    let tags = value
        .as_array_mut()
        .ok_or_else(|| format!("entries.tags 不是数组 entry_id={entry_id}"))?;
    for tag in tags {
        let Some(object) = tag.as_object_mut() else {
            continue;
        };
        let Some(schema_id) = object.get("schema_id").and_then(Value::as_str) else {
            continue;
        };
        let mapped = required_mapped_id(&id_maps.tag_schemas, schema_id, "entries.tags.schema_id")?;
        object.insert("schema_id".to_string(), Value::String(mapped));
    }
    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.tags JSON 失败 entry_id={entry_id}: {e}"))
}

fn is_entry_href_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '%'
}

fn rewrite_entry_hrefs(content: &str, entry_map: &HashMap<String, String>) -> Result<String, String> {
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find("entry://") {
        let prefix_start = cursor + offset;
        let value_start = prefix_start + "entry://".len();
        output.push_str(&content[cursor..value_start]);

        let mut value_end = value_start;
        for (relative, ch) in content[value_start..].char_indices() {
            if is_entry_href_char(ch) {
                value_end = value_start + relative + ch.len_utf8();
            } else {
                break;
            }
        }

        if value_end == value_start {
            cursor = value_start;
            continue;
        }

        let encoded = &content[value_start..value_end];
        let decoded = urlencoding::decode(encoded)
            .map_err(|e| format!("解析 entry:// 链接失败: {e}"))?
            .to_string();
        if Uuid::parse_str(&decoded).is_ok() {
            let mapped = required_mapped_id(entry_map, &decoded, "entries.content entry://")?;
            output.push_str(&mapped);
        } else {
            output.push_str(encoded);
        }
        cursor = value_end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

fn rewrite_projects_csv(
    content: &str,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
    existing_project_names: &[String],
) -> Result<(String, String), String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "projects.csv")? else {
        return Err("projects.csv 不能为空".to_string());
    };
    if rows.len() != 1 {
        return Err(format!("projects.csv 必须包含 1 行，实际 {}", rows.len()));
    }
    let id_index = header_index(&headers, "id")?;
    let name_index = header_index(&headers, "name")?;
    let cover_index = header_index(&headers, "cover_image")?;
    let row = rows
        .get_mut(0)
        .ok_or_else(|| "projects.csv 缺少项目记录".to_string())?;
    let old_project_id = row
        .get(id_index)
        .ok_or_else(|| "projects.csv 缺少 id".to_string())?
        .to_string();
    let new_project_id = required_mapped_id(&id_maps.projects, &old_project_id, "projects.id")?;
    let project_name = unique_import_project_name(
        row.get(name_index).map(String::as_str).unwrap_or_default(),
        existing_project_names,
    );
    let rewritten_cover =
        rewrite_csv_asset_opt_string(row.get(cover_index).map(String::as_str).unwrap_or_default(), asset_targets, "projects.cover_image")?;

    set_field(row, id_index, new_project_id, "projects.csv")?;
    set_field(row, name_index, project_name.clone(), "projects.csv")?;
    set_field(row, cover_index, rewritten_cover, "projects.csv")?;
    Ok((write_csv_records(&headers, &rows)?, project_name))
}

fn rewrite_simple_project_table(
    content: &str,
    table: WorldflowCsvTable,
    id_map: &HashMap<String, String>,
    id_maps: &ImportIdMaps,
) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, table.file_name())? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        set_field(row, id_index, required_mapped_id(id_map, &old_id, table.file_name())?, table.file_name())?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, table.file_name())?,
            table.file_name(),
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_categories_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "categories.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let parent_index = header_index(&headers, "parent_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_parent_id = row.get(parent_index).cloned().unwrap_or_default();
        set_field(row, id_index, required_mapped_id(&id_maps.categories, &old_id, "categories.id")?, "categories.csv")?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, "categories.project_id")?,
            "categories.csv",
        )?;
        set_field(
            row,
            parent_index,
            optional_mapped_id(&id_maps.categories, &old_parent_id, "categories.parent_id")?,
            "categories.csv",
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entries_csv_for_import(
    content: &str,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entries.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let category_index = header_index(&headers, "category_id")?;
    let content_index = header_index(&headers, "content")?;
    let tags_index = header_index(&headers, "tags")?;
    let images_index = header_index(&headers, "images")?;
    let cover_index = header_index(&headers, "cover_path")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_category_id = row.get(category_index).cloned().unwrap_or_default();
        let new_id = required_mapped_id(&id_maps.entries, &old_id, "entries.id")?;
        let rewritten_content = rewrite_entry_hrefs(
            row.get(content_index).map(String::as_str).unwrap_or_default(),
            &id_maps.entries,
        )?;
        let rewritten_tags = rewrite_entry_tags_json(
            row.get(tags_index).map(String::as_str).unwrap_or_default(),
            id_maps,
            &old_id,
        )?;
        let rewritten_images = rewrite_entry_images_json_for_import(
            row.get(images_index).map(String::as_str).unwrap_or_default(),
            &old_id,
            asset_targets,
        )?;
        let rewritten_cover = rewrite_csv_asset_opt_string(
            row.get(cover_index).map(String::as_str).unwrap_or_default(),
            asset_targets,
            "entries.cover_path",
        )?;

        set_field(row, id_index, new_id, "entries.csv")?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, "entries.project_id")?,
            "entries.csv",
        )?;
        set_field(
            row,
            category_index,
            optional_mapped_id(&id_maps.categories, &old_category_id, "entries.category_id")?,
            "entries.csv",
        )?;
        set_field(row, content_index, rewritten_content, "entries.csv")?;
        set_field(row, tags_index, rewritten_tags, "entries.csv")?;
        set_field(row, images_index, rewritten_images, "entries.csv")?;
        set_field(row, cover_index, rewritten_cover, "entries.csv")?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entry_relations_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entry_relations.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let a_index = header_index(&headers, "a_id")?;
    let b_index = header_index(&headers, "b_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_a_id = row.get(a_index).cloned().unwrap_or_default();
        let old_b_id = row.get(b_index).cloned().unwrap_or_default();
        set_field(row, id_index, required_mapped_id(&id_maps.entry_relations, &old_id, "entry_relations.id")?, "entry_relations.csv")?;
        set_field(row, project_index, required_mapped_id(&id_maps.projects, &old_project_id, "entry_relations.project_id")?, "entry_relations.csv")?;
        set_field(row, a_index, required_mapped_id(&id_maps.entries, &old_a_id, "entry_relations.a_id")?, "entry_relations.csv")?;
        set_field(row, b_index, required_mapped_id(&id_maps.entries, &old_b_id, "entry_relations.b_id")?, "entry_relations.csv")?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entry_links_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entry_links.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let a_index = header_index(&headers, "a_id")?;
    let b_index = header_index(&headers, "b_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_a_id = row.get(a_index).cloned().unwrap_or_default();
        let old_b_id = row.get(b_index).cloned().unwrap_or_default();
        set_field(row, id_index, required_mapped_id(&id_maps.entry_links, &old_id, "entry_links.id")?, "entry_links.csv")?;
        set_field(row, project_index, required_mapped_id(&id_maps.projects, &old_project_id, "entry_links.project_id")?, "entry_links.csv")?;
        set_field(row, a_index, required_mapped_id(&id_maps.entries, &old_a_id, "entry_links.a_id")?, "entry_links.csv")?;
        set_field(row, b_index, required_mapped_id(&id_maps.entries, &old_b_id, "entry_links.b_id")?, "entry_links.csv")?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_idea_notes_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "idea_notes.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let converted_index = header_index(&headers, "converted_entry_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_converted_id = row.get(converted_index).cloned().unwrap_or_default();
        set_field(row, id_index, required_mapped_id(&id_maps.idea_notes, &old_id, "idea_notes.id")?, "idea_notes.csv")?;
        set_field(
            row,
            project_index,
            optional_mapped_id(&id_maps.projects, &old_project_id, "idea_notes.project_id")?,
            "idea_notes.csv",
        )?;
        set_field(
            row,
            converted_index,
            optional_mapped_id(&id_maps.entries, &old_converted_id, "idea_notes.converted_entry_id")?,
            "idea_notes.csv",
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_csv_items_for_import(
    package: &ValidatedFcworldPackage,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
    existing_project_names: &[String],
) -> Result<(Vec<worldflow_core::CsvImportItem>, String), String> {
    let mut output = Vec::with_capacity(WorldflowCsvTable::ordered().len());
    let mut project_name = String::new();

    for table in WorldflowCsvTable::ordered().iter().copied() {
        let content = csv_item_content(&package.csv_items, table)?;
        let rewritten = match table {
            WorldflowCsvTable::Projects => {
                let (content, name) = rewrite_projects_csv(
                    content,
                    id_maps,
                    asset_targets,
                    existing_project_names,
                )?;
                project_name = name;
                content
            }
            WorldflowCsvTable::Categories => rewrite_categories_csv(content, id_maps)?,
            WorldflowCsvTable::TagSchemas => rewrite_simple_project_table(
                content,
                table,
                &id_maps.tag_schemas,
                id_maps,
            )?,
            WorldflowCsvTable::EntryTypes => rewrite_simple_project_table(
                content,
                table,
                &id_maps.entry_types,
                id_maps,
            )?,
            WorldflowCsvTable::Entries => {
                rewrite_entries_csv_for_import(content, id_maps, asset_targets)?
            }
            WorldflowCsvTable::EntryRelations => rewrite_entry_relations_csv(content, id_maps)?,
            WorldflowCsvTable::EntryLinks => rewrite_entry_links_csv(content, id_maps)?,
            WorldflowCsvTable::IdeaNotes => rewrite_idea_notes_csv(content, id_maps)?,
        };
        output.push(worldflow_core::CsvImportItem {
            table,
            file_name: table.file_name().to_string(),
            content: rewritten,
        });
    }

    Ok((output, project_name))
}

fn asset_data_url(asset: &FcworldAsset, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        asset.mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn asset_data_url_by_path(
    package: &ValidatedFcworldPackage,
    asset_by_path: &HashMap<String, FcworldAsset>,
    package_path: &str,
    context: &str,
) -> Result<String, String> {
    let asset = asset_by_path
        .get(package_path)
        .ok_or_else(|| format!("{context} 引用了未登记资源: {package_path}"))?;
    let bytes = package
        .asset_bytes_by_path
        .get(package_path)
        .ok_or_else(|| format!("{context} 资源内容缺失: {package_path}"))?;
    Ok(asset_data_url(asset, bytes))
}

fn rewrite_json_entry_refs(value: &mut Value, id_maps: &ImportIdMaps, strict_linked: bool) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                rewrite_json_entry_refs(item, id_maps, strict_linked)?;
            }
        }
        Value::Object(object) => {
            for (key, item) in object.iter_mut() {
                if matches!(key.as_str(), "linkedEntryId" | "entryId" | "bizId") {
                    if let Some(old_id) = item.as_str().map(|value| value.to_string()) {
                        if Uuid::parse_str(&old_id).is_ok() {
                            if let Some(new_id) = id_maps.entries.get(&old_id) {
                                *item = Value::String(new_id.clone());
                                continue;
                            }
                            if strict_linked && key != "bizId" {
                                return Err(format!("地图 {key} 引用了未导入的词条: {old_id}"));
                            }
                        }
                    }
                }
                rewrite_json_entry_refs(item, id_maps, strict_linked)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn rewrite_scene_background(
    scene: &mut Value,
    package: &ValidatedFcworldPackage,
    asset_by_path: &HashMap<String, FcworldAsset>,
) -> Result<(), String> {
    let Some(url_value) = scene.pointer_mut("/backgroundImage/url") else {
        return Ok(());
    };
    let Some(package_path) = url_value.as_str().map(|value| value.to_string()) else {
        return Ok(());
    };
    if package_path.starts_with("assets/images/") {
        *url_value = Value::String(asset_data_url_by_path(
            package,
            asset_by_path,
            &package_path,
            "sceneJson.backgroundImage.url",
        )?);
    }
    Ok(())
}

fn rewrite_maps_json_for_import(
    package: &ValidatedFcworldPackage,
    id_maps: &ImportIdMaps,
    new_project_id: &Uuid,
) -> Result<(String, usize), String> {
    let mut value = serde_json::from_str::<Value>(&package.maps_json)
        .map_err(|e| format!("解析 maps/maps.json 失败: {e}"))?;
    let asset_by_path = package
        .assets_index
        .assets
        .iter()
        .cloned()
        .map(|asset| (asset.path.clone(), asset))
        .collect::<HashMap<_, _>>();

    if let Some(object) = value.as_object_mut() {
        object.insert(
            "projectId".to_string(),
            Value::String(new_project_id.to_string()),
        );
    }

    let maps = value
        .get_mut("maps")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "maps/maps.json 缺少 maps 数组".to_string())?;
    let map_count = maps.len();

    for map in maps {
        let Some(object) = map.as_object_mut() else {
            continue;
        };
        if let Some(background_value) = object.get_mut("backgroundImageUrl") {
            if let Some(package_path) = background_value.as_str().map(|value| value.to_string()) {
                if package_path.starts_with("assets/images/") {
                    *background_value = Value::String(asset_data_url_by_path(
                        package,
                        &asset_by_path,
                        &package_path,
                        "backgroundImageUrl",
                    )?);
                }
            }
        }

        if let Some(draft_value) = object.get_mut("draftJson") {
            if let Some(draft_json) = draft_value.as_str().map(|value| value.to_string()) {
                if !draft_json.trim().is_empty() {
                    let mut draft = serde_json::from_str::<Value>(&draft_json)
                        .map_err(|e| format!("解析地图 draftJson 失败: {e}"))?;
                    rewrite_json_entry_refs(&mut draft, id_maps, true)?;
                    *draft_value = Value::String(
                        serde_json::to_string(&draft)
                            .map_err(|e| format!("序列化地图 draftJson 失败: {e}"))?,
                    );
                }
            }
        }

        if let Some(scene_value) = object.get_mut("sceneJson") {
            if let Some(scene_json) = scene_value.as_str().map(|value| value.to_string()) {
                if !scene_json.trim().is_empty() {
                    let mut scene = serde_json::from_str::<Value>(&scene_json)
                        .map_err(|e| format!("解析地图 sceneJson 失败: {e}"))?;
                    rewrite_scene_background(&mut scene, package, &asset_by_path)?;
                    rewrite_json_entry_refs(&mut scene, id_maps, true)?;
                    *scene_value = Value::String(
                        serde_json::to_string(&scene)
                            .map_err(|e| format!("序列化地图 sceneJson 失败: {e}"))?,
                    );
                }
            }
        }
    }

    serde_json::to_string_pretty(&value)
        .map(|content| (content, map_count))
        .map_err(|e| format!("序列化导入地图数据失败: {e}"))
}

pub(super) fn prepare_fcworld_import(
    package: ValidatedFcworldPackage,
    paths: &PathsState,
    existing_project_names: &[String],
) -> Result<PreparedFcworldImport, String> {
    let new_project_id = Uuid::new_v4();
    let id_maps = collect_import_id_maps(&package, new_project_id)?;
    let (assets, asset_targets) = prepare_import_assets(&package, paths, &new_project_id)?;
    let (csv_items, project_name) = rewrite_csv_items_for_import(
        &package,
        &id_maps,
        &asset_targets,
        existing_project_names,
    )?;
    let (maps_json, map_count) = rewrite_maps_json_for_import(&package, &id_maps, &new_project_id)?;

    Ok(PreparedFcworldImport {
        new_project_id,
        project_name,
        csv_items,
        assets,
        maps_json,
        asset_count: package.assets_index.assets.len(),
        map_count,
        input_file_size: package.input_file_size,
        warnings: Vec::new(),
        id_maps,
    })
}
