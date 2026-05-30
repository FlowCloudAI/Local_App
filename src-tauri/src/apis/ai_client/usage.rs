use crate::{ApiError, AppState};
use std::sync::Arc;
use tauri::State;
use worldflow_core::{query_usage_by_model, query_usage_summary};

/// 查询 API 用量总览
#[tauri::command]
pub async fn ai_get_usage_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<worldflow_core::models::ApiUsageSummary, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_summary(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// 按模型分组查询 API 用量
#[tauri::command]
pub async fn ai_get_usage_by_model(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<worldflow_core::models::ApiUsageByModel>, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_by_model(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}
