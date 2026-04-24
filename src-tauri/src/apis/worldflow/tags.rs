use super::common::*;

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
