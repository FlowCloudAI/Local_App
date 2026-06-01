use super::common::*;

/// 读取项目级设置（不存在返回 null）。
#[tauri::command]
pub async fn db_get_project_setting(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.get_project_setting(&project_id, &key)
        .await
        .map_err(|e| e.to_string())
}

/// 写入项目级设置（存在即覆盖）。
#[tauri::command]
pub async fn db_set_project_setting(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.set_project_setting(&project_id, &key, &value)
        .await
        .map_err(|e| e.to_string())
}
