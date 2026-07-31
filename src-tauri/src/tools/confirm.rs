//! AI 写入操作的前端确认协议。
//!
//! 本模块用一次性通道关联确认请求与用户响应；超时、缺少窗口句柄或通道异常均按取消处理，
//! 以避免模型在无人确认时继续修改数据。

use flowcloudai_client::ToolFailure;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

#[derive(serde::Serialize, Clone)]
/// 发往前端确认弹窗的操作摘要。
pub struct AiWriteRequestPayload {
    pub request_id: String,
    pub operation: String,
    pub title: String,
    pub summary: Option<String>,
    pub details: Vec<String>,
    pub warning: Option<String>,
}

/// 查询当前运行环境是否允许自动确认普通写入。
///
/// 删除和移除操作仍须人工确认，不能因该开关失去恢复前的最后一道保护。
pub fn should_auto_confirm_writes() -> bool {
    flowcloudai_client::tool::auto_confirm_writes_enabled()
}

/// 向前端发送确认事件，等待用户响应。
/// `make_payload` 接收生成的 request_id，调用方负责将其嵌入 payload 结构体。
/// 返回 Ok(true) = 用户确认，Ok(false) = 用户取消，Err = 超时或通道异常。
pub async fn request_confirmation<P: serde::Serialize + Clone>(
    app_handle: &AppHandle,
    pending_edits: &Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    event: &str,
    make_payload: impl FnOnce(String) -> P,
    timeout_secs: u64,
) -> anyhow::Result<bool> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<bool>();
    pending_edits.lock().await.insert(request_id.clone(), tx);

    let payload = make_payload(request_id.clone());
    app_handle
        .emit(event, payload)
        .map_err(|error| ToolFailure::Denied {
            reason: format!("无法发起用户确认，操作已取消：{error}"),
        })?;

    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(true)) => Ok(true),
        Ok(Ok(false)) => Err(ToolFailure::Denied {
            reason: "用户取消了确认".to_string(),
        }
        .into()),
        Ok(Err(_)) => Err(ToolFailure::Denied {
            reason: "确认通道异常关闭，操作已取消".to_string(),
        }
        .into()),
        Err(_) => {
            pending_edits.lock().await.remove(&request_id);
            Err(ToolFailure::Denied {
                reason: "用户未在规定时间内响应，操作已自动取消".to_string(),
            }
            .into())
        }
    }
}

/// 请求写入确认；在允许自动确认时只放行非删除、非移除操作。
pub async fn request_write_confirmation(
    app_handle: Option<&AppHandle>,
    pending_edits: &Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    operation: impl Into<String>,
    title: impl Into<String>,
    summary: Option<String>,
    details: Vec<String>,
    warning: Option<String>,
) -> anyhow::Result<bool> {
    let operation = operation.into();
    if should_auto_confirm_writes() && !requires_manual_confirmation(&operation) {
        return Ok(true);
    }
    let Some(app_handle) = app_handle else {
        return Err(ToolFailure::Denied {
            reason: "缺少用户确认通道，操作已自动取消".to_string(),
        }
        .into());
    };
    let title = title.into();
    request_confirmation(
        app_handle,
        pending_edits,
        "ai:write-request",
        |request_id| AiWriteRequestPayload {
            request_id,
            operation: operation.clone(),
            title: title.clone(),
            summary: summary.clone(),
            details: details.clone(),
            warning: warning.clone(),
        },
        180,
    )
    .await
}

fn requires_manual_confirmation(operation: &str) -> bool {
    operation.starts_with("delete_") || operation.starts_with("remove_")
}
