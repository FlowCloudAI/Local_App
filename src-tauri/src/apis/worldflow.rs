use crate::{AppState, NetworkState, PathsState};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State, Window};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use uuid::Uuid;
use worldflow_core::{models::*, AppendResult, CategoryOps, EntryLinkOps, EntryOps, EntryRelationOps, EntryTypeOps, IdeaNoteOps, ProjectOps, SnapshotInfo, SqliteDb, TagSchemaOps};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimelineTagRole {
    Start,
    End,
    Parent,
    Show,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineEvent {
    pub id: String,
    pub title: String,
    pub start_time: i32,
    pub end_time: Option<i32>,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub entry_type: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineData {
    pub events: Vec<ProjectTimelineEvent>,
    pub year_start: Option<i32>,
    pub year_end: Option<i32>,
    pub scanned_entry_count: usize,
    pub matched_entry_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub image_count: usize,
    pub word_count: usize,
}

struct DefaultTimelineTagDefinition {
    name: &'static str,
    description: &'static str,
    value_type: &'static str,
    default_value: Option<&'static str>,
    range_min: Option<f64>,
    range_max: Option<f64>,
    sort_order: i64,
}

const DEFAULT_TIMELINE_TAG_TARGETS: &[&str] = &["event"];

const DEFAULT_TIMELINE_TAG_DEFINITIONS: &[DefaultTimelineTagDefinition] = &[
    DefaultTimelineTagDefinition {
        name: "开始年份",
        description: "事件在时间线上的起始年份。公元前年份请填写负数，例如 -221。",
        value_type: "number",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 0,
    },
    DefaultTimelineTagDefinition {
        name: "结束年份",
        description: "事件结束年份；若留空则视为单点事件。",
        value_type: "number",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 1,
    },
    DefaultTimelineTagDefinition {
        name: "父事件ID",
        description: "用于把事件挂到上层事件下，可填写父事件词条 ID 或标题。",
        value_type: "string",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 2,
    },
    DefaultTimelineTagDefinition {
        name: "时间线",
        description: "是否在项目时间线中显示该事件。",
        value_type: "boolean",
        default_value: Some("true"),
        range_min: None,
        range_max: None,
        sort_order: 3,
    },
];

fn normalize_timeline_tag_name(name: &str) -> String {
    name.trim()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '\t' | '\r' | '\n' | '_' | '-'))
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn timeline_tag_role_from_name(name: &str) -> Option<TimelineTagRole> {
    match normalize_timeline_tag_name(name).as_str() {
        "start" | "startyear" | "starttime" | "year" | "年份" | "开始" | "开始年"
        | "开始年份" | "开始时间" | "起始" | "起始年" | "起始年份" | "起始时间" => {
            Some(TimelineTagRole::Start)
        }
        "end" | "endyear" | "endtime" | "结束" | "结束年" | "结束年份" | "结束时间"
        | "终止" | "终止年" | "终止年份" | "终止时间" => Some(TimelineTagRole::End),
        "parent" | "parentid" | "父事件" | "父级事件" | "父事件id" | "父级事件id"
        | "上级事件" | "上级事件id" => Some(TimelineTagRole::Parent),
        "timeline" | "ontimeline" | "showtimeline" | "时间线" | "纳入时间线"
        | "显示在时间线" | "显示时间线" => Some(TimelineTagRole::Show),
        _ => None,
    }
}

fn parse_timeline_year_from_str(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = trimmed.parse::<i32>() {
        return Some(value);
    }

    let normalized = trimmed.replace(' ', "").to_lowercase();
    let negative = normalized.contains("公元前")
        || normalized.contains("前")
        || normalized.contains("bc")
        || normalized.contains("bce");

    let digits = normalized
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect::<String>();

    if digits.is_empty() {
        return None;
    }

    let parsed = digits.parse::<i32>().ok()?;
    if negative && parsed > 0 {
        Some(-parsed)
    } else {
        Some(parsed)
    }
}

fn parse_timeline_year(value: &Value) -> Option<i32> {
    match value {
        Value::Number(number) => number.as_i64().and_then(|value| i32::try_from(value).ok()),
        Value::String(text) => parse_timeline_year_from_str(text),
        _ => None,
    }
}

fn parse_timeline_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => match text.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" | "是" | "显示" | "加入" => Some(true),
            "false" | "0" | "no" | "n" | "off" | "否" | "隐藏" | "移除" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn parse_timeline_parent(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

async fn initialize_default_timeline_tags(db: &SqliteDb, project_id: &Uuid) -> Result<(), String> {
    let targets = DEFAULT_TIMELINE_TAG_TARGETS
        .iter()
        .map(|target| (*target).to_string())
        .collect::<Vec<_>>();

    for definition in DEFAULT_TIMELINE_TAG_DEFINITIONS {
        db.create_tag_schema(CreateTagSchema {
            project_id: *project_id,
            name: definition.name.to_string(),
            description: Some(definition.description.to_string()),
            r#type: definition.value_type.to_string(),
            target: targets.clone(),
            default_val: definition.default_value.map(|value| value.to_string()),
            range_min: definition.range_min,
            range_max: definition.range_max,
            sort_order: Some(definition.sort_order),
        })
            .await
            .map_err(|error| format!("初始化默认时间线标签“{}”失败: {}", definition.name, error))?;
    }

    Ok(())
}

// ============ Logging & Window ============

/// 前端日志桥接，将日志写入后端日志系统
#[tauri::command]
pub fn log_message(level: &str, message: &str) {
    match level {
        "info" => log::info!("{}", message),
        "error" => log::error!("{}", message),
        "debug" => log::debug!("{}", message),
        "warn" => log::warn!("{}", message),
        _ => log::debug!("{}", message),
    }
}

/// 显示主窗口（前端加载完成后调用）
#[tauri::command]
pub fn show_main_window(window: Window) -> Result<&'static str, &'static str> {
    #[cfg(desktop)]
    {
        match window.show() {
            Ok(_) => {}
            Err(_) => return Err("failed to show the window"),
        };
    }
    unsafe {
        env::set_var("TAURI_DEBUG", "1");
    }
    Ok("open the window")
}

async fn touch_project_updated_at(db: &SqliteDb, project_id: &Uuid) -> Result<(), String> {
    db.update_project(
        project_id,
        UpdateProject {
            name: None,
            description: None,
            cover_image: None,
        },
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn build_entry_images_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("images").join(project_id.to_string()))
}

fn canonical_images_root(paths: &PathsState) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    let images_root = db_dir.join("images");
    std::fs::canonicalize(&images_root)
        .map_err(|e| format!("无法解析图片根目录 {:?}: {}", images_root, e))
}

fn ensure_image_path_allowed(paths: &PathsState, path: &Path) -> Result<PathBuf, String> {
    let canonical_requested =
        std::fs::canonicalize(path).map_err(|e| format!("无法访问图片路径 {:?}: {}", path, e))?;
    let canonical_root = canonical_images_root(paths)?;

    if !canonical_requested.starts_with(&canonical_root) {
        return Err(format!("图片路径不在允许范围内: {:?}", canonical_requested));
    }

    Ok(canonical_requested)
}

fn should_keep_existing_image(path: &Path, target_dir: &Path) -> bool {
    path.starts_with(target_dir)
}

#[tauri::command]
pub fn open_entry_image_path(
    app: AppHandle,
    paths: State<'_, PathsState>,
    path: String,
) -> Result<(), String> {
    let allowed_path = ensure_image_path_allowed(paths.inner(), Path::new(&path))?;
    let folder_path = allowed_path
        .parent()
        .ok_or_else(|| format!("无法解析图片所在文件夹: {:?}", allowed_path))?;
    app.opener()
        .open_path(folder_path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|e| format!("打开图片所在文件夹失败: {}", e))
}

fn copy_entry_images(
    paths: &PathsState,
    project_id: &Uuid,
    images: Option<Vec<FCImage>>,
) -> Result<Option<Vec<FCImage>>, String> {
    let Some(images) = images else {
        return Ok(None);
    };

    let target_dir = build_entry_images_dir(paths, project_id)?;
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("创建图片目录失败 {:?}: {}", target_dir, e))?;

    let copied_images = images
        .into_iter()
        .map(|mut image| {
            if image.path.as_os_str().is_empty() {
                return Ok(image);
            }

            let source_path = image.path.clone();
            if should_keep_existing_image(&source_path, &target_dir) {
                return Ok(image);
            }
            if !source_path.exists() {
                return Err(format!("图片文件不存在: {:?}", source_path));
            }

            let extension = source_path
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|ext| !ext.is_empty());
            let file_name = match extension {
                Some(ext) => format!("{}.{}", Uuid::new_v4(), ext),
                None => Uuid::new_v4().to_string(),
            };
            let target_path = target_dir.join(file_name);

            std::fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "复制图片失败: {:?} -> {:?}, {}",
                    source_path, target_path, e
                )
            })?;

            image.path = target_path;
            Ok(image)
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(Some(copied_images))
}

