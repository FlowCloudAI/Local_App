//! AI Token 估算与已落库用量查询，前端估算统一复用核心库口径。

use crate::{ApiError, AppState};
use flowcloudai_client::llm::{
    token_estimate::{estimate_messages_tokens, estimate_with_factor},
    types::{Message, ToolCall, ToolFunctionCall},
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use worldflow_core::{query_usage_by_model, query_usage_daily, query_usage_summary};

#[derive(Debug, Deserialize)]
pub struct AiTokenEstimateMessage {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_payloads: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AiTokenEstimateRequest {
    #[serde(default)]
    pub messages: Vec<AiTokenEstimateMessage>,
    pub calibration_factor: Option<f64>,
}

/// 按核心库与实际请求相同的字符分类、消息开销和校准边界估算 Token。
#[tauri::command]
pub fn ai_estimate_tokens(request: AiTokenEstimateRequest) -> u64 {
    let messages = request
        .messages
        .into_iter()
        .map(|message| Message {
            role: "user".to_string(),
            content: message.content,
            reasoning_content: message.reasoning_content,
            tool_call_id: None,
            tool_calls: (!message.tool_payloads.is_empty()).then(|| {
                message
                    .tool_payloads
                    .into_iter()
                    .enumerate()
                    .map(|(index, arguments)| ToolCall {
                        function: ToolFunctionCall {
                            name: String::new(),
                            arguments,
                        },
                        index,
                        ..Default::default()
                    })
                    .collect()
            }),
        })
        .collect::<Vec<_>>();
    estimate_with_factor(
        estimate_messages_tokens(&messages),
        request.calibration_factor.unwrap_or(1.0),
    )
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

/// 按本地日期聚合最近 52 周 API 用量
#[tauri::command]
pub async fn ai_get_usage_daily(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<worldflow_core::models::ApiUsageDaily>, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_daily(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}
