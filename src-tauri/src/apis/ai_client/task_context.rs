use super::common::*;

/// 前端传入的任务上下文 DTO。
///
/// 所有字段可选——只传有意义的字段，未传的字段在后端以 Default 填充。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextDto {
    pub project_id: Option<String>,
    pub task_type: Option<String>,
    pub attributes: Option<HashMap<String, String>>,
    pub flags: Option<HashMap<String, bool>>,
}

/// 更新指定会话的编排上下文（下一轮对话开始前生效）。
///
/// Session 每轮调用 `Orchestrate::assemble` 前会通过 `try_recv` 拉取最新值，
/// 多次调用只保留最后一次——前端可以放心高频推送（如 tab 切换时）。
#[tauri::command]
pub async fn ai_set_task_context(
    ai_state: State<'_, AiState>,
    session_id: String,
    ctx: TaskContextDto,
) -> Result<(), String> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };

    handle
        .set_task_context(TaskContext {
            project_id: ctx.project_id,
            task_type: ctx.task_type.unwrap_or_default(),
            attributes: ctx.attributes.unwrap_or_default(),
            flags: ctx.flags.unwrap_or_default(),
            ..Default::default()
        })
        .await
}