#[tauri::command]
pub fn import_entry_images(
    paths: State<'_, PathsState>,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let images = file_paths
        .into_iter()
        .map(|path| {
            let path_buf = PathBuf::from(&path);
            FCImage {
                path: path_buf,
                is_cover: false,
                caption: None,
            }
        })
        .collect::<Vec<_>>();

    Ok(copy_entry_images(paths.inner(), &project_id, Some(images))?.unwrap_or_default())
}

// ============ Projects ============

/// 创建项目
#[tauri::command]
pub async fn db_create_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    name: String,
    description: Option<String>,
    cover_image: Option<String>,
) -> Result<Project, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let project = db.create_project(CreateProject {
        name,
        description,
        cover_image,
    })
    .await
        .map_err(|e| e.to_string())?;

    if let Err(error) = initialize_default_timeline_tags(&db, &project.id).await {
        if let Err(cleanup_error) = db.delete_project(&project.id).await {
            log::error!(
                "[worldflow] 创建项目默认时间线标签失败，且回滚项目失败: project_id={} error={} cleanup_error={}",
                project.id,
                error,
                cleanup_error
            );
            return Err(format!(
                "{}；同时回滚项目失败，请手动检查该项目是否已创建。",
                error
            ));
        }

        return Err(error);
    }

    Ok(project)
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<Project>, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
}

