use crate::{ApiError, AppState};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use worldflow_core::{query_usage_by_model, query_usage_summary};

#[derive(Debug, Serialize)]
pub struct ApiUsageDaily {
    pub date: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub call_count: i64,
}

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

/// 按本地日期聚合最近 180 天 API 用量
#[tauri::command]
pub async fn ai_get_usage_daily(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ApiUsageDaily>, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    let rows = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(
        "SELECT date(created_at, 'localtime') AS usage_date, \
         COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(completion_tokens), 0), \
         COALESCE(SUM(total_tokens), 0), COUNT(*) \
         FROM api_usage_log \
         WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-179 days') \
         GROUP BY usage_date \
         ORDER BY usage_date ASC",
    )
    .fetch_all(&db.pool)
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|(date, prompt_tokens, completion_tokens, total_tokens, call_count)| ApiUsageDaily {
            date,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            call_count,
        })
        .collect())
}
