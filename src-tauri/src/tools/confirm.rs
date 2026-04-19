use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

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
        .map_err(|e| anyhow::anyhow!("emit 失败: {}", e))?;

    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => anyhow::bail!("确认通道异常关闭"),
        Err(_) => {
            pending_edits.lock().await.remove(&request_id);
            anyhow::bail!("用户未在规定时间内响应，操作已自动取消");
        }
    }
}
