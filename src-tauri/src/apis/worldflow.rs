use crate::{AppState, PathsState};
use std::collections::BTreeSet;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State, Window};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use uuid::Uuid;
use worldflow_core::{
    CategoryOps, EntryLinkOps, EntryOps, EntryRelationOps, EntryTypeOps, ProjectOps, SqliteDb,
    TagSchemaOps, models::*,
};

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
    db.create_project(CreateProject {
        name,
        description,
        cover_image,
    })
    .await
    .map_err(|e| e.to_string())
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
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id_ref,
            entry_type: entry_type.as_deref(),
        },
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
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
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    db.search_entries(
        &project_id,
        &query,
        EntryFilter {
            category_id: category_id_ref,
            entry_type: entry_type.as_deref(),
        },
        limit,
    )
    .await
    .map_err(|e| e.to_string())
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
