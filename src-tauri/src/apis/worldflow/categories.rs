use super::common::*;

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
