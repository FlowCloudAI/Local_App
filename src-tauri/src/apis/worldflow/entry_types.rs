use super::common::*;

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
