//! AI 写入操作的前端确认协议。
//!
//! 本模块用一次性通道关联确认请求与用户响应；人工确认不设时限，但同一时间只展示一个请求，
//! 会话取消或通道异常时会清理挂起状态，避免遗留无法响应的弹窗。

use flowcloudai_client::ToolFailure;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

static CONFIRMATION_GATE: Mutex<()> = Mutex::const_new(());

struct PendingRequestGuard {
    request_id: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl PendingRequestGuard {
    fn new(
        request_id: String,
        pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    ) -> Self {
        Self {
            request_id,
            pending,
        }
    }
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        let request_id = self.request_id.clone();
        let pending = Arc::clone(&self.pending);
        tauri::async_runtime::spawn(async move {
            pending.lock().await.remove(&request_id);
        });
    }
}

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
/// 返回 Ok(true) = 用户确认，Err = 用户取消或通道异常。
pub async fn request_confirmation<P: serde::Serialize + Clone>(
    app_handle: &AppHandle,
    pending_edits: &Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    event: &str,
    make_payload: impl FnOnce(String) -> P,
) -> anyhow::Result<bool> {
    let _confirmation_gate = CONFIRMATION_GATE.lock().await;
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<bool>();
    pending_edits.lock().await.insert(request_id.clone(), tx);
    let _pending_guard = PendingRequestGuard::new(request_id.clone(), Arc::clone(pending_edits));

    let payload = make_payload(request_id.clone());
    app_handle
        .emit(event, payload)
        .map_err(|error| ToolFailure::Denied {
            reason: format!("无法发起用户确认，操作已取消：{error}"),
        })?;

    match rx.await {
        Ok(true) => Ok(true),
        Ok(false) => Err(ToolFailure::Denied {
            reason: "用户取消了确认".to_string(),
        }
        .into()),
        Err(_) => Err(ToolFailure::Denied {
            reason: "确认通道异常关闭，操作已取消".to_string(),
        }
        .into()),
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
    )
    .await
}

fn requires_manual_confirmation(operation: &str) -> bool {
    operation.starts_with("delete_") || operation.starts_with("remove_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn abandoned_request_is_removed() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (tx, _rx) = oneshot::channel();
        pending.lock().await.insert("request".to_string(), tx);

        drop(PendingRequestGuard::new(
            "request".to_string(),
            Arc::clone(&pending),
        ));

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while pending.lock().await.contains_key("request") {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("取消后的确认请求应被清理");
    }
}
