use crate::AppState;
use std::env;
use tauri::{State, Window};
use worldflow_core::{
    CategoryOps, EntryOps, EntryRelationOps, ProjectOps, TagSchemaOps, models::*,
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

// ============ Projects ============

/// 创建项目
#[tauri::command]
pub async fn db_create_project(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.create_project(CreateProject { name, description })
        .await
        .map_err(|e| e.to_string())
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(state: State<'_, AppState>, id: String) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
}

/// 更新项目信息
#[tauri::command]
pub async fn db_update_project(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.update_project(&id, UpdateProject { name, description })
        .await
        .map_err(|e| e.to_string())
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_project(&id).await.map_err(|e| e.to_string())
}

// ============ Categories ============

/// 创建分类；parent_id 为 None 时创建根节点
#[tauri::command]
pub async fn db_create_category(
    state: State<'_, AppState>,
    project_id: String,
    parent_id: Option<String>,
    name: String,
    sort_order: Option<i64>,
) -> Result<Category, String> {
    let db = state.sqlite_db.lock().await;
    db.create_category(CreateCategory {
        project_id,
        parent_id,
        name,
        sort_order,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 查询单个分类
#[tauri::command]
pub async fn db_get_category(state: State<'_, AppState>, id: String) -> Result<Category, String> {
    let db = state.sqlite_db.lock().await;
    db.get_category(&id).await.map_err(|e| e.to_string())
}

/// 查询项目下所有分类（按树序排列）
#[tauri::command]
pub async fn db_list_categories(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Category>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新分类；parent_id: Some(Some(id)) = 移到新父节点，Some(None) = 移到根节点，None = 不变
#[tauri::command]
pub async fn db_update_category(
    state: State<'_, AppState>,
    id: String,
    parent_id: Option<Option<String>>,
    name: Option<String>,
    sort_order: Option<i64>,
) -> Result<Category, String> {
    let db = state.sqlite_db.lock().await;
    db.update_category(
        &id,
        UpdateCategory {
            parent_id,
            name,
            sort_order,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 删除分类
#[tauri::command]
pub async fn db_delete_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_category(&id).await.map_err(|e| e.to_string())
}

// ============ Entries ============

/// 创建词条
#[tauri::command]
pub async fn db_create_entry(
    state: State<'_, AppState>,
    project_id: String,
    category_id: Option<String>,
    title: String,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let db = state.sqlite_db.lock().await;
    db.create_entry(CreateEntry {
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
    .map_err(|e| e.to_string())
}

/// 获取完整词条（含 content、tags、images）
#[tauri::command]
pub async fn db_get_entry(state: State<'_, AppState>, id: String) -> Result<Entry, String> {
    let db = state.sqlite_db.lock().await;
    db.get_entry(&id).await.map_err(|e| e.to_string())
}

/// 分页列出词条简报（不含 content）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_list_entries(
    state: State<'_, AppState>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_deref(),
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
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let db = state.sqlite_db.lock().await;
    db.search_entries(
        &project_id,
        &query,
        EntryFilter {
            category_id: category_id.as_deref(),
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
    state: State<'_, AppState>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
) -> Result<i64, String> {
    let db = state.sqlite_db.lock().await;
    db.count_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_deref(),
            entry_type: entry_type.as_deref(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条；仅传入需要修改的字段，None 表示不变
#[tauri::command]
pub async fn db_update_entry(
    state: State<'_, AppState>,
    id: String,
    category_id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let db = state.sqlite_db.lock().await;
    db.update_entry(
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
    .map_err(|e| e.to_string())
}

/// 删除词条
#[tauri::command]
pub async fn db_delete_entry(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_entry(&id).await.map_err(|e| e.to_string())
}

/// 批量创建词条；返回成功插入的条数
#[tauri::command]
pub async fn db_create_entries_bulk(
    state: State<'_, AppState>,
    entries: Vec<CreateEntry>,
) -> Result<usize, String> {
    let db = state.sqlite_db.lock().await;
    db.create_entries_bulk(entries)
        .await
        .map_err(|e| e.to_string())
}

/// 优化 FTS 索引，消除碎片；建议在 create_entries_bulk 后调用
#[tauri::command]
pub async fn db_optimize_fts(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.optimize_fts().await.map_err(|e| e.to_string())
}

// ============ Tag Schemas ============

/// 创建标签定义；type 可为 "number" / "string" / "boolean"
#[tauri::command]
pub async fn db_create_tag_schema(
    state: State<'_, AppState>,
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
    let db = state.sqlite_db.lock().await;
    db.create_tag_schema(CreateTagSchema {
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
    .map_err(|e| e.to_string())
}

/// 查询单个标签定义
#[tauri::command]
pub async fn db_get_tag_schema(
    state: State<'_, AppState>,
    id: String,
) -> Result<TagSchema, String> {
    let db = state.sqlite_db.lock().await;
    db.get_tag_schema(&id).await.map_err(|e| e.to_string())
}

/// 查询项目下所有标签定义
#[tauri::command]
pub async fn db_list_tag_schemas(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TagSchema>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新标签定义（全量替换）
#[tauri::command]
pub async fn db_update_tag_schema(
    state: State<'_, AppState>,
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
    let db = state.sqlite_db.lock().await;
    db.update_tag_schema(
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
    .map_err(|e| e.to_string())
}

/// 删除标签定义
#[tauri::command]
pub async fn db_delete_tag_schema(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_tag_schema(&id).await.map_err(|e| e.to_string())
}

// ============ Entry Relations ============

/// 创建词条关系；relation 为 "OneWay"（单向）或 "TwoWay"（双向）
#[tauri::command]
pub async fn db_create_relation(
    state: State<'_, AppState>,
    project_id: String,
    a_id: String,
    b_id: String,
    relation: RelationDirection,
    content: String,
) -> Result<EntryRelation, String> {
    let db = state.sqlite_db.lock().await;
    db.create_relation(CreateEntryRelation {
        project_id,
        a_id,
        b_id,
        relation,
        content,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 查询单条词条关系
#[tauri::command]
pub async fn db_get_relation(
    state: State<'_, AppState>,
    id: String,
) -> Result<EntryRelation, String> {
    let db = state.sqlite_db.lock().await;
    db.get_relation(&id).await.map_err(|e| e.to_string())
}

/// 查询某词条的所有关系（含双向）
#[tauri::command]
pub async fn db_list_relations_for_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 查询项目下所有词条关系（用于构建关系图）
#[tauri::command]
pub async fn db_list_relations_for_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 更新词条关系的方向或描述内容
#[tauri::command]
pub async fn db_update_relation(
    state: State<'_, AppState>,
    id: String,
    relation: Option<RelationDirection>,
    content: Option<String>,
) -> Result<EntryRelation, String> {
    let db = state.sqlite_db.lock().await;
    db.update_relation(&id, UpdateEntryRelation { relation, content })
        .await
        .map_err(|e| e.to_string())
}

/// 删除单条词条关系
#[tauri::command]
pub async fn db_delete_relation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_relation(&id).await.map_err(|e| e.to_string())
}

/// 删除两个词条之间的所有关系；返回删除的条数
#[tauri::command]
pub async fn db_delete_relations_between(
    state: State<'_, AppState>,
    entry_a_id: String,
    entry_b_id: String,
) -> Result<u64, String> {
    let db = state.sqlite_db.lock().await;
    db.delete_relations_between(&entry_a_id, &entry_b_id)
        .await
        .map_err(|e| e.to_string())
}