/// 更新项目信息
#[tauri::command]
pub async fn db_update_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    cover_image: Option<Option<String>>,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.update_project(
        &id,
        UpdateProject {
            name,
            description,
            cover_image,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.delete_project(&id).await.map_err(|e| e.to_string())
}

// ============ Categories ============

/// 创建分类；parent_id 为 None 时创建根节点
#[tauri::command]
pub async fn db_create_category(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    parent_id: Option<String>,
    name: String,
    sort_order: Option<i64>,
) -> Result<Category, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let parent_id = parent_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category = db
        .create_category(CreateCategory {
            project_id,
            parent_id,
            name,
            sort_order,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &category.project_id).await?;
    Ok(category)
}

/// 查询单个分类
#[tauri::command]
pub async fn db_get_category(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<Category, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_category(&id).await.map_err(|e| e.to_string())
}

/// 查询项目下所有分类（按树序排列）
#[tauri::command]
pub async fn db_list_categories(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<Vec<Category>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新分类；parent_id: Some(Some(id)) = 移到新父节点，Some(None) = 移到根节点，None = 不变
#[tauri::command]
pub async fn db_update_category(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    parent_id: Option<Option<String>>,
    name: Option<String>,
    sort_order: Option<i64>,
) -> Result<Category, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let parent_id = parent_id
        .map(|opt| {
            opt.map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
                .transpose()
        })
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category = db
        .update_category(
            &id,
            UpdateCategory {
                parent_id,
                name,
                sort_order,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &category.project_id).await?;
    Ok(category)
}

/// 删除分类
#[tauri::command]
pub async fn db_delete_category(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category = db.get_category(&id).await.map_err(|e| e.to_string())?;
    db.delete_category(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &category.project_id).await
}

// ============ Entries ============

/// 创建词条
#[tauri::command]
pub async fn db_create_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    project_id: String,
    category_id: Option<String>,
    title: String,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let images = copy_entry_images(paths.inner(), &project_id, images)?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry = db
        .create_entry(CreateEntry {
            project_id,
            category_id,
            title,
            summary,
            content,
            r#type,
            tags,
            images,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    Ok(entry)
}

/// 获取完整词条（含 content、tags、images）
#[tauri::command]
pub async fn db_get_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<Entry, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_entry(&id).await.map_err(|e| e.to_string())
}

/// 分页列出词条简报（不含 content）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_list_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_list_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} offset={}",
        project_id,
        category_id,
        entry_type,
        limit,
        offset
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    let result = db
        .list_entries(
            &project_id,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
            offset,
        )
        .await;

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_list_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_list_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 聚合项目内带时间标签的词条，输出时间线事件数据
#[tauri::command]
pub async fn db_list_timeline_events(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<ProjectTimelineData, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    let tag_schemas = db
        .list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let schema_role_map = tag_schemas
        .iter()
        .filter_map(|schema| timeline_tag_role_from_name(&schema.name).map(|role| (schema.id, role)))
        .collect::<std::collections::HashMap<_, _>>();

    let mut entry_briefs = Vec::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: None,
                },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        offset += batch_len;
        entry_briefs.extend(batch);

        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let scanned_entry_count = entry_briefs.len();
    let mut events = Vec::new();

    for brief in entry_briefs {
        let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
        let mut start_time = None;
        let mut end_time = None;
        let mut parent_id = None;
        let mut show_on_timeline = None;

        for tag in &entry.tags.0 {
            let Some(role) = schema_role_map.get(&tag.schema_id).copied() else {
                continue;
            };

            match role {
                TimelineTagRole::Start => {
                    if start_time.is_none() {
                        start_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::End => {
                    if end_time.is_none() {
                        end_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::Parent => {
                    if parent_id.is_none() {
                        parent_id = parse_timeline_parent(&tag.value);
                    }
                }
                TimelineTagRole::Show => {
                    if show_on_timeline.is_none() {
                        show_on_timeline = parse_timeline_bool(&tag.value);
                    }
                }
            }
        }

        let Some(start_time) = start_time else {
            continue;
        };

        if matches!(show_on_timeline, Some(false)) {
            continue;
        }

        let (start_time, end_time) = match end_time {
            Some(end_time) if end_time < start_time => (end_time, Some(start_time)),
            Some(end_time) => (start_time, Some(end_time)),
            None => (start_time, None),
        };

        events.push(ProjectTimelineEvent {
            id: entry.id.to_string(),
            title: entry.title.clone(),
            start_time,
            end_time,
            description: entry.summary.clone(),
            parent_id,
            entry_type: entry.r#type.clone(),
            category_id: entry.category_id.map(|category_id| category_id.to_string()),
        });
    }

    let title_to_id = events
        .iter()
        .map(|event| (normalize_timeline_tag_name(&event.title), event.id.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let valid_ids = events
        .iter()
        .map(|event| event.id.clone())
        .collect::<std::collections::HashSet<_>>();

    for event in &mut events {
        let resolved_parent = event.parent_id.as_ref().and_then(|parent| {
            if valid_ids.contains(parent) {
                Some(parent.clone())
            } else {
                title_to_id.get(&normalize_timeline_tag_name(parent)).cloned()
            }
        });

        event.parent_id = match resolved_parent {
            Some(parent_id) if parent_id != event.id => Some(parent_id),
            _ => None,
        };
    }

    events.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| left.end_time.unwrap_or(left.start_time).cmp(&right.end_time.unwrap_or(right.start_time)))
            .then_with(|| left.title.cmp(&right.title))
    });

    let year_start = events.iter().map(|event| event.start_time).min();
    let year_end = events
        .iter()
        .map(|event| event.end_time.unwrap_or(event.start_time))
        .max();

    Ok(ProjectTimelineData {
        matched_entry_count: events.len(),
        scanned_entry_count,
        year_start,
        year_end,
        events,
    })
}

/// 统计项目图片总数和总字数
#[tauri::command]
pub async fn db_get_project_stats(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<ProjectStats, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    let mut image_count = 0usize;
    let mut word_count = 0usize;
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter { category_id: None, entry_type: None },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        for brief in &batch {
            let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
            image_count += entry.images.0.len();
            word_count += entry.content.chars().count();
        }

        offset += batch_len;
        if batch_len < PAGE_SIZE {
            break;
        }
    }

    Ok(ProjectStats { image_count, word_count })
}

/// 全文搜索词条（FTS）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_search_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    query: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_search_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} query={:?}",
        project_id,
        category_id,
        entry_type,
        limit,
        query
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    let result = db
        .search_entries(
            &project_id,
            &query,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
        )
        .await;

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_search_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_search_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 统计词条数量；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_count_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
) -> Result<i64, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    db.count_entries(
        &project_id,
        EntryFilter {
            category_id: category_id_ref,
            entry_type: entry_type.as_deref(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条；仅传入需要修改的字段，None 表示不变
#[tauri::command]
pub async fn db_update_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    id: String,
    category_id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let current_entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    let images = copy_entry_images(paths.inner(), &current_entry.project_id, images)?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let entry = db
        .update_entry(
            &id,
            UpdateEntry {
                category_id: Some(category_id),
                title,
                summary,
                content,
                r#type: Some(r#type),
                tags,
                images,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    Ok(entry)
}

/// 删除词条
#[tauri::command]
pub async fn db_delete_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    db.delete_entry(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &entry.project_id).await
}

/// 批量创建词条；返回成功插入的条数
#[tauri::command]
pub async fn db_create_entries_bulk(
    state: State<'_, Arc<Mutex<AppState>>>,
    entries: Vec<CreateEntry>,
) -> Result<usize, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let project_ids = entries
        .iter()
        .map(|entry| entry.project_id)
        .collect::<BTreeSet<_>>();

    let count = db
        .create_entries_bulk(entries)
        .await
        .map_err(|e| e.to_string())?;

    for project_id in project_ids {
        touch_project_updated_at(&db, &project_id).await?;
    }

    Ok(count)
}

/// 优化 FTS 索引，消除碎片；建议在 create_entries_bulk 后调用
#[tauri::command]
pub async fn db_optimize_fts(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.optimize_fts().await.map_err(|e| e.to_string())
}

// ============ Tag Schemas ============

/// 创建标签定义；type 可为 "number" / "string" / "boolean"
#[tauri::command]
pub async fn db_create_tag_schema(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    name: String,
    description: Option<String>,
    r#type: String,
    target: Vec<String>,
    default_val: Option<String>,
    range_min: Option<f64>,
    range_max: Option<f64>,
    sort_order: Option<i64>,
) -> Result<TagSchema, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let schema = db
        .create_tag_schema(CreateTagSchema {
            project_id,
            name,
            description,
            r#type,
            target,
            default_val,
            range_min,
            range_max,
            sort_order,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &schema.project_id).await?;
    Ok(schema)
}

/// 查询单个标签定义
#[tauri::command]
pub async fn db_get_tag_schema(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<TagSchema, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_tag_schema(&id).await.map_err(|e| e.to_string())
}

/// 查询项目下所有标签定义
#[tauri::command]
pub async fn db_list_tag_schemas(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<Vec<TagSchema>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新标签定义（全量替换）
#[tauri::command]
pub async fn db_update_tag_schema(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    project_id: String,
    name: String,
    description: Option<String>,
    r#type: String,
    target: Vec<String>,
    default_val: Option<String>,
    range_min: Option<f64>,
    range_max: Option<f64>,
    sort_order: Option<i64>,
) -> Result<TagSchema, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let schema = db
        .update_tag_schema(
            &id,
            CreateTagSchema {
                project_id,
                name,
                description,
                r#type,
                target,
                default_val,
                range_min,
                range_max,
                sort_order,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &schema.project_id).await?;
    Ok(schema)
}

/// 删除标签定义
#[tauri::command]
pub async fn db_delete_tag_schema(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let schema = db.get_tag_schema(&id).await.map_err(|e| e.to_string())?;
    db.delete_tag_schema(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &schema.project_id).await
}

// ============ Entry Relations ============

/// 创建词条关系；relation 为 "OneWay"（单向）或 "TwoWay"（双向）
#[tauri::command]
pub async fn db_create_relation(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    a_id: String,
    b_id: String,
    relation: RelationDirection,
    content: String,
) -> Result<EntryRelation, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let a_id = Uuid::parse_str(&a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(&b_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let relation = db
        .create_relation(CreateEntryRelation {
            project_id,
            a_id,
            b_id,
            relation,
            content,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &relation.project_id).await?;
    Ok(relation)
}

/// 查询单条词条关系
#[tauri::command]
pub async fn db_get_relation(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_relation(&id).await.map_err(|e| e.to_string())
}

/// 查询某词条的所有关系（含双向）
#[tauri::command]
pub async fn db_list_relations_for_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 查询项目下所有词条关系（用于构建关系图）
#[tauri::command]
pub async fn db_list_relations_for_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新词条关系的方向或描述内容
#[tauri::command]
pub async fn db_update_relation(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    relation: Option<RelationDirection>,
    content: Option<String>,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let relation = db
        .update_relation(&id, UpdateEntryRelation { relation, content })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &relation.project_id).await?;
    Ok(relation)
}

/// 删除单条词条关系
#[tauri::command]
pub async fn db_delete_relation(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let relation = db.get_relation(&id).await.map_err(|e| e.to_string())?;
    db.delete_relation(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &relation.project_id).await
}

/// 删除两个词条之间的所有关系；返回删除的条数
#[tauri::command]
pub async fn db_delete_relations_between(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_a_id: String,
    entry_b_id: String,
) -> Result<u64, String> {
    let entry_a_id = Uuid::parse_str(&entry_a_id).map_err(|e| e.to_string())?;
    let entry_b_id = Uuid::parse_str(&entry_b_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry = db.get_entry(&entry_a_id).await.map_err(|e| e.to_string())?;
    let deleted = db
        .delete_relations_between(&entry_a_id, &entry_b_id)
        .await
        .map_err(|e| e.to_string())?;

    if deleted > 0 {
        touch_project_updated_at(&db, &entry.project_id).await?;
    }

    Ok(deleted)
}

// ============ Entry Types ============

/// 列出项目内所有词条类型（9 个内置 + 自定义）
#[tauri::command]
pub async fn db_list_all_entry_types(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<Vec<EntryTypeView>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 列出项目内自定义词条类型
#[tauri::command]
pub async fn db_list_custom_entry_types(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<Vec<CustomEntryType>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_custom_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 创建自定义词条类型
#[tauri::command]
pub async fn db_create_entry_type(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<CustomEntryType, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry_type = db
        .create_entry_type(CreateCustomEntryType {
            project_id,
            name,
            description,
            icon,
            color,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry_type.project_id).await?;
    Ok(entry_type)
}

/// 获取单个自定义词条类型
#[tauri::command]
pub async fn db_get_entry_type(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<CustomEntryType, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_entry_type(&id).await.map_err(|e| e.to_string())
}

/// 更新自定义词条类型；description/icon/color 使用 Option<Option<T>> 模式（None=不更新，Some(None)=清空）
#[tauri::command]
pub async fn db_update_entry_type(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    icon: Option<Option<String>>,
    color: Option<Option<String>>,
) -> Result<CustomEntryType, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry_type = db
        .update_entry_type(
            &id,
            UpdateCustomEntryType {
                name,
                description,
                icon,
                color,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry_type.project_id).await?;
    Ok(entry_type)
}

/// 删除自定义词条类型（有词条引用时拒绝删除）
#[tauri::command]
pub async fn db_delete_entry_type(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry_type = db.get_entry_type(&id).await.map_err(|e| e.to_string())?;
    db.delete_entry_type(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &entry_type.project_id).await
}

// ============ Entry Links ============

/// 创建单向词条链接
#[tauri::command]
pub async fn db_create_entry_link(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    a_id: String,
    b_id: String,
) -> Result<EntryLink, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let a_id = Uuid::parse_str(&a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(&b_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let link = db
        .create_link(CreateEntryLink {
            project_id,
            a_id,
            b_id,
        })
        .await
        .map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &link.project_id).await?;
    Ok(link)
}

/// 获取词条的出链列表
#[tauri::command]
pub async fn db_list_outgoing_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<Vec<EntryLink>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_outgoing_links(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取词条的入链列表（反向链接）
#[tauri::command]
pub async fn db_list_incoming_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<Vec<EntryLink>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_incoming_links(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 删除词条的所有出链
#[tauri::command]
pub async fn db_delete_links_from_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<u64, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let current_entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;
    let deleted = db
        .delete_links_from_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    if deleted > 0 {
        touch_project_updated_at(&db, &current_entry.project_id).await?;
    }
    Ok(deleted)
}

/// 替换词条的所有出链（先删除旧链接，再批量创建新链接）
#[tauri::command]
pub async fn db_replace_outgoing_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    entry_id: String,
    linked_entry_ids: Vec<String>,
) -> Result<Vec<EntryLink>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let linked_entry_ids = linked_entry_ids
        .into_iter()
        .map(|id| Uuid::parse_str(&id).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, String>>()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let links = db
        .replace_outgoing_links(&project_id, &entry_id, &linked_entry_ids)
        .await
        .map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &project_id).await?;
    Ok(links)
}

// ============ Idea Notes ============

/// 创建灵感便签
#[tauri::command]
pub async fn db_create_idea_note(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: Option<String>,
    content: String,
    title: Option<String>,
    pinned: Option<bool>,
) -> Result<IdeaNote, String> {
    let project_id = project_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.create_idea_note(CreateIdeaNote {
        project_id,
        content,
        title,
        pinned,
    })
        .await
        .map_err(|e| e.to_string())
}

/// 获取单条灵感便签
#[tauri::command]
pub async fn db_get_idea_note(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<IdeaNote, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_idea_note(&id).await.map_err(|e| e.to_string())
}

/// 查询灵感便签列表
#[tauri::command]
pub async fn db_list_idea_notes(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: Option<String>,
    only_global: Option<bool>,
    status: Option<IdeaNoteStatus>,
    pinned: Option<bool>,
    limit: usize,
    offset: usize,
) -> Result<Vec<IdeaNote>, String> {
    if project_id.is_some() && only_global.unwrap_or(false) {
        return Err("project_id 与 only_global 不能同时设置".to_string());
    }

    let project_id = project_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    db.list_idea_notes(
        IdeaNoteFilter {
            project_id: project_id.as_ref(),
            only_global: only_global.unwrap_or(false),
            status: status.as_ref(),
            pinned,
        },
        limit,
        offset,
    )
        .await
        .map_err(|e| e.to_string())
}

/// 更新灵感便签
#[tauri::command]
pub async fn db_update_idea_note(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    project_id: Option<Option<String>>,
    title: Option<Option<String>>,
    content: Option<String>,
    status: Option<IdeaNoteStatus>,
    pinned: Option<bool>,
    last_reviewed_at: Option<Option<String>>,
    converted_entry_id: Option<Option<String>>,
) -> Result<IdeaNote, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = project_id
        .map(|value| {
            value
                .map(|project_id| Uuid::parse_str(&project_id).map_err(|e| e.to_string()))
                .transpose()
        })
        .transpose()?;
    let converted_entry_id = converted_entry_id
        .map(|value| {
            value
                .map(|entry_id| Uuid::parse_str(&entry_id).map_err(|e| e.to_string()))
                .transpose()
        })
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    db.update_idea_note(
        &id,
        UpdateIdeaNote {
            project_id,
            title,
            content,
            status,
            pinned,
            last_reviewed_at,
            converted_entry_id,
        },
    )
        .await
        .map_err(|e| e.to_string())
}

/// 删除灵感便签
#[tauri::command]
pub async fn db_delete_idea_note(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.delete_idea_note(&id).await.map_err(|e| e.to_string())
}

// ============ Snapshots ============

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfoDto {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}

impl From<SnapshotInfo> for SnapshotInfoDto {
    fn from(s: SnapshotInfo) -> Self {
        Self { id: s.id, message: s.message, timestamp: s.timestamp }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppendResultDto {
    pub projects: usize,
    pub categories: usize,
    pub entries: usize,
    pub tag_schemas: usize,
    pub relations: usize,
    pub links: usize,
    pub entry_types: usize,
    pub idea_notes: usize,
}

impl From<AppendResult> for AppendResultDto {
    fn from(r: AppendResult) -> Self {
        Self {
            projects: r.projects,
            categories: r.categories,
            entries: r.entries,
            tag_schemas: r.tag_schemas,
            relations: r.relations,
            links: r.links,
            entry_types: r.entry_types,
            idea_notes: r.idea_notes,
        }
    }
}

/// 手动触发一次快照（消息前缀 "manual <unix_secs>"）
#[tauri::command]
pub async fn db_snapshot(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.snapshot().await.map_err(|e| e.to_string())
}

/// 列出所有历史快照，最新的在 index 0
#[tauri::command]
pub async fn db_list_snapshots(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_snapshots()
        .await
        .map(|list| list.into_iter().map(SnapshotInfoDto::from).collect())
        .map_err(|e| e.to_string())
}

/// 回退到指定快照（先自动保存 pre-rollback 快照，再全量替换数据库）
#[tauri::command]
pub async fn db_rollback_to(
    state: State<'_, Arc<Mutex<AppState>>>,
    snapshot_id: String,
) -> Result<(), String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.rollback_to(&snapshot_id).await.map_err(|e| e.to_string())
}

/// 追加恢复：把历史快照里有、当前 DB 没有的记录补回来（非破坏性）
#[tauri::command]
pub async fn db_append_from(
    state: State<'_, Arc<Mutex<AppState>>>,
    snapshot_id: String,
) -> Result<AppendResultDto, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.append_from(&snapshot_id)
        .await
        .map(AppendResultDto::from)
        .map_err(|e| e.to_string())
}

/// 下载远程图片到本地 images 目录
#[tauri::command]
pub async fn import_remote_images(
    paths: State<'_, PathsState>,
    network: State<'_, NetworkState>,
    project_id: String,
    urls: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let _project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;

    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| "invalid db path".to_string())?
        .join("images");
    std::fs::create_dir_all(&images_root).map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for (i, url) in urls.into_iter().enumerate() {
        // 清洗 URL：移除查询参数，提取纯净扩展名
        let clean_url = url.split('?').next().unwrap_or(&url);
        let ext = clean_url
            .split('.')
            .last()
            .unwrap_or("png");

        // 清洗文件名：移除 Windows 非法字符
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let filename = format!("remote_{}_{}.{}",
                               timestamp,
                               i, ext);
        let local_path = images_root.join(&filename);

        let bytes = network
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        std::fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;

        images.push(FCImage {
            path: local_path,
            is_cover: false,
            caption: None,
        });
    }
    Ok(images)
}
