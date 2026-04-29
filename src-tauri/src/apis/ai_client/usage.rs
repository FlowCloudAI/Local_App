use crate::AppState;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use worldflow_core::{query_usage_by_model, query_usage_summary};

/// 查询 API 用量总览
#[tauri::command]
pub async fn ai_get_usage_summary(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<worldflow_core::models::ApiUsageSummary, String> {
    let app = state.lock().await;
    let db = app.sqlite_db.lock().await;
    query_usage_summary(&db.pool)
        .await
        .map_err(|e| e.to_string())
}

/// 按模型分组查询 API 用量
#[tauri::command]
pub async fn ai_get_usage_by_model(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<worldflow_core::models::ApiUsageByModel>, String> {
    let app = state.lock().await;
    let db = app.sqlite_db.lock().await;
    query_usage_by_model(&db.pool)
        .await
        .map_err(|e| e.to_string())
}
