use super::common::*;
use base64::Engine;
use csv::StringRecord;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use std::sync::Mutex as StdMutex;
use tauri::Emitter;
use zip::{ZipWriter, write::SimpleFileOptions};

use worldflow_core::{
    CsvExportItem, CsvExportScope, CsvImportBundle, CsvImportMode, CsvImportProgressPhase,
    CsvImportResult, ProjectCsvExport, ProjectOps, WorldflowCsvTable, models::Project,
};

mod import;

const FCWORLD_FORMAT: &str = "com.flowcloudai.fcworld";
const FCWORLD_FORMAT_VERSION: u32 = 1;
const WORLD_DATA_DIR: &str = "data/worldflow/";
const ASSETS_INDEX_PATH: &str = "assets/index.json";
const MAPS_PATH: &str = "maps/maps.json";
const FCWORLD_PROGRESS_EVENT: &str = "fcworld:progress";

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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldImportRows {
    pub projects: usize,
    pub categories: usize,
    pub entries: usize,
    pub tag_schemas: usize,
    pub entry_types: usize,
    pub relations: usize,
    pub links: usize,
    pub idea_notes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldImportResult {
    pub input_path: String,
    pub package_id: String,
    pub source_project_id: String,
    pub project_id: String,
    pub project_name: String,
    pub asset_count: usize,
    pub map_count: usize,
    pub file_size: u64,
    pub imported_rows: FcworldImportRows,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldProgressEvent {
    pub operation_id: String,
    pub kind: String,
    pub phase: String,
    pub message: String,
    pub current: usize,
    pub total: usize,
    pub percent: u8,
    pub status: String,
}

#[derive(Clone)]
struct FcworldProgressEmitter {
    app: Option<AppHandle>,
    operation_id: Option<String>,
    kind: &'static str,
}

impl FcworldProgressEmitter {
    fn new(app: Option<AppHandle>, operation_id: Option<String>, kind: &'static str) -> Self {
        Self {
            app,
            operation_id,
            kind,
        }
    }

    #[cfg(test)]
    fn disabled(kind: &'static str) -> Self {
        Self::new(None, None, kind)
    }

    fn emit(
        &self,
        phase: impl Into<String>,
        message: impl Into<String>,
        current: usize,
        total: usize,
        percent: u8,
        status: &'static str,
    ) {
        let (Some(app), Some(operation_id)) = (&self.app, &self.operation_id) else {
            return;
        };
        let _ = app.emit(
            FCWORLD_PROGRESS_EVENT,
            FcworldProgressEvent {
                operation_id: operation_id.clone(),
                kind: self.kind.to_string(),
                phase: phase.into(),
                message: message.into(),
                current,
                total,
                percent,
                status: status.to_string(),
            },
        );
    }
}

#[derive(Debug, Clone, Default)]
struct FcworldProgressState {
    current: usize,
    total: usize,
    percent: u8,
}

#[derive(Clone)]
struct FcworldProgressTracker {
    emitter: FcworldProgressEmitter,
    state: Arc<StdMutex<FcworldProgressState>>,
}

impl FcworldProgressTracker {
    fn new(emitter: FcworldProgressEmitter, total: usize) -> Self {
        Self {
            emitter,
            state: Arc::new(StdMutex::new(FcworldProgressState {
                current: 0,
                total,
                percent: 0,
            })),
        }
    }

    fn emit_state(
        &self,
        state: &mut FcworldProgressState,
        phase: impl Into<String>,
        message: impl Into<String>,
        status: &'static str,
    ) {
        let computed_percent = match status {
            "done" => 100,
            _ if state.total == 0 => state.percent,
            _ => ((state.current.min(state.total) * 100) / state.total).min(100) as u8,
        };
        state.percent = state.percent.max(computed_percent);
        self.emitter.emit(
            phase,
            message,
            state.current,
            state.total,
            state.percent,
            status,
        );
    }

    fn add_total(&self, amount: usize, phase: &str, message: impl Into<String>) {
        if amount == 0 {
            return;
        }
        let mut state = self.state.lock().expect("fcworld progress state poisoned");
        state.total = state.total.saturating_add(amount);
        self.emit_state(&mut state, phase, message, "running");
    }

    fn step(&self, phase: &str, message: impl Into<String>) {
        let mut state = self.state.lock().expect("fcworld progress state poisoned");
        state.current = state.current.saturating_add(1).min(state.total.max(1));
        self.emit_state(&mut state, phase, message, "running");
    }

    fn note(&self, phase: &str, message: impl Into<String>) {
        let mut state = self.state.lock().expect("fcworld progress state poisoned");
        self.emit_state(&mut state, phase, message, "running");
    }

    fn done(&self, message: impl Into<String>) {
        let mut state = self.state.lock().expect("fcworld progress state poisoned");
        state.current = state.total;
        self.emit_state(&mut state, "done", message, "done");
    }

    fn error(&self, message: impl Into<String>) {
        let mut state = self.state.lock().expect("fcworld progress state poisoned");
        self.emit_state(&mut state, "error", message, "error");
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldImportDuplicateProject {
    pub project_id: String,
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldImportPreview {
    pub input_path: String,
    pub package_id: String,
    pub source_project_id: String,
    pub project_name: String,
    pub suggested_name: String,
    pub duplicate_project: Option<FcworldImportDuplicateProject>,
    pub asset_count: usize,
    pub map_count: usize,
    pub file_size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FcworldImportMode {
    Rename,
    Overwrite,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcworldImportOptions {
    pub mode: FcworldImportMode,
    pub project_name: Option<String>,
    pub overwrite_project_id: Option<String>,
}

#[derive(Debug, Clone)]
struct FcworldOverwriteTarget {
    project_id: Uuid,
    project_name: String,
}

#[derive(Debug, Clone)]
struct FcworldImportDecision {
    project_name: String,
    overwrite_target: Option<FcworldOverwriteTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FcworldAssetSource {
    entity_type: String,
    entity_id: String,
    field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestGenerator {
    app: String,
    app_version: String,
    platform: String,
    worldflow_schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCompatibility {
    min_app_version: String,
    features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestContents {
    worldflow: ManifestWorldflowContents,
    assets_index: ManifestFile,
    maps: ManifestFile,
    counts: ManifestCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestWorldflowContents {
    path: String,
    schema_version: u32,
    tables: Vec<ManifestCsvTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCsvTable {
    name: String,
    path: String,
    row_count: usize,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    path: String,
    count: usize,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

fn rewrite_project_csv<F>(
    item: CsvExportItem,
    collector: &mut AssetCollector,
    on_asset: &mut F,
) -> Result<CsvRewriteOutput, String>
where
    F: FnMut(&str),
{
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
            on_asset(&asset.path);
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

fn rewrite_entry_images_json<F>(
    raw: &str,
    entry_id: &str,
    collector: &mut AssetCollector,
    on_asset: &mut F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
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

        let asset = collector.add_file_asset(
            Path::new(&path),
            "entry_image",
            "entry",
            entry_id,
            "images",
        )?;
        on_asset(&asset.path);
        object.insert("path".to_string(), Value::String(asset.path));
    }

    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.images JSON 失败 entry_id={entry_id}: {e}"))
}

fn rewrite_entries_csv<F>(
    item: CsvExportItem,
    collector: &mut AssetCollector,
    on_asset: &mut F,
) -> Result<CsvRewriteOutput, String>
where
    F: FnMut(&str),
{
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
            fields[images_index] =
                rewrite_entry_images_json(&images, &entry_id, collector, on_asset)?;
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
            on_asset(&asset.path);
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

fn rewrite_csv_items<F>(
    export: ProjectCsvExport,
    collector: &mut AssetCollector,
    on_asset: &mut F,
) -> Result<(Vec<CsvExportItem>, Option<String>), String>
where
    F: FnMut(&str),
{
    let mut items = Vec::with_capacity(export.items.len());
    let mut cover_asset_id = None;

    for item in export.items {
        let output = match item.table {
            WorldflowCsvTable::Projects => rewrite_project_csv(item, collector, on_asset)?,
            WorldflowCsvTable::Entries => rewrite_entries_csv(item, collector, on_asset)?,
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

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取地图文件失败 {:?}: {}", path, e))?;
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

fn rewrite_scene_json_background<F>(
    scene_json: &str,
    map_id: &str,
    collector: &mut AssetCollector,
    reused_background: Option<(&str, &str)>,
    on_asset: &mut F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
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
        on_asset(&asset.path);
        *url_value = Value::String(asset.path);
        return serde_json::to_string(&scene)
            .map_err(|e| format!("序列化地图 sceneJson 失败 map_id={map_id}: {e}"));
    }

    Ok(scene_json.to_string())
}

fn rewrite_maps_json<F>(
    paths: &PathsState,
    project_id: &Uuid,
    collector: &mut AssetCollector,
    on_asset: &mut F,
) -> Result<(String, usize), String>
where
    F: FnMut(&str),
{
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
                    on_asset(&asset.path);
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
                        on_asset,
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

fn count_project_asset_candidates(item: &CsvExportItem) -> Result<usize, String> {
    if item.row_count == 0 || item.content.trim().is_empty() {
        return Ok(0);
    }
    let mut reader = csv::Reader::from_reader(item.content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 projects.csv 表头失败: {}", e))?
        .clone();
    let cover_index = header_index(&headers, "cover_image")?;
    let mut count = 0usize;
    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 projects.csv 记录失败: {}", e))?;
        let cover_path = record
            .get(cover_index)
            .map(decode_csv_opt_string)
            .transpose()?
            .flatten();
        if cover_path
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            count += 1;
        }
    }
    Ok(count)
}

fn count_entry_images_candidates(raw: &str, entry_id: &str) -> Result<usize, String> {
    if raw.trim().is_empty() {
        return Ok(0);
    }
    let value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.images JSON 失败 entry_id={entry_id}: {e}"))?;
    let images = value
        .as_array()
        .ok_or_else(|| format!("entries.images 不是数组 entry_id={entry_id}"))?;
    Ok(images
        .iter()
        .filter(|image| {
            image
                .get("path")
                .and_then(Value::as_str)
                .map(|path| !path.trim().is_empty())
                .unwrap_or(false)
        })
        .count())
}

fn count_entry_asset_candidates(item: &CsvExportItem) -> Result<usize, String> {
    if item.row_count == 0 || item.content.trim().is_empty() {
        return Ok(0);
    }
    let mut reader = csv::Reader::from_reader(item.content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 entries.csv 表头失败: {}", e))?
        .clone();
    let id_index = header_index(&headers, "id")?;
    let images_index = header_index(&headers, "images")?;
    let cover_index = header_index(&headers, "cover_path")?;
    let mut count = 0usize;
    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 entries.csv 记录失败: {}", e))?;
        let entry_id = record.get(id_index).unwrap_or_default();
        count += count_entry_images_candidates(record.get(images_index).unwrap_or_default(), entry_id)?;
        let cover_path = record
            .get(cover_index)
            .map(decode_csv_opt_string)
            .transpose()?
            .flatten();
        if cover_path
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            count += 1;
        }
    }
    Ok(count)
}

fn count_scene_background_candidate(
    scene_json: &str,
    map_id: &str,
    reused_background: Option<&str>,
) -> Result<usize, String> {
    if scene_json.trim().is_empty() {
        return Ok(0);
    }
    let scene = serde_json::from_str::<Value>(scene_json)
        .map_err(|e| format!("解析地图 sceneJson 失败 map_id={map_id}: {e}"))?;
    let Some(url) = scene.pointer("/backgroundImage/url").and_then(Value::as_str) else {
        return Ok(0);
    };
    if is_data_url(url) && reused_background != Some(url) {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn count_map_asset_candidates(paths: &PathsState, project_id: &Uuid) -> Result<usize, String> {
    let value = load_map_store_value(paths, project_id)?;
    let maps = value
        .get("maps")
        .and_then(Value::as_array)
        .ok_or_else(|| "地图文件缺少 maps 数组".to_string())?;
    let mut count = 0usize;
    for map in maps {
        let Some(object) = map.as_object() else {
            continue;
        };
        let map_id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let background_url = object
            .get("backgroundImageUrl")
            .and_then(Value::as_str)
            .filter(|url| is_data_url(url));
        if background_url.is_some() {
            count += 1;
        }
        if let Some(scene_json) = object.get("sceneJson").and_then(Value::as_str) {
            count += count_scene_background_candidate(scene_json, map_id, background_url)?;
        }
    }
    Ok(count)
}

fn count_export_asset_candidates(
    paths: &PathsState,
    project_id: &Uuid,
    items: &[CsvExportItem],
) -> Result<usize, String> {
    let mut count = count_map_asset_candidates(paths, project_id)?;
    for item in items {
        count += match item.table {
            WorldflowCsvTable::Projects => count_project_asset_candidates(item)?,
            WorldflowCsvTable::Entries => count_entry_asset_candidates(item)?,
            _ => 0,
        };
    }
    Ok(count)
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

#[cfg(test)]
fn prepare_fcworld_package(
    paths: &PathsState,
    project: Project,
    export: ProjectCsvExport,
) -> Result<PreparedFcworldPackage, String> {
    prepare_fcworld_package_with_progress(paths, project, export, |_| {})
}

fn prepare_fcworld_package_with_progress<F>(
    paths: &PathsState,
    project: Project,
    export: ProjectCsvExport,
    mut on_asset: F,
) -> Result<PreparedFcworldPackage, String>
where
    F: FnMut(&str),
{
    let package_id = Uuid::new_v4().to_string();
    let mut collector = AssetCollector::default();
    let (csv_items, cover_asset_id) = rewrite_csv_items(export.clone(), &mut collector, &mut on_asset)?;
    let (maps_json, map_count) =
        rewrite_maps_json(paths, &project.id, &mut collector, &mut on_asset)?;
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

#[cfg(test)]
fn write_fcworld_package(
    package: &PreparedFcworldPackage,
    output_path: &Path,
) -> Result<u64, String> {
    write_fcworld_package_with_progress(package, output_path, |_| {})
}

fn write_fcworld_package_with_progress<F>(
    package: &PreparedFcworldPackage,
    output_path: &Path,
    mut on_entry: F,
) -> Result<u64, String>
where
    F: FnMut(&str),
{
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
    on_entry("manifest.json");
    for item in &package.csv_items {
        let path = format!("{WORLD_DATA_DIR}{}", item.file_name);
        write_zip_entry(&mut zip, options, &path, item.content.as_bytes())?;
        on_entry(&path);
    }
    write_zip_entry(
        &mut zip,
        options,
        ASSETS_INDEX_PATH,
        package.assets_index_json.as_bytes(),
    )?;
    on_entry(ASSETS_INDEX_PATH);
    for asset in &package.assets {
        write_zip_entry(&mut zip, options, &asset.path, &asset.bytes)?;
        on_entry(&asset.path);
    }
    write_zip_entry(&mut zip, options, MAPS_PATH, package.maps_json.as_bytes())?;
    on_entry(MAPS_PATH);

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

impl From<CsvImportResult> for FcworldImportRows {
    fn from(value: CsvImportResult) -> Self {
        Self {
            projects: value.projects,
            categories: value.categories,
            entries: value.entries,
            tag_schemas: value.tag_schemas,
            entry_types: value.entry_types,
            relations: value.relations,
            links: value.links,
            idea_notes: value.idea_notes,
        }
    }
}

fn count_import_csv_rows(content: &str, table: WorldflowCsvTable) -> Result<usize, String> {
    if content.trim().is_empty() {
        return Ok(0);
    }
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let mut count = 0usize;
    for record in reader.records() {
        record.map_err(|e| format!("解析导入 CSV 行数失败 {}: {e}", table.file_name()))?;
        count += 1;
    }
    Ok(count)
}

fn expected_import_rows(
    items: &[worldflow_core::CsvImportItem],
) -> Result<FcworldImportRows, String> {
    let mut rows = FcworldImportRows::default();
    for item in items {
        let count = count_import_csv_rows(&item.content, item.table)?;
        match item.table {
            WorldflowCsvTable::Projects => rows.projects = count,
            WorldflowCsvTable::Categories => rows.categories = count,
            WorldflowCsvTable::TagSchemas => rows.tag_schemas = count,
            WorldflowCsvTable::EntryTypes => rows.entry_types = count,
            WorldflowCsvTable::Entries => rows.entries = count,
            WorldflowCsvTable::EntryRelations => rows.relations = count,
            WorldflowCsvTable::EntryLinks => rows.links = count,
            WorldflowCsvTable::IdeaNotes => rows.idea_notes = count,
        }
    }
    Ok(rows)
}

fn total_import_rows(rows: &FcworldImportRows) -> usize {
    rows.projects
        + rows.categories
        + rows.entries
        + rows.tag_schemas
        + rows.entry_types
        + rows.relations
        + rows.links
        + rows.idea_notes
}

fn track_package_validation_progress(
    tracker: &FcworldProgressTracker,
    event: import::FcworldPackageProgress,
) {
    match event {
        import::FcworldPackageProgress::AddTotal {
            amount,
            phase,
            message,
        } => tracker.add_total(amount, phase, message),
        import::FcworldPackageProgress::Step { phase, message } => tracker.step(phase, message),
    }
}

fn normalize_project_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn source_project_name(package: &import::ValidatedFcworldPackage) -> String {
    match package.manifest.world.name.trim() {
        "" => "导入世界".to_string(),
        name => name.to_string(),
    }
}

fn project_name_exists(projects: &[Project], name: &str) -> bool {
    let normalized = normalize_project_name(name);
    projects
        .iter()
        .any(|project| normalize_project_name(&project.name) == normalized)
}

fn duplicate_project_for_name<'a>(projects: &'a [Project], name: &str) -> Option<&'a Project> {
    let normalized = normalize_project_name(name);
    projects
        .iter()
        .find(|project| normalize_project_name(&project.name) == normalized)
}

fn suggested_import_project_name(source_name: &str, projects: &[Project]) -> String {
    let base = match source_name.trim() {
        "" => "导入世界",
        name => name,
    };
    if !project_name_exists(projects, base) {
        return base.to_string();
    }

    let mut index = 1usize;
    loop {
        let candidate = if index == 1 {
            format!("{base}【导入】")
        } else {
            format!("{base}【导入 {index}】")
        };
        if !project_name_exists(projects, &candidate) {
            return candidate;
        }
        index += 1;
    }
}

fn import_preview_from_package(
    input_path: &Path,
    package: &import::ValidatedFcworldPackage,
    existing_projects: &[Project],
) -> FcworldImportPreview {
    let project_name = source_project_name(package);
    let duplicate_project =
        duplicate_project_for_name(existing_projects, &project_name).map(|project| {
            FcworldImportDuplicateProject {
                project_id: project.id.to_string(),
                project_name: project.name.clone(),
            }
        });

    FcworldImportPreview {
        input_path: input_path.to_string_lossy().to_string(),
        package_id: package.manifest.package_id.clone(),
        source_project_id: package.manifest.world.source_project_id.clone(),
        project_name: project_name.clone(),
        suggested_name: suggested_import_project_name(&project_name, existing_projects),
        duplicate_project,
        asset_count: package.assets_index.assets.len(),
        map_count: package.manifest.contents.maps.count,
        file_size: package.input_file_size,
    }
}

fn resolve_import_decision(
    package: &import::ValidatedFcworldPackage,
    existing_projects: &[Project],
    options: Option<FcworldImportOptions>,
) -> Result<FcworldImportDecision, String> {
    let source_name = source_project_name(package);
    let options = options.unwrap_or(FcworldImportOptions {
        mode: FcworldImportMode::Rename,
        project_name: None,
        overwrite_project_id: None,
    });

    match options.mode {
        FcworldImportMode::Rename => {
            let project_name = options
                .project_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| suggested_import_project_name(&source_name, existing_projects));
            if project_name_exists(existing_projects, &project_name) {
                return Err(format!(
                    "已存在名为“{project_name}”的世界观，请选择覆盖或换一个导入名称"
                ));
            }
            Ok(FcworldImportDecision {
                project_name,
                overwrite_target: None,
            })
        }
        FcworldImportMode::Overwrite => {
            let target = if let Some(project_id) = options.overwrite_project_id.as_deref() {
                let project_id = Uuid::parse_str(project_id)
                    .map_err(|e| format!("覆盖目标项目 ID 无效: {e}"))?;
                existing_projects
                    .iter()
                    .find(|project| project.id == project_id)
                    .ok_or_else(|| "覆盖目标世界观不存在".to_string())?
            } else {
                duplicate_project_for_name(existing_projects, &source_name)
                    .ok_or_else(|| "未找到可覆盖的同名世界观".to_string())?
            };

            if normalize_project_name(&target.name) != normalize_project_name(&source_name) {
                return Err(format!(
                    "覆盖目标“{}”与导入世界“{}”名称不一致",
                    target.name, source_name
                ));
            }

            Ok(FcworldImportDecision {
                project_name: target.name.clone(),
                overwrite_target: Some(FcworldOverwriteTarget {
                    project_id: target.id,
                    project_name: target.name.clone(),
                }),
            })
        }
    }
}

fn write_prepared_import_files_with_progress<F>(
    package: &import::PreparedFcworldImport,
    paths: &PathsState,
    mut on_file: F,
) -> Result<(), String>
where
    F: FnMut(&str),
{
    if !package.assets.is_empty() {
        let image_dir = import::import_images_dir(paths, &package.new_project_id)?;
        std::fs::create_dir_all(&image_dir)
            .map_err(|e| format!("创建导入图片目录失败 {:?}: {e}", image_dir))?;
    }

    for asset in &package.assets {
        if let Some(parent) = asset.target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建导入资源目录失败 {:?}: {e}", parent))?;
        }
        if asset.target_path.exists() {
            return Err(format!("导入资源目标已存在: {:?}", asset.target_path));
        }
        std::fs::write(&asset.target_path, &asset.bytes)
            .map_err(|e| format!("写入导入资源失败 {:?}: {e}", asset.target_path))?;
        let path_text = asset.target_path.to_string_lossy();
        on_file(path_text.as_ref());
    }

    let map_path = map_store_path(paths, &package.new_project_id)?;
    if let Some(parent) = map_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建导入地图目录失败 {:?}: {e}", parent))?;
    }
    if map_path.exists() {
        return Err(format!("导入地图目标已存在: {:?}", map_path));
    }
    std::fs::write(&map_path, &package.maps_json)
        .map_err(|e| format!("写入导入地图失败 {:?}: {e}", map_path))?;
    let path_text = map_path.to_string_lossy();
    on_file(path_text.as_ref());
    Ok(())
}

fn cleanup_prepared_import_files(
    package: &import::PreparedFcworldImport,
    paths: &PathsState,
) -> Result<(), String> {
    let mut errors = Vec::new();
    let image_dir = import::import_images_dir(paths, &package.new_project_id)?;
    if image_dir.exists() {
        if let Err(error) = std::fs::remove_dir_all(&image_dir) {
            errors.push(format!("清理图片目录失败 {:?}: {error}", image_dir));
        }
    }

    let map_path = map_store_path(paths, &package.new_project_id)?;
    if map_path.exists() {
        if let Err(error) = std::fs::remove_file(&map_path) {
            errors.push(format!("清理地图文件失败 {:?}: {error}", map_path));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn cleanup_project_sidecar_files(paths: &PathsState, project_id: &Uuid) -> Result<(), String> {
    let mut errors = Vec::new();
    let image_dir = import::import_images_dir(paths, project_id)?;
    if image_dir.exists() {
        if let Err(error) = std::fs::remove_dir_all(&image_dir) {
            errors.push(format!("清理原世界观图片目录失败 {:?}: {error}", image_dir));
        }
    }

    let map_path = map_store_path(paths, project_id)?;
    if map_path.exists() {
        if let Err(error) = std::fs::remove_file(&map_path) {
            errors.push(format!("清理原世界观地图文件失败 {:?}: {error}", map_path));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn cleanup_after_file_write_error(
    package: &import::PreparedFcworldImport,
    paths: &PathsState,
    reason: String,
) -> String {
    match cleanup_prepared_import_files(package, paths) {
        Ok(()) => reason,
        Err(cleanup_error) => {
            format!("{reason}；清理导入临时文件失败，需要人工介入：{cleanup_error}")
        }
    }
}

async fn rollback_after_import_row_mismatch(
    db: &SqliteDb,
    package: &import::PreparedFcworldImport,
    paths: &PathsState,
    reason: String,
) -> String {
    let mut errors = Vec::new();
    if let Err(error) = db.delete_project(&package.new_project_id).await {
        errors.push(format!("回滚数据库项目失败: {error}"));
    }
    if let Err(error) = cleanup_prepared_import_files(package, paths) {
        errors.push(error);
    }

    if errors.is_empty() {
        reason
    } else {
        format!("{reason}；回滚失败，需要人工介入：{}", errors.join("；"))
    }
}

async fn import_fcworld_package_to_db(
    db: &SqliteDb,
    paths: &PathsState,
    input_path: &Path,
    options: Option<FcworldImportOptions>,
    progress: FcworldProgressTracker,
) -> Result<FcworldImportResult, String> {
    let existing_projects = db.list_projects().await.map_err(|e| e.to_string())?;
    let progress_for_validation = progress.clone();
    let validated = import::read_and_validate_fcworld_package_with_progress(
        input_path,
        db.worldflow_schema_version(),
        move |event| track_package_validation_progress(&progress_for_validation, event),
    )?;
    let decision = resolve_import_decision(&validated, &existing_projects, options)?;
    let prepared = import::prepare_fcworld_import(validated, paths, &decision.project_name)?;
    let expected_rows = expected_import_rows(&prepared.csv_items)?;

    progress.add_total(
        prepared.assets.len() + 1,
        "write_files",
        "写入导入资源和地图",
    );
    if let Err(error) = write_prepared_import_files_with_progress(&prepared, paths, |path| {
        progress.step("write_files", format!("已写入导入文件：{path}"));
    }) {
        return Err(cleanup_after_file_write_error(&prepared, paths, error));
    }

    let db_row_total = total_import_rows(&expected_rows);
    progress.add_total(db_row_total, "import_db", "写入导入数据库");
    let import_result = match db
        .import_csvs_with_progress(
            CsvImportBundle {
                items: prepared.csv_items.clone(),
            },
            CsvImportMode::Merge,
            |event| match event.phase {
                CsvImportProgressPhase::TableStarted => {
                    progress.note("import_db", format!("开始写入 {}", event.table.file_name()));
                }
                CsvImportProgressPhase::RowProcessed => {
                    progress.step(
                        "import_db",
                        format!(
                            "写入 {}：{}/{} 行，新增 {} 行",
                            event.table.file_name(),
                            event.current,
                            event.total,
                            event.inserted
                        ),
                    );
                }
                CsvImportProgressPhase::TableFinished => {
                    progress.note(
                        "import_db",
                        format!("完成写入 {}", event.table.file_name()),
                    );
                }
            },
        )
        .await
    {
        Ok(result) => result,
        Err(error) => {
            let reason = format!("写入导入数据库失败: {error}");
            return match cleanup_prepared_import_files(&prepared, paths) {
                Ok(()) => Err(reason),
                Err(cleanup_error) => Err(format!(
                    "{reason}；清理导入文件失败，需要人工介入：{cleanup_error}"
                )),
            };
        }
    };

    let actual_rows = FcworldImportRows::from(import_result);
    if actual_rows != expected_rows {
        let reason =
            format!("fcworld 导入行数不匹配: expected={expected_rows:?} actual={actual_rows:?}");
        return Err(rollback_after_import_row_mismatch(db, &prepared, paths, reason).await);
    }

    let mut warnings = prepared.warnings.clone();
    progress.add_total(
        expected_rows.entries,
        "thumbnails",
        "生成导入词条主图缩略图",
    );
    match super::images::ensure_project_cover_thumbnails_with_progress(
        db,
        paths,
        &prepared.new_project_id,
        |current, total| {
            if total > 0 {
                progress.step(
                    "thumbnails",
                    format!("生成主图缩略图：{current}/{total}"),
                );
            }
        },
    )
    .await
    {
        Ok(summary) => {
            if summary.failed > 0 {
                warnings.push(format!(
                    "{} 个词条主图缩略图生成失败，已保留原图路径",
                    summary.failed
                ));
            }
        }
        Err(error) => {
            warnings.push(format!("导入成功，但生成主图缩略图失败：{error}"));
        }
    }

    if let Some(target) = decision.overwrite_target {
        progress.add_total(1, "cleanup", "清理覆盖目标世界观");
        if let Err(error) = db.delete_project(&target.project_id).await {
            let reason = format!("删除覆盖目标世界观失败: {error}");
            return Err(rollback_after_import_row_mismatch(db, &prepared, paths, reason).await);
        }
        if let Err(error) = cleanup_project_sidecar_files(paths, &target.project_id) {
            return Err(format!(
                "覆盖导入已写入，但清理原世界观文件失败，需要人工介入：{error}"
            ));
        }
        progress.step("cleanup", "已清理覆盖目标世界观");
        warnings.push(format!("已覆盖原世界观：{}", target.project_name));
    }

    Ok(FcworldImportResult {
        input_path: input_path.to_string_lossy().to_string(),
        package_id: prepared.package_id,
        source_project_id: prepared.source_project_id,
        project_id: prepared.new_project_id.to_string(),
        project_name: prepared.project_name,
        asset_count: prepared.asset_count,
        map_count: prepared.map_count,
        file_size: prepared.input_file_size,
        imported_rows: actual_rows,
        warnings,
    })
}

async fn preview_fcworld_package(
    db: &SqliteDb,
    input_path: &Path,
    progress: FcworldProgressTracker,
) -> Result<FcworldImportPreview, String> {
    let existing_projects = db.list_projects().await.map_err(|e| e.to_string())?;
    let progress_for_validation = progress.clone();
    let validated = import::read_and_validate_fcworld_package_with_progress(
        input_path,
        db.worldflow_schema_version(),
        move |event| track_package_validation_progress(&progress_for_validation, event),
    )?;
    Ok(import_preview_from_package(
        input_path,
        &validated,
        &existing_projects,
    ))
}

#[tauri::command]
pub async fn db_export_project_fcworld(
    app: AppHandle,
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    project_id: String,
    output_path: String,
    operation_id: Option<String>,
) -> Result<FcworldExportResult, String> {
    let progress = FcworldProgressTracker::new(
        FcworldProgressEmitter::new(Some(app), operation_id, "export"),
        WorldflowCsvTable::ordered().len(),
    );
    let result = async {
        let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
        let output_path_buf = PathBuf::from(&output_path);

        let (project, export) = {
            let state = state.inner().lock().await;
            let db = state.sqlite_db.lock().await;
            let project = db
                .get_project(&project_id)
                .await
                .map_err(|e| e.to_string())?;
            let mut items = Vec::with_capacity(WorldflowCsvTable::ordered().len());
            for table in WorldflowCsvTable::ordered() {
                let item = db
                    .export_csv_table(*table, CsvExportScope::Project { project_id })
                    .await
                    .map_err(|e| e.to_string())?;
                progress.step("export_csv", format!("已导出 CSV：{}", item.file_name));
                items.push(item);
            }
            let export = ProjectCsvExport {
                project_id,
                schema_version: db.worldflow_schema_version(),
                items,
            };
            (project, export)
        };

        let asset_total = count_export_asset_candidates(paths.inner(), &project_id, &export.items)?;
        progress.add_total(asset_total, "export_assets", "处理导出图片资源");
        progress.add_total(1, "export_maps", "处理导出地图数据");
        let package = prepare_fcworld_package_with_progress(paths.inner(), project, export, |path| {
            progress.step("export_assets", format!("已处理资源：{path}"));
        })?;
        progress.step("export_maps", "已处理地图数据");

        let zip_total = 1 + package.csv_items.len() + 1 + package.assets.len() + 1;
        progress.add_total(zip_total, "write_zip", "写入 fcworld 压缩包");
        let file_size = write_fcworld_package_with_progress(&package, &output_path_buf, |path| {
            progress.step("write_zip", format!("已写入包内文件：{path}"));
        })?;

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
    .await;

    match &result {
        Ok(_) => progress.done("导出世界完成"),
        Err(error) => progress.error(format!("导出世界失败：{error}")),
    }
    result
}

#[tauri::command]
pub async fn db_import_project_fcworld(
    app: AppHandle,
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    input_path: String,
    options: Option<FcworldImportOptions>,
    operation_id: Option<String>,
) -> Result<FcworldImportResult, String> {
    let progress = FcworldProgressTracker::new(
        FcworldProgressEmitter::new(Some(app), operation_id, "import"),
        0,
    );
    let result = async {
        let input_path_buf = PathBuf::from(&input_path);
        let state = state.inner().lock().await;
        let db = state.sqlite_db.lock().await;
        import_fcworld_package_to_db(&db, paths.inner(), &input_path_buf, options, progress.clone())
            .await
    }
    .await;

    match &result {
        Ok(_) => progress.done("导入世界完成"),
        Err(error) => progress.error(format!("导入世界失败：{error}")),
    }
    result
}

#[tauri::command]
pub async fn db_preview_project_fcworld(
    app: AppHandle,
    state: State<'_, Arc<Mutex<AppState>>>,
    input_path: String,
    operation_id: Option<String>,
) -> Result<FcworldImportPreview, String> {
    let progress = FcworldProgressTracker::new(
        FcworldProgressEmitter::new(Some(app), operation_id, "import"),
        0,
    );
    let result = async {
        let input_path_buf = PathBuf::from(&input_path);
        let state = state.inner().lock().await;
        let db = state.sqlite_db.lock().await;
        preview_fcworld_package(&db, &input_path_buf, progress.clone()).await
    }
    .await;

    match &result {
        Ok(_) => progress.done("导入预检完成"),
        Err(error) => progress.error(format!("导入预检失败：{error}")),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::{Cursor, Read};
    use tempfile::TempDir;
    use worldflow_core::{
        EntryOps, ProjectOps, SqliteDb, TagSchemaOps,
        models::{CreateEntry, CreateProject, CreateTagSchema, EntryFilter, EntryTag, FCImage},
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
        let database_url = format!(
            "sqlite:{}?mode=rwc",
            db_path.to_string_lossy().replace('\\', "/")
        );
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

    fn disabled_import_progress() -> FcworldProgressTracker {
        FcworldProgressTracker::new(FcworldProgressEmitter::disabled("import"), 0)
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
        let mut asset_progress = Vec::new();
        let package = prepare_fcworld_package_with_progress(&paths, project, export, |path| {
            asset_progress.push(path.to_string());
        })
        .expect("准备 fcworld 失败");
        assert_eq!(asset_progress.len(), package.asset_count);
        let output_path = temp.path().join("测试世界.fcworld");
        let mut zip_progress = Vec::new();
        write_fcworld_package_with_progress(&package, &output_path, |path| {
            zip_progress.push(path.to_string());
        })
        .expect("写入 fcworld 失败");
        assert_eq!(
            zip_progress.len(),
            1 + package.csv_items.len() + 1 + package.assets.len() + 1
        );

        let file = File::open(&output_path).expect("打开导出包失败");
        let mut zip = ZipArchive::new(file).expect("读取 zip 失败");
        let names = zip
            .file_names()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(names.contains(&"assets/index.json".to_string()));
        assert!(names.contains(&"maps/maps.json".to_string()));
        assert!(names.contains(&"data/worldflow/projects.csv".to_string()));
        assert!(names.contains(&"data/worldflow/entries.csv".to_string()));

        let manifest: Value = serde_json::from_str(&read_zip_text(&mut zip, "manifest.json"))
            .expect("解析 manifest 失败");
        assert_eq!(manifest["format"], FCWORLD_FORMAT);
        assert_eq!(manifest["contents"]["worldflow"]["schemaVersion"], 5);
        assert_eq!(manifest["contents"]["counts"]["entries"], 1);
        assert_eq!(manifest["contents"]["counts"]["images"], 4);
        assert_eq!(manifest["contents"]["maps"]["count"], 1);
        assert!(manifest["world"]["coverAssetId"].as_str().is_some());

        let assets_index: Value =
            serde_json::from_str(&read_zip_text(&mut zip, "assets/index.json"))
                .expect("解析资源索引失败");
        let assets = assets_index["assets"].as_array().expect("资源索引应为数组");
        assert_eq!(assets.len(), 4);
        for asset in assets {
            assert!(
                asset["path"]
                    .as_str()
                    .unwrap()
                    .starts_with("assets/images/")
            );
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

        let mut validation_steps = Vec::new();
        let validated = import::read_and_validate_fcworld_package_with_progress(
            &output_path,
            db.worldflow_schema_version(),
            |event| {
                if let import::FcworldPackageProgress::Step { phase, .. } = event {
                    validation_steps.push(phase.to_string());
                }
            },
        )
        .expect("导出包应通过导入校验");
        assert!(validation_steps.iter().any(|phase| phase == "validate_csv"));
        assert!(validation_steps.iter().any(|phase| phase == "validate_assets"));
        assert!(validation_steps.iter().any(|phase| phase == "validate_maps"));
        assert_eq!(
            validated.csv_items.len(),
            WorldflowCsvTable::ordered().len()
        );
        assert_eq!(validated.assets_index.assets.len(), 4);
        assert_eq!(validated.asset_bytes_by_path.len(), 4);
        assert_eq!(validated.manifest.package_id, package.package_id);
        assert_eq!(
            validated.input_file_size,
            std::fs::metadata(&output_path).unwrap().len()
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

    #[tokio::test]
    async fn rejects_tampered_maps_hash_on_import_validation() {
        let (temp, db, paths) = new_test_db("fcworld_tampered_maps").await;
        let project = db
            .create_project(CreateProject {
                name: "校验世界".to_string(),
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

        let mut package =
            prepare_fcworld_package(&paths, project, export).expect("准备 fcworld 失败");
        package.maps_json.push(' ');
        let output_path = temp.path().join("篡改地图.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let error =
            import::read_and_validate_fcworld_package(&output_path, db.worldflow_schema_version())
                .expect_err("篡改地图摘要后应拒绝导入");
        assert!(
            error.contains("maps/maps.json 摘要不匹配"),
            "实际错误: {error}"
        );
    }

    #[tokio::test]
    async fn prepares_import_with_new_ids_assets_and_maps() {
        let (temp, db, paths) = new_test_db("fcworld_prepare_import").await;
        let project = db
            .create_project(CreateProject {
                name: "引用世界".to_string(),
                description: None,
                cover_image: None,
            })
            .await
            .expect("创建项目失败");
        let tag_schema = db
            .create_tag_schema(CreateTagSchema {
                project_id: project.id,
                name: "阵营".to_string(),
                description: None,
                r#type: "string".to_string(),
                target: vec!["character".to_string()],
                default_val: None,
                range_min: None,
                range_max: None,
                sort_order: None,
            })
            .await
            .expect("创建标签失败");
        let target = db
            .create_entry(CreateEntry {
                project_id: project.id,
                category_id: None,
                title: "目标词条".to_string(),
                summary: None,
                content: Some("目标正文".to_string()),
                r#type: Some("character".to_string()),
                tags: None,
                images: None,
                cover_path: None,
            })
            .await
            .expect("创建目标词条失败");
        db.create_entry(CreateEntry {
            project_id: project.id,
            category_id: None,
            title: "来源词条".to_string(),
            summary: None,
            content: Some(format!("[目标](entry://{})", target.id)),
            r#type: Some("character".to_string()),
            tags: Some(vec![EntryTag {
                schema_id: tag_schema.id,
                value: json!("北境"),
            }]),
            images: None,
            cover_path: None,
        })
        .await
        .expect("创建来源词条失败");

        let map_dir = paths.db_path.parent().unwrap().join("maps");
        std::fs::create_dir_all(&map_dir).expect("创建地图目录失败");
        let data_url = png_data_url();
        let draft_json = serde_json::to_string(&json!({
            "shapes": [],
            "keyLocations": [{
                "id": "loc-1",
                "name": "地点",
                "type": "城市",
                "x": 10,
                "y": 20,
                "bizId": target.id.to_string(),
                "ext": {"linkedEntryId": target.id.to_string()}
            }]
        }))
        .expect("序列化地图草稿失败");
        let scene_json = serde_json::to_string(&json!({
            "canvas": {"width": 100, "height": 100},
            "shapes": [],
            "keyLocations": [{
                "id": "loc-1",
                "name": "地点",
                "type": "城市",
                "position": [10, 20],
                "color": [255, 0, 0, 255],
                "bizId": target.id.to_string(),
                "ext": {"linkedEntryId": target.id.to_string()}
            }],
            "backgroundImage": {"url": data_url, "fit": "cover"}
        }))
        .expect("序列化地图场景失败");
        std::fs::write(
            map_dir.join(format!("{}.json", project.id)),
            serde_json::to_string_pretty(&json!({
                "projectId": project.id.to_string(),
                "maps": [{
                    "id": "map-1",
                    "name": "引用地图",
                    "draftJson": draft_json,
                    "sceneJson": scene_json,
                    "coastlineParamsJson": null,
                    "style": "flat",
                    "backgroundImageUrl": data_url,
                    "createdAt": "2026-05-17T00:00:00Z",
                    "updatedAt": "2026-05-17T00:00:00Z"
                }]
            }))
            .expect("序列化地图文件失败"),
        )
        .expect("写入地图文件失败");

        let project = db.get_project(&project.id).await.expect("读取项目失败");
        let export = db
            .export_project_csvs(project.id)
            .await
            .expect("导出项目 CSV 失败");
        let package =
            prepare_fcworld_package(&paths, project.clone(), export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("引用世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let validated =
            import::read_and_validate_fcworld_package(&output_path, db.worldflow_schema_version())
                .expect("导出包应可校验");
        let prepared = import::prepare_fcworld_import(validated, &paths, "引用世界【导入】")
            .expect("导入数据应可重写");
        let new_target_id = prepared
            .id_maps
            .entries
            .get(&target.id.to_string())
            .expect("目标词条应生成新 ID");
        let new_schema_id = prepared
            .id_maps
            .tag_schemas
            .get(&tag_schema.id.to_string())
            .expect("标签应生成新 ID");
        let new_project_id = prepared.new_project_id.to_string();

        assert_ne!(new_project_id, project.id.to_string());
        assert_eq!(prepared.project_name, "引用世界【导入】");
        assert_eq!(prepared.map_count, 1);
        assert_eq!(prepared.asset_count, 1);
        assert!(prepared.assets.iter().all(|asset| {
            asset.target_path.starts_with(
                paths
                    .db_path
                    .parent()
                    .unwrap()
                    .join("images")
                    .join(&new_project_id),
            )
        }));

        let entries_csv = prepared
            .csv_items
            .iter()
            .find(|item| item.table == WorldflowCsvTable::Entries)
            .map(|item| item.content.as_str())
            .expect("应包含 entries.csv");
        assert!(entries_csv.contains(&format!("entry://{new_target_id}")));
        assert!(entries_csv.contains(new_schema_id));
        assert!(!entries_csv.contains(&target.id.to_string()));
        assert!(!entries_csv.contains(&tag_schema.id.to_string()));

        assert!(prepared.maps_json.contains(&new_project_id));
        assert!(prepared.maps_json.contains(new_target_id));
        assert!(prepared.maps_json.contains("data:image/png;base64"));
        assert!(!prepared.maps_json.contains(&target.id.to_string()));
        assert!(!prepared.maps_json.contains("assets/images/"));
    }

    #[tokio::test]
    async fn imports_fcworld_as_new_project_with_assets_and_empty_maps() {
        let (temp, db, paths) = new_test_db("fcworld_import_full").await;
        let image_dir = temp.path().join("images");
        let project_cover = image_dir.join("project-cover.png");
        let entry_image = image_dir.join("entry-image.png");
        let entry_cover = image_dir.join("entry-cover.png");
        create_image(&project_cover);
        create_image(&entry_image);
        create_image(&entry_cover);

        let project = db
            .create_project(CreateProject {
                name: "可导入世界".to_string(),
                description: Some("导入测试".to_string()),
                cover_image: Some(project_cover.to_string_lossy().to_string()),
            })
            .await
            .expect("创建项目失败");
        db.create_entry(CreateEntry {
            project_id: project.id,
            category_id: None,
            title: "角色".to_string(),
            summary: None,
            content: Some("正文".to_string()),
            r#type: Some("character".to_string()),
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

        let project = db.get_project(&project.id).await.expect("读取项目失败");
        let export = db
            .export_project_csvs(project.id)
            .await
            .expect("导出项目 CSV 失败");
        let package =
            prepare_fcworld_package(&paths, project.clone(), export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("可导入世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let result = import_fcworld_package_to_db(
            &db,
            &paths,
            &output_path,
            None,
            disabled_import_progress(),
        )
            .await
            .expect("导入 fcworld 失败");
        let new_project_id = Uuid::parse_str(&result.project_id).expect("新项目 ID 应合法");
        let imported_project = db.get_project(&new_project_id).await.expect("应写入新项目");
        assert_ne!(new_project_id, project.id);
        assert_eq!(imported_project.name, "可导入世界【导入】");
        assert_eq!(result.imported_rows.projects, 1);
        assert_eq!(result.imported_rows.entries, 1);
        assert_eq!(result.asset_count, 3);
        assert_eq!(result.map_count, 0);

        let import_image_dir = paths
            .db_path
            .parent()
            .unwrap()
            .join("images")
            .join(new_project_id.to_string());
        let cover_path = imported_project.cover_image.expect("项目封面应导入");
        assert!(Path::new(&cover_path).starts_with(&import_image_dir));
        assert!(Path::new(&cover_path).exists());

        let entries = db
            .list_entries(&new_project_id, EntryFilter::default(), 100, 0)
            .await
            .expect("读取导入词条列表失败");
        assert_eq!(entries.len(), 1);
        let imported_entry = db
            .get_entry(&entries[0].id)
            .await
            .expect("读取导入词条失败");
        assert_eq!(imported_entry.images.0.len(), 1);
        assert!(
            imported_entry.images.0[0]
                .path
                .starts_with(&import_image_dir)
        );
        assert!(imported_entry.images.0[0].path.exists());
        let imported_cover = imported_entry.cover_path.expect("词条封面应导入");
        assert!(Path::new(&imported_cover).starts_with(&import_image_dir));
        assert!(Path::new(&imported_cover).starts_with(import_image_dir.join("thumbs")));
        assert!(Path::new(&imported_cover).exists());

        let imported_maps_path = paths
            .db_path
            .parent()
            .unwrap()
            .join("maps")
            .join(format!("{new_project_id}.json"));
        let maps_json = std::fs::read_to_string(imported_maps_path).expect("应写入空地图文件");
        let maps_value: Value = serde_json::from_str(&maps_json).expect("地图文件应为 JSON");
        assert_eq!(maps_value["projectId"], new_project_id.to_string());
        assert_eq!(maps_value["maps"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn previews_duplicate_project_and_suggests_rename() {
        let (temp, db, paths) = new_test_db("fcworld_import_preview_duplicate").await;
        let project = db
            .create_project(CreateProject {
                name: "重名世界".to_string(),
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
        let package =
            prepare_fcworld_package(&paths, project.clone(), export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("重名世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let preview = preview_fcworld_package(&db, &output_path, disabled_import_progress())
            .await
            .expect("预览导入包失败");

        assert_eq!(preview.project_name, "重名世界");
        assert_eq!(preview.suggested_name, "重名世界【导入】");
        let duplicate = preview.duplicate_project.expect("应识别同名世界观");
        assert_eq!(duplicate.project_id, project.id.to_string());
        assert_eq!(duplicate.project_name, "重名世界");
    }

    #[tokio::test]
    async fn imports_duplicate_project_with_custom_rename() {
        let (temp, db, paths) = new_test_db("fcworld_import_custom_rename").await;
        let project = db
            .create_project(CreateProject {
                name: "可重命名世界".to_string(),
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
        let package =
            prepare_fcworld_package(&paths, project.clone(), export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("可重命名世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let result = import_fcworld_package_to_db(
            &db,
            &paths,
            &output_path,
            Some(FcworldImportOptions {
                mode: FcworldImportMode::Rename,
                project_name: Some("用户指定导入名".to_string()),
                overwrite_project_id: None,
            }),
            disabled_import_progress(),
        )
        .await
        .expect("重命名导入失败");
        let imported_id = Uuid::parse_str(&result.project_id).expect("新项目 ID 应合法");
        let imported = db.get_project(&imported_id).await.expect("应写入新项目");

        assert_ne!(imported_id, project.id);
        assert_eq!(imported.name, "用户指定导入名");
        assert!(db.get_project(&project.id).await.is_ok());
    }

    #[tokio::test]
    async fn overwrites_duplicate_project_after_successful_import() {
        let (temp, db, paths) = new_test_db("fcworld_import_overwrite").await;
        let project = db
            .create_project(CreateProject {
                name: "覆盖世界".to_string(),
                description: None,
                cover_image: None,
            })
            .await
            .expect("创建项目失败");
        db.create_entry(CreateEntry {
            project_id: project.id,
            category_id: None,
            title: "旧词条".to_string(),
            summary: None,
            content: Some("将被覆盖导入替换".to_string()),
            r#type: None,
            tags: None,
            images: None,
            cover_path: None,
        })
        .await
        .expect("创建词条失败");
        let project = db.get_project(&project.id).await.expect("读取项目失败");
        let export = db
            .export_project_csvs(project.id)
            .await
            .expect("导出项目 CSV 失败");
        let package =
            prepare_fcworld_package(&paths, project.clone(), export).expect("准备 fcworld 失败");
        let output_path = temp.path().join("覆盖世界.fcworld");
        write_fcworld_package(&package, &output_path).expect("写入 fcworld 失败");

        let result = import_fcworld_package_to_db(
            &db,
            &paths,
            &output_path,
            Some(FcworldImportOptions {
                mode: FcworldImportMode::Overwrite,
                project_name: None,
                overwrite_project_id: Some(project.id.to_string()),
            }),
            disabled_import_progress(),
        )
        .await
        .expect("覆盖导入失败");
        let imported_id = Uuid::parse_str(&result.project_id).expect("新项目 ID 应合法");
        let imported = db.get_project(&imported_id).await.expect("应写入新项目");

        assert_ne!(imported_id, project.id);
        assert_eq!(imported.name, "覆盖世界");
        assert!(db.get_project(&project.id).await.is_err());
        let projects = db.list_projects().await.expect("读取项目列表失败");
        assert_eq!(
            projects
                .iter()
                .filter(|project| project.name == "覆盖世界")
                .count(),
            1
        );
        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.contains("已覆盖原世界观"))
        );
    }
}
