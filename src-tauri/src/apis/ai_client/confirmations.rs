use super::common::*;

/// 响应 AI 工具发起的编辑确认请求。
/// confirmed=true 表示用户确认，false 表示取消。
#[tauri::command]
pub async fn confirm_entry_edit(
    pending_edits: State<'_, PendingEditsState>,
    request_id: String,
    confirmed: bool,
) -> Result<(), String> {
    let mut map = pending_edits.pending.lock().await;
    match map.remove(&request_id) {
        Some(tx) => {
            // send 失败说明 handler 已超时取消，静默忽略
            let _ = tx.send(confirmed);
            Ok(())
        }
        None => Err(format!("编辑请求 '{}' 不存在或已超时", request_id)),
    }
}
