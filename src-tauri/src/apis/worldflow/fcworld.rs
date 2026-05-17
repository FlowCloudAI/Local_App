use super::common::*;
use base64::Engine;
use csv::StringRecord;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use zip::{ZipWriter, write::SimpleFileOptions};

use worldflow_core::{
    CsvExportItem, ProjectCsvExport, ProjectOps, WorldflowCsvTable, models::Project,
};

const FCWORLD_FORMAT: &str = "com.flowcloudai.fcworld";
const FCWORLD_FORMAT_VERSION: u32 = 1;
const WORLD_DATA_DIR: &str = "data/worldflow/";
const ASSETS_INDEX_PATH: &str = "assets/index.json";
const MAPS_PATH: &str = "maps/maps.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldExportResult {
    pub output_path: String,
    pub package_id: String,
    pub project_id: String,
    pub asset_count: usize,
    pub map_count: usize,
    pub file_size: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FcworldAssetSource {
    entity_type: String,
    entity_id: String,
    field: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FcworldAsset {
    id: String,
    kind: String,
    path: String,
    mime: String,
    size: u64,
    sha256: String,
    width: Option<u32>,
    height: Option<u32>,
    original_name: Option<String>,
    source: FcworldAssetSource,
}

#[derive(Debug, Clone, Serialize)]
struct FcworldAssetsIndex {
    version: u32,
    assets: Vec<FcworldAsset>,
}

#[derive(Debug, Clone)]
struct PackageAssetBytes {
    path: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
struct AssetRef {
    id: String,
    path: String,
}

#[derive(Debug, Default)]
struct AssetCollector {
    next_index: usize,
    index_assets: Vec<FcworldAsset>,
    zip_assets: Vec<PackageAssetBytes>,
}

#[derive(Debug)]
struct PreparedFcworldPackage {
    package_id: String,
    project_id: Uuid,
    csv_items: Vec<CsvExportItem>,
    assets_index_json: String,
    manifest_json: String,
    maps_json: String,
    assets: Vec<PackageAssetBytes>,
    asset_count: usize,
    map_count: usize,
    warnings: Vec<String>,
}

#[derive(Debug)]
struct CsvRewriteOutput {
    item: CsvExportItem,
    project_cover_asset_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FcworldManifest {
    format: String,
    format_version: u32,
    package_id: String,
    created_at: String,
    generator: ManifestGenerator,
    compatibility: ManifestCompatibility,
    world: ManifestWorld,
    contents: ManifestContents,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestGenerator {
    app: String,
    app_version: String,
    platform: String,
    worldflow_schema_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCompatibility {
    min_app_version: String,
    features: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestWorld {
    source_project_id: String,
    name: String,
    description: Option<String>,
    cover_asset_id: Option<String>,
    created_at: String,
    updated_at: String,
    language: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestContents {
    worldflow: ManifestWorldflowContents,
    assets_index: ManifestFile,
    maps: ManifestFile,
    counts: ManifestCounts,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestWorldflowContents {
    path: String,
    schema_version: u32,
    tables: Vec<ManifestCsvTable>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCsvTable {
    name: String,
    path: String,
    row_count: usize,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    path: String,
    count: usize,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCounts {
    categories: usize,
    entries: usize,
    tag_schemas: usize,
    entry_types: usize,
    relations: usize,
    entry_links: usize,
    idea_notes: usize,
    images: usize,
    maps: usize,
}

impl AssetCollector {
    fn add_file_asset(
        &mut self,
        source_path: &Path,
        kind: &str,
        entity_type: &str,
        entity_id: &str,
        field: &str,
    ) -> Result<AssetRef, String> {
        if source_path.as_os_str().is_empty() {
            return Err("图片路径为空，无法导出资源".to_string());
        }
        if !source_path.exists() {
            return Err(format!("导出资源不存在: {:?}", source_path));
        }
        if !source_path.is_file() {
            return Err(format!("导出资源不是文件: {:?}", source_path));
        }

        let bytes = std::fs::read(source_path)
            .map_err(|e| format!("读取导出资源失败 {:?}: {}", source_path, e))?;
        let mime = mime_guess::from_path(source_path)
            .first_or_octet_stream()
            .to_string();
        let original_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string());
        let extension = clean_extension_from_path(source_path)
            .unwrap_or_else(|| extension_from_mime(&mime).to_string());

        self.add_asset_bytes(
            bytes,
            &mime,
            Some(extension),
            original_name,
            kind,
            FcworldAssetSource {
                entity_type: entity_type.to_string(),
                entity_id: entity_id.to_string(),
                field: field.to_string(),
            },
        )
    }

    fn add_data_url_asset(
        &mut self,
        data_url: &str,
        kind: &str,
        entity_type: &str,
        entity_id: &str,
        field: &str,
    ) -> Result<AssetRef, String> {
        let (mime, bytes) = decode_data_url(data_url)?;
        let extension = extension_from_mime(&mime).to_string();
        self.add_asset_bytes(
            bytes,
            &mime,
            Some(extension),
            None,
            kind,
            FcworldAssetSource {
                entity_type: entity_type.to_string(),
                entity_id: entity_id.to_string(),
                field: field.to_string(),
            },
        )
    }

    fn add_asset_bytes(
        &mut self,
        bytes: Vec<u8>,
        mime: &str,
        extension: Option<String>,
        original_name: Option<String>,
        kind: &str,
        source: FcworldAssetSource,
    ) -> Result<AssetRef, String> {
        let (width, height) = image_dimensions(&bytes)?;
        self.next_index += 1;
        let asset_id = format!("asset-{:06}", self.next_index);
        let file_name = match extension.filter(|value| !value.is_empty()) {
            Some(ext) => format!("{asset_id}.{ext}"),
            None => asset_id.clone(),
        };
        let package_path = format!("assets/images/{file_name}");
        let sha256 = sha256_hex(&bytes);
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);

        self.index_assets.push(FcworldAsset {
            id: asset_id.clone(),
            kind: kind.to_string(),
            path: package_path.clone(),
            mime: mime.to_string(),
            size,
            sha256,
            width: Some(width),
            height: Some(height),
            original_name,
            source,
        });
        self.zip_assets.push(PackageAssetBytes {
            path: package_path.clone(),
            bytes,
        });

        Ok(AssetRef {
            id: asset_id,
            path: package_path,
        })
    }

    fn into_parts(self) -> (Vec<FcworldAsset>, Vec<PackageAssetBytes>) {
        (self.index_assets, self.zip_assets)
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let image = image::load_from_memory(bytes).map_err(|e| format!("读取图片尺寸失败: {}", e))?;
    Ok((image.width(), image.height()))
}

fn clean_extension_from_path(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.trim().to_ascii_lowercase();
    if ext.is_empty()
        || ext.len() > 12
        || !ext
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return None;
    }
    Some(ext)
}

fn extension_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "bin",
    }
}

fn is_data_url(value: &str) -> bool {
    value
        .get(..5)
        .map(|prefix| prefix.eq_ignore_ascii_case("data:"))
        .unwrap_or(false)
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let rest = data_url
        .get(5..)
        .ok_or_else(|| "无效的 data URL".to_string())?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| "data URL 缺少逗号分隔符".to_string())?;
    let mut parts = meta.split(';');
    let mime = parts
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();
    let is_base64 = parts.any(|part| part.eq_ignore_ascii_case("base64"));
    if !is_base64 {
        return Err("当前仅支持 base64 data URL 资源导出".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|e| format!("解析 data URL 失败: {}", e))?;
    Ok((mime, bytes))
}

fn table_name(table: WorldflowCsvTable) -> &'static str {
    match table {
        WorldflowCsvTable::Projects => "projects",
        WorldflowCsvTable::Categories => "categories",
        WorldflowCsvTable::TagSchemas => "tag_schemas",
        WorldflowCsvTable::EntryTypes => "entry_types",
        WorldflowCsvTable::Entries => "entries",
        WorldflowCsvTable::EntryRelations => "entry_relations",
        WorldflowCsvTable::EntryLinks => "entry_links",
        WorldflowCsvTable::IdeaNotes => "idea_notes",
    }
}

fn rebuild_csv_item(item: CsvExportItem, content: String, row_count: usize) -> CsvExportItem {
    CsvExportItem {
        table: item.table,
        file_name: item.file_name,
        row_count,
        sha256: sha256_hex(content.as_bytes()),
        content,
    }
}

fn decode_csv_opt_string(raw: &str) -> Result<Option<String>, String> {
    let trimmed = raw.trim();
    if trimmed == "null" || trimmed.starts_with('"') {
        return serde_json::from_str::<Option<String>>(trimmed)
            .map_err(|e| format!("解析 CSV 可空字符串失败: {}", e));
    }
    if raw.is_empty() {
        Ok(None)
    } else {
        Ok(Some(raw.to_string()))
    }
}

fn encode_csv_opt_string(value: Option<&str>) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化 CSV 可空字符串失败: {}", e))
}

fn header_index(headers: &StringRecord, name: &str) -> Result<usize, String> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or_else(|| format!("CSV 缺少字段: {name}"))
}

fn write_csv_records(headers: &StringRecord, rows: &[Vec<String>]) -> Result<String, String> {
    let mut writer = csv::Writer::from_writer(Vec::<u8>::new());
    writer
        .write_record(headers.iter())
        .map_err(|e| format!("写入 CSV 表头失败: {}", e))?;
    for row in rows {
        writer
            .write_record(row)
            .map_err(|e| format!("写入 CSV 记录失败: {}", e))?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|e| format!("生成 CSV 内容失败: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("CSV 内容不是 UTF-8: {}", e))
}

fn rewrite_project_csv(
    item: CsvExportItem,
    collector: &mut AssetCollector,
) -> Result<CsvRewriteOutput, String> {
    if item.row_count == 0 || item.content.trim().is_empty() {
        return Ok(CsvRewriteOutput {
            item,
            project_cover_asset_id: None,
        });
    }

    let mut reader = csv::Reader::from_reader(item.content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 projects.csv 表头失败: {}", e))?
        .clone();
    let id_index = header_index(&headers, "id")?;
    let cover_index = header_index(&headers, "cover_image")?;
    let mut rows = Vec::new();
    let mut cover_asset_id = None;

    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 projects.csv 记录失败: {}", e))?;
        let mut fields = record
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let project_id = fields.get(id_index).cloned().unwrap_or_default();
        let cover_path = fields
            .get(cover_index)
            .map(|value| decode_csv_opt_string(value))
            .transpose()?
            .flatten();

        if let Some(path) = cover_path.filter(|value| !value.trim().is_empty()) {
            let asset = collector.add_file_asset(
                Path::new(&path),
                "project_cover",
                "project",
                &project_id,
                "cover_image",
            )?;
            fields[cover_index] = encode_csv_opt_string(Some(&asset.path))?;
            cover_asset_id = Some(asset.id);
        }
        rows.push(fields);
    }

    let row_count = rows.len();
    let content = write_csv_records(&headers, &rows)?;
    Ok(CsvRewriteOutput {
        item: rebuild_csv_item(item, content, row_count),
        project_cover_asset_id: cover_asset_id,
    })
}

fn rewrite_entry_images_json(
    raw: &str,
    entry_id: &str,
    collector: &mut AssetCollector,
) -> Result<String, String> {
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.images JSON 失败 entry_id={entry_id}: {e}"))?;
    let images = value
        .as_array_mut()
        .ok_or_else(|| format!("entries.images 不是数组 entry_id={entry_id}"))?;

    for image in images {
        let Some(object) = image.as_object_mut() else {
            continue;
        };
        let path = object
            .get("path")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
            continue;
        };

        let asset =
            collector.add_file_asset(Path::new(&path), "entry_image", "entry", entry_id, "images")?;
        object.insert("path".to_string(), Value::String(asset.path));
    }

    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.images JSON 失败 entry_id={entry_id}: {e}"))
}

fn rewrite_entries_csv(
    item: CsvExportItem,
    collector: &mut AssetCollector,
) -> Result<CsvRewriteOutput, String> {
    if item.row_count == 0 || item.content.trim().is_empty() {
        return Ok(CsvRewriteOutput {
            item,
            project_cover_asset_id: None,
        });
    }

    let mut reader = csv::Reader::from_reader(item.content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 entries.csv 表头失败: {}", e))?
        .clone();
    let id_index = header_index(&headers, "id")?;
    let images_index = header_index(&headers, "images")?;
    let cover_index = header_index(&headers, "cover_path")?;
    let mut rows = Vec::new();

    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 entries.csv 记录失败: {}", e))?;
        let mut fields = record
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let entry_id = fields.get(id_index).cloned().unwrap_or_default();

        if let Some(images) = fields.get(images_index).cloned() {
            fields[images_index] = rewrite_entry_images_json(&images, &entry_id, collector)?;
        }

        let cover_path = fields
            .get(cover_index)
            .map(|value| decode_csv_opt_string(value))
            .transpose()?
            .flatten();
        if let Some(path) = cover_path.filter(|value| !value.trim().is_empty()) {
            let asset = collector.add_file_asset(
                Path::new(&path),
                "entry_cover",
                "entry",
                &entry_id,
                "cover_path",
            )?;
            fields[cover_index] = encode_csv_opt_string(Some(&asset.path))?;
        }

        rows.push(fields);
    }

    let row_count = rows.len();
    let content = write_csv_records(&headers, &rows)?;
    Ok(CsvRewriteOutput {
        item: rebuild_csv_item(item, content, row_count),
        project_cover_asset_id: None,
    })
}

fn rewrite_csv_items(
    export: ProjectCsvExport,
    collector: &mut AssetCollector,
) -> Result<(Vec<CsvExportItem>, Option<String>), String> {
    let mut items = Vec::with_capacity(export.items.len());
    let mut cover_asset_id = None;

    for item in export.items {
        let output = match item.table {
            WorldflowCsvTable::Projects => rewrite_project_csv(item, collector)?,
            WorldflowCsvTable::Entries => rewrite_entries_csv(item, collector)?,
            _ => CsvRewriteOutput {
                item,
                project_cover_asset_id: None,
            },
        };
        if output.project_cover_asset_id.is_some() {
            cover_asset_id = output.project_cover_asset_id.clone();
        }
        items.push(output.item);
    }

    Ok((items, cover_asset_id))
}

fn safe_project_id(project_id: &Uuid) -> String {
    project_id
        .to_string()
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn map_store_path(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir
        .join("maps")
        .join(format!("{}.json", safe_project_id(project_id))))
}

fn load_map_store_value(paths: &PathsState, project_id: &Uuid) -> Result<Value, String> {
    let path = map_store_path(paths, project_id)?;
    if !path.exists() {
        return Ok(json!({
            "projectId": project_id.to_string(),
            "maps": [],
        }));
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取地图文件失败 {:?}: {}", path, e))?;
    let value = serde_json::from_str::<Value>(&content)
        .map_err(|e| format!("解析地图文件失败 {:?}: {}", path, e))?;
    if value.get("maps").is_some() {
        return Ok(value);
    }
    if value.get("draftJson").is_some() {
        let saved_at = value
            .get("savedAt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        return Ok(json!({
            "projectId": project_id.to_string(),
            "maps": [{
                "id": Uuid::new_v4().to_string(),
                "name": "默认地图",
                "draftJson": value.get("draftJson").and_then(Value::as_str).unwrap_or("{\"shapes\":[],\"keyLocations\":[]}"),
                "sceneJson": value.get("sceneJson").and_then(Value::as_str),
                "coastlineParamsJson": null,
                "style": value.get("style").and_then(Value::as_str).unwrap_or("flat"),
                "backgroundImageUrl": null,
                "createdAt": saved_at,
                "updatedAt": value.get("savedAt").and_then(Value::as_str).unwrap_or_default(),
            }]
        }));
    }

    Ok(json!({
        "projectId": project_id.to_string(),
        "maps": [],
    }))
}

fn rewrite_scene_json_background(
    scene_json: &str,
    map_id: &str,
    collector: &mut AssetCollector,
    reused_background: Option<(&str, &str)>,
) -> Result<String, String> {
    let mut scene = serde_json::from_str::<Value>(scene_json)
        .map_err(|e| format!("解析地图 sceneJson 失败 map_id={map_id}: {e}"))?;
    let Some(url_value) = scene.pointer_mut("/backgroundImage/url") else {
        return Ok(scene_json.to_string());
    };
    let Some(url) = url_value.as_str().map(|value| value.to_string()) else {
        return Ok(scene_json.to_string());
    };

    if let Some((old_url, package_path)) = reused_background {
        if url == old_url {
            *url_value = Value::String(package_path.to_string());
            return serde_json::to_string(&scene)
                .map_err(|e| format!("序列化地图 sceneJson 失败 map_id={map_id}: {e}"));
        }
    }

    if is_data_url(&url) {
        let asset = collector.add_data_url_asset(
            &url,
            "map_background",
            "map",
            map_id,
            "sceneJson.backgroundImage.url",
        )?;
        *url_value = Value::String(asset.path);
        return serde_json::to_string(&scene)
            .map_err(|e| format!("序列化地图 sceneJson 失败 map_id={map_id}: {e}"));
    }

    Ok(scene_json.to_string())
}

fn rewrite_maps_json(
    paths: &PathsState,
    project_id: &Uuid,
    collector: &mut AssetCollector,
) -> Result<(String, usize), String> {
    let mut value = load_map_store_value(paths, project_id)?;
    let maps = value
        .get_mut("maps")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "地图文件缺少 maps 数组".to_string())?;
    let map_count = maps.len();

    for map in maps {
        let Some(object) = map.as_object_mut() else {
            continue;
        };
        let map_id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let mut rewritten_background: Option<(String, String)> = None;

        if let Some(background_value) = object.get_mut("backgroundImageUrl") {
            if let Some(background_url) = background_value.as_str().map(|value| value.to_string()) {
                if is_data_url(&background_url) {
                    let asset = collector.add_data_url_asset(
                        &background_url,
                        "map_background",
                        "map",
                        &map_id,
                        "backgroundImageUrl",
                    )?;
                    *background_value = Value::String(asset.path.clone());
                    rewritten_background = Some((background_url, asset.path));
                }
            }
        }

        if let Some(scene_value) = object.get_mut("sceneJson") {
            if let Some(scene_json) = scene_value.as_str().map(|value| value.to_string()) {
                if !scene_json.trim().is_empty() {
                    let rewritten = rewrite_scene_json_background(
                        &scene_json,
                        &map_id,
                        collector,
                        rewritten_background
                            .as_ref()
                            .map(|(old, new)| (old.as_str(), new.as_str())),
                    )?;
                    *scene_value = Value::String(rewritten);
                }
            }
        }
    }

    serde_json::to_string_pretty(&value)
        .map(|content| (content, map_count))
        .map_err(|e| format!("序列化地图导出数据失败: {}", e))
}

fn csv_row_count(items: &[CsvExportItem], table: WorldflowCsvTable) -> usize {
    items
        .iter()
        .find(|item| item.table == table)
        .map(|item| item.row_count)
        .unwrap_or(0)
}

fn build_manifest(
    package_id: &str,
    project: &Project,
    export: &ProjectCsvExport,
    csv_items: &[CsvExportItem],
    cover_asset_id: Option<String>,
    assets_index_json: &str,
    asset_count: usize,
    maps_json: &str,
    map_count: usize,
) -> Result<String, String> {
    let tables = csv_items
        .iter()
        .map(|item| ManifestCsvTable {
            name: table_name(item.table).to_string(),
            path: format!("{WORLD_DATA_DIR}{}", item.file_name),
            row_count: item.row_count,
            sha256: item.sha256.clone(),
        })
        .collect::<Vec<_>>();

    let manifest = FcworldManifest {
        format: FCWORLD_FORMAT.to_string(),
        format_version: FCWORLD_FORMAT_VERSION,
        package_id: package_id.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        generator: ManifestGenerator {
            app: "FlowCloudAI".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            platform: std::env::consts::OS.to_string(),
            worldflow_schema_version: export.schema_version,
        },
        compatibility: ManifestCompatibility {
            min_app_version: "0.1.0".to_string(),
            features: vec![
                "categories".to_string(),
                "entries".to_string(),
                "tagSchemas".to_string(),
                "entryTypes".to_string(),
                "relations".to_string(),
                "entryLinks".to_string(),
                "ideaNotes".to_string(),
                "images".to_string(),
                "maps".to_string(),
            ],
        },
        world: ManifestWorld {
            source_project_id: project.id.to_string(),
            name: project.name.clone(),
            description: project.description.clone(),
            cover_asset_id,
            created_at: project.created_at.clone(),
            updated_at: project.updated_at.clone(),
            language: "zh-CN".to_string(),
        },
        contents: ManifestContents {
            worldflow: ManifestWorldflowContents {
                path: WORLD_DATA_DIR.to_string(),
                schema_version: export.schema_version,
                tables,
            },
            assets_index: ManifestFile {
                path: ASSETS_INDEX_PATH.to_string(),
                count: asset_count,
                sha256: sha256_hex(assets_index_json.as_bytes()),
            },
            maps: ManifestFile {
                path: MAPS_PATH.to_string(),
                count: map_count,
                sha256: sha256_hex(maps_json.as_bytes()),
            },
            counts: ManifestCounts {
                categories: csv_row_count(csv_items, WorldflowCsvTable::Categories),
                entries: csv_row_count(csv_items, WorldflowCsvTable::Entries),
                tag_schemas: csv_row_count(csv_items, WorldflowCsvTable::TagSchemas),
                entry_types: csv_row_count(csv_items, WorldflowCsvTable::EntryTypes),
                relations: csv_row_count(csv_items, WorldflowCsvTable::EntryRelations),
                entry_links: csv_row_count(csv_items, WorldflowCsvTable::EntryLinks),
                idea_notes: csv_row_count(csv_items, WorldflowCsvTable::IdeaNotes),
                images: asset_count,
                maps: map_count,
            },
        },
    };

    serde_json::to_string_pretty(&manifest).map_err(|e| format!("序列化 manifest 失败: {}", e))
}

fn prepare_fcworld_package(
    paths: &PathsState,
    project: Project,
    export: ProjectCsvExport,
) -> Result<PreparedFcworldPackage, String> {
    let package_id = Uuid::new_v4().to_string();
    let mut collector = AssetCollector::default();
    let (csv_items, cover_asset_id) = rewrite_csv_items(export.clone(), &mut collector)?;
    let (maps_json, map_count) = rewrite_maps_json(paths, &project.id, &mut collector)?;
    let (index_assets, package_assets) = collector.into_parts();
    let asset_count = index_assets.len();
    let assets_index_json = serde_json::to_string_pretty(&FcworldAssetsIndex {
        version: 1,
        assets: index_assets,
    })
    .map_err(|e| format!("序列化资源索引失败: {}", e))?;
    let manifest_json = build_manifest(
        &package_id,
        &project,
        &export,
        &csv_items,
        cover_asset_id,
        &assets_index_json,
        asset_count,
        &maps_json,
        map_count,
    )?;

    Ok(PreparedFcworldPackage {
        package_id,
        project_id: project.id,
        csv_items,
        assets_index_json,
        manifest_json,
        maps_json,
        assets: package_assets,
        asset_count,
        map_count,
        warnings: Vec::new(),
    })
}

fn temp_output_path(output_path: &Path) -> Result<PathBuf, String> {
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("导出路径无效: {:?}", output_path))?;
    Ok(output_path.with_file_name(format!("{file_name}.tmp")))
}

fn write_zip_entry(
    zip: &mut ZipWriter<File>,
    options: SimpleFileOptions,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    zip.start_file(path, options)
        .map_err(|e| format!("写入 zip 文件项失败 {path}: {e}"))?;
    zip.write_all(bytes)
        .map_err(|e| format!("写入 zip 内容失败 {path}: {e}"))
}

fn write_fcworld_package(
    package: &PreparedFcworldPackage,
    output_path: &Path,
) -> Result<u64, String> {
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建导出目录失败 {:?}: {}", parent, e))?;
    }

    let temp_path = temp_output_path(output_path)?;
    if temp_path.exists() {
        std::fs::remove_file(&temp_path)
            .map_err(|e| format!("移除旧临时导出文件失败 {:?}: {}", temp_path, e))?;
    }

    let file = File::create(&temp_path)
        .map_err(|e| format!("创建临时导出文件失败 {:?}: {}", temp_path, e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    write_zip_entry(
        &mut zip,
        options,
        "manifest.json",
        package.manifest_json.as_bytes(),
    )?;
    for item in &package.csv_items {
        write_zip_entry(
            &mut zip,
            options,
            &format!("{WORLD_DATA_DIR}{}", item.file_name),
            item.content.as_bytes(),
        )?;
    }
    write_zip_entry(
        &mut zip,
        options,
        ASSETS_INDEX_PATH,
        package.assets_index_json.as_bytes(),
    )?;
    for asset in &package.assets {
        write_zip_entry(&mut zip, options, &asset.path, &asset.bytes)?;
    }
    write_zip_entry(&mut zip, options, MAPS_PATH, package.maps_json.as_bytes())?;

    zip.finish()
        .map_err(|e| format!("完成 zip 写入失败 {:?}: {}", temp_path, e))?;

    if output_path.exists() {
        std::fs::remove_file(output_path)
            .map_err(|e| format!("移除旧导出文件失败 {:?}: {}", output_path, e))?;
    }
    std::fs::rename(&temp_path, output_path)
        .map_err(|e| format!("保存导出文件失败 {:?}: {}", output_path, e))?;
    let metadata = std::fs::metadata(output_path)
        .map_err(|e| format!("读取导出文件信息失败 {:?}: {}", output_path, e))?;
    Ok(metadata.len())
}

#[tauri::command]
pub async fn db_export_project_fcworld(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    project_id: String,
    output_path: String,
) -> Result<FcworldExportResult, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let output_path_buf = PathBuf::from(&output_path);

    let (project, export) = {
        let state = state.inner().lock().await;
        let db = state.sqlite_db.lock().await;
        let project = db.get_project(&project_id).await.map_err(|e| e.to_string())?;
        let export = db
            .export_project_csvs(project_id)
            .await
            .map_err(|e| e.to_string())?;
        (project, export)
    };

    let package = prepare_fcworld_package(paths.inner(), project, export)?;
    let file_size = write_fcworld_package(&package, &output_path_buf)?;

    Ok(FcworldExportResult {
        output_path: output_path_buf.to_string_lossy().to_string(),
        package_id: package.package_id,
        project_id: package.project_id.to_string(),
        asset_count: package.asset_count,
        map_count: package.map_count,
        file_size,
        warnings: package.warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::{Cursor, Read};
    use tempfile::TempDir;
    use worldflow_core::{
        EntryOps, ProjectOps, SqliteDb,
        models::{CreateEntry, CreateProject, FCImage},
    };
    use zip::ZipArchive;

    fn png_bytes() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]));
        let mut cursor = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("测试 PNG 应可写入");
        cursor.into_inner()
    }

    fn png_data_url() -> String {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png_bytes())
        )
    }

    async fn new_test_db(prefix: &str) -> (TempDir, SqliteDb, PathsState) {
        let temp = tempfile::tempdir().expect("创建临时目录失败");
        let db_dir = temp.path().join("db");
        std::fs::create_dir_all(&db_dir).expect("创建测试数据库目录失败");
        let db_path = db_dir.join(format!("{prefix}.db"));
        let database_url = format!("sqlite:{}?mode=rwc", db_path.to_string_lossy().replace('\\', "/"));
        let db = SqliteDb::new(&database_url)
            .await
            .expect("创建测试数据库失败");
        let paths = PathsState {
            db_path,
            plugins_path: temp.path().join("plugins"),
        };
        (temp, db, paths)
    }

    fn read_zip_text(zip: &mut ZipArchive<File>, path: &str) -> String {
        let mut file = zip.by_name(path).expect("zip 文件项应存在");
        let mut content = String::new();
        file.read_to_string(&mut content)
            .expect("zip 文件项应为 UTF-8");
        content
    }

    fn create_image(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("创建图片目录失败");
        }
        std::fs::write(path, png_bytes()).expect("写入测试图片失败");
    }

    #[tokio::test]
    async fn exports_zip_with_rewritten_assets_and_manifest() {
        let (temp, db, paths) = new_test_db("fcworld_export").await;
        let image_dir = temp.path().join("images");
        let project_cover = image_dir.join("project-cover.png");
        let entry_image = image_dir.join("entry-image.png");
        let entry_cover = image_dir.join("entry-cover.png");
        create_image(&project_cover);
        create_image(&entry_image);
        create_image(&entry_cover);

        let project = db
            .create_project(CreateProject {
                name: "测试世界".to_string(),
                description: Some("用于导出的世界".to_string()),
                cover_image: Some(project_cover.to_string_lossy().to_string()),
            })
            .await
            .expect("创建项目失败");
        db.create_entry(CreateEntry {
            project_id: project.id,
            category_id: None,
            title: "角色".to_string(),
            summary: Some("摘要".to_string()),
            content: Some("正文".to_string()),
            r#type: None,
            tags: None,
            images: Some(vec![FCImage {
                path: entry_image.clone(),
                is_cover: true,
                caption: Some("图注".to_string()),
            }]),
            cover_path: Some(entry_cover.to_string_lossy().to_string()),
        })
        .await
        .expect("创建词条失败");

        let map_dir = paths.db_path.parent().unwrap().join("maps");
        std::fs::create_dir_all(&map_dir).expect("创建地图目录失败");
        let data_url = png_data_url();
        let scene_json = serde_json::to_string(&json!({
            "canvas": {"width": 100, "height": 100},
            "shapes": [],
            "keyLocations": [],
            "backgroundImage": {"url": data_url, "fit": "cover"}
        }))
        .expect("序列化测试 sceneJson 失败");
        std::fs::write(
            map_dir.join(format!("{}.json", project.id)),
            serde_json::to_string_pretty(&json!({
                "projectId": project.id.to_string(),
                "maps": [{
                    "id": "map-1",
                    "name": "地图",
                    "draftJson": "{\"shapes\":[],\"keyLocations\":[]}",
                    "sceneJson": scene_json,
                    "coastlineParamsJson": null,
                    "style": "flat",
                    "backgroundImageUrl": data_url,
                    "createdAt": "2026-05-17T00:00:00Z",
                    "updatedAt": "2026-05-17T00:00:00Z"
                }]
            }))
            .expect("序列化测试地图失败"),
        )
        .expect("写入测试地图失败");

        let project = db.get_project(&project.id).await.expect("读取项目失败");
        let export = db
            .export_project_csvs(project.id)
            .await
            .expect("导出项目 CSV 失败");
        let package = prepare_fcworld_package(&paths, project, export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("测试世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let file = File::open(&output_path).expect("打开导出包失败");
        let mut zip = ZipArchive::new(file).expect("读取 zip 失败");
        let names = zip.file_names().map(|name| name.to_string()).collect::<Vec<_>>();
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(names.contains(&"assets/index.json".to_string()));
        assert!(names.contains(&"maps/maps.json".to_string()));
        assert!(names.contains(&"data/worldflow/projects.csv".to_string()));
        assert!(names.contains(&"data/worldflow/entries.csv".to_string()));

        let manifest: Value =
            serde_json::from_str(&read_zip_text(&mut zip, "manifest.json")).expect("解析 manifest 失败");
        assert_eq!(manifest["format"], FCWORLD_FORMAT);
        assert_eq!(manifest["contents"]["worldflow"]["schemaVersion"], 5);
        assert_eq!(manifest["contents"]["counts"]["entries"], 1);
        assert_eq!(manifest["contents"]["counts"]["images"], 4);
        assert_eq!(manifest["contents"]["maps"]["count"], 1);
        assert!(manifest["world"]["coverAssetId"].as_str().is_some());

        let assets_index: Value = serde_json::from_str(&read_zip_text(&mut zip, "assets/index.json"))
            .expect("解析资源索引失败");
        let assets = assets_index["assets"].as_array().expect("资源索引应为数组");
        assert_eq!(assets.len(), 4);
        for asset in assets {
            assert!(asset["path"].as_str().unwrap().starts_with("assets/images/"));
            assert_eq!(asset["mime"], "image/png");
            assert_eq!(asset["width"], 1);
            assert_eq!(asset["height"], 1);
            assert!(zip.by_name(asset["path"].as_str().unwrap()).is_ok());
        }

        let projects_csv = read_zip_text(&mut zip, "data/worldflow/projects.csv");
        let entries_csv = read_zip_text(&mut zip, "data/worldflow/entries.csv");
        assert!(!projects_csv.contains(&project_cover.to_string_lossy().to_string()));
        assert!(!entries_csv.contains(&entry_image.to_string_lossy().to_string()));
        assert!(!entries_csv.contains(&entry_cover.to_string_lossy().to_string()));
        assert!(projects_csv.contains("assets/images/"));
        assert!(entries_csv.contains("assets/images/"));

        let maps_json = read_zip_text(&mut zip, "maps/maps.json");
        assert!(maps_json.contains("assets/images/"));
        assert!(!maps_json.contains("data:image/png;base64"));

        let table_manifest = manifest["contents"]["worldflow"]["tables"]
            .as_array()
            .unwrap()
            .iter()
            .find(|table| table["name"] == "entries")
            .unwrap();
        assert_eq!(
            table_manifest["sha256"].as_str().unwrap(),
            sha256_hex(entries_csv.as_bytes())
        );
    }

    #[tokio::test]
    async fn missing_map_file_exports_empty_store() {
        let (_temp, db, paths) = new_test_db("fcworld_empty_maps").await;
        let project = db
            .create_project(CreateProject {
                name: "无地图世界".to_string(),
                description: None,
                cover_image: None,
            })
            .await
            .expect("创建项目失败");
        let project = db.get_project(&project.id).await.expect("读取项目失败");
        let export = db
            .export_project_csvs(project.id)
            .await
            .expect("导出项目 CSV 失败");

        let package = prepare_fcworld_package(&paths, project, export).expect("准备 fcworld 失败");
        let maps: Value = serde_json::from_str(&package.maps_json).expect("解析地图 JSON 失败");
        assert_eq!(maps["maps"].as_array().unwrap().len(), 0);
        assert_eq!(package.map_count, 0);
    }
}
