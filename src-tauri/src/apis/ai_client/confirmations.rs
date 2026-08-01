use super::common::*;

/// 响应 AI 工具发起的编辑确认请求。
/// confirmed=true 表示用户确认，false 表示取消。
#[tauri::command]
pub async fn confirm_entry_edit(
    pending_edits: State<'_, PendingEditsState>,
    request_id: String,
    confirmed: bool,
) -> Result<bool, ApiError> {
    let mut map = pending_edits.pending.lock().await;
    Ok(deliver_confirmation(&mut map, &request_id, confirmed))
}

fn deliver_confirmation(
    pending: &mut std::collections::HashMap<String, tokio::sync::oneshot::Sender<bool>>,
    request_id: &str,
    confirmed: bool,
) -> bool {
    pending
        .remove(request_id)
        .is_some_and(|sender| sender.send(confirmed).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_reports_delivery_and_missing_request() {
        let mut pending = std::collections::HashMap::new();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        pending.insert("request".to_string(), sender);

        assert!(deliver_confirmation(&mut pending, "request", true));
        assert_eq!(receiver.blocking_recv(), Ok(true));
        assert!(!deliver_confirmation(&mut pending, "missing", false));
    }

    #[test]
    fn confirmation_reports_closed_receiver() {
        let mut pending = std::collections::HashMap::new();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        drop(receiver);
        pending.insert("request".to_string(), sender);

        assert!(!deliver_confirmation(&mut pending, "request", true));
    }
}
