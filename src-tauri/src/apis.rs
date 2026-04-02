use std::env;
use tauri::{Window, State};
use crate::AppState;
use worldflow_core::models::*;

// ============ Logging & Window ============

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

#[tauri::command]
pub fn show_main_window(window: Window) -> Result<&'static str, &'static str> {
    #[cfg(desktop)]
    {
        match window.show() {
            Ok(_) => {},
            Err(_) => return Err("failed to show the window"),
        };
    }
    unsafe {
        env::set_var("TAURI_DEBUG", "1");
    }
    Ok("open the window")
}

// ============ Projects ============

#[tauri::command]
pub async fn api_create_project(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.create_project(CreateProject { name, description })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_project(state: State<'_, AppState>, id: String) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.get_project(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_project(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    db.update_project(
        &id,
        UpdateProject { name, description },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_project(&id).await.map_err(|e| e.to_string())
}

// ============ Categories ============

#[tauri::command]
pub async fn api_create_category(
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

#[tauri::command]
pub async fn api_list_categories(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Category>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_category(
    state: State<'_, AppState>,
    id: String,
    parent_id: Option<Option<String>>,
    name: Option<String>,
    sort_order: Option<Option<i64>>,
) -> Result<Category, String> {
    let db = state.sqlite_db.lock().await;
    db.update_category(
        &id,
        UpdateCategory {
            parent_id,
            name,
            sort_order: sort_order.expect("REASON"),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

// ============ Entries ============

#[tauri::command]
pub async fn api_create_entry(
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

#[tauri::command]
pub async fn api_get_entry(state: State<'_, AppState>, id: String) -> Result<Entry, String> {
    let db = state.sqlite_db.lock().await;
    db.get_entry(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_list_entries(
    state: State<'_, AppState>,
    project_id: String,
    category_id: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_entries(&project_id, category_id.as_deref(), limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_search_entries(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let db = state.sqlite_db.lock().await;
    db.search_entries(&project_id, &query, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_count_entries(
    state: State<'_, AppState>,
    project_id: String,
    category_id: Option<String>,
) -> Result<i64, String> {
    let db = state.sqlite_db.lock().await;
    db.count_entries(&project_id, category_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_create_entries_bulk(
    state: State<'_, AppState>,
    entries: Vec<CreateEntry>,
) -> Result<usize, String> {
    let db = state.sqlite_db.lock().await;
    db.create_entries_bulk(entries)
        .await
        .map_err(|e| e.to_string())
}

// ============ Tag Schemas ============

#[tauri::command]
pub async fn api_create_tag_schema(
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

#[tauri::command]
pub async fn api_get_tag_schema(
    state: State<'_, AppState>,
    id: String,
) -> Result<TagSchema, String> {
    let db = state.sqlite_db.lock().await;
    db.get_tag_schema(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_list_tag_schemas(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TagSchema>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_tag_schema(
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

#[tauri::command]
pub async fn api_delete_tag_schema(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.sqlite_db.lock().await;
    db.delete_tag_schema(&id)
        .await
        .map_err(|e| e.to_string())
}
