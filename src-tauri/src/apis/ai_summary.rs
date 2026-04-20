use crate::ai_services::context_builders::{
    build_entry_markdown, build_entry_snapshot_markdown, build_summary_prompt,
};
use crate::reports::summary_result::SummaryResult;
use crate::tools;
use crate::{AiState, ApiKeyStore, AppState};
use flowcloudai_client::{SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRequest {
    pub plugin_id: String,
    pub project_id: String,
    pub entry_ids: Vec<String>,
    pub focus: Option<String>,
    pub output_mode: Option<String>,
    pub draft_entry: Option<SummaryDraftEntry>,
    pub model: Option<String>,
    pub max_tokens: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDraftEntry {
    pub entry_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub entry_type: Option<String>,
}

#[tauri::command]
pub async fn ai_generate_entry_summary(
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<Mutex<AppState>>>,
    request: SummaryRequest,
) -> Result<SummaryResult, String> {
    if request.entry_ids.is_empty() {
        return Err("entryIds 不能为空".to_string());
    }

    let api_key = ApiKeyStore::get(&request.plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", request.plugin_id))?;

    let (project_name, entry_blocks) = {
        let app_state = app_state.inner().lock().await;
        let (project, _) = tools::get_project_summary(&app_state, &request.project_id).await?;
        let mut blocks = Vec::new();
        for entry_id in &request.entry_ids {
            let entry = tools::get_entry(&app_state, entry_id).await?;
            let block = if let Some(draft_entry) = request
                .draft_entry
                .as_ref()
                .filter(|draft| draft.entry_id == *entry_id)
            {
                let title = draft_entry.title.as_deref().unwrap_or(&entry.title);
                let summary = draft_entry.summary.as_deref().or(entry.summary.as_deref());
                let content = draft_entry.content.as_deref().unwrap_or(&entry.content);
                let entry_type = draft_entry.entry_type.as_deref().or(entry.r#type.as_deref());
                let tags = entry
                    .tags
                    .0
                    .iter()
                    .map(|tag| (tag.schema_id.to_string(), tag.value.to_string()))
                    .collect::<Vec<_>>();
                build_entry_snapshot_markdown(
                    &entry.id.to_string(),
                    title,
                    entry_type,
                    summary,
                    &tags,
                    content,
                    2_400,
                )
            } else {
                build_entry_markdown(&entry, 2_400)
            };
            blocks.push(block);
        }
        (project.name, blocks)
    };

    let prompt = build_summary_prompt(
        &project_name,
        request.focus.as_deref(),
        &entry_blocks,
        request.output_mode.as_deref(),
    );

    let (mut session, temp_conv_id) = {
        let client = ai_state.client.lock().await;
        let session = client
            .create_llm_session(&request.plugin_id, &api_key)
            .map_err(|e| e.to_string())?;
        let temp_conv_id = session.conversation_id().map(str::to_string);
        (session, temp_conv_id)
    };

    if let Some(model) = &request.model {
        session.set_model(model).await;
    }
    if let Some(max_tokens) = request.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let is_entry_field_mode = matches!(request.output_mode.as_deref(), Some("entry_field"));

    let (input_tx, input_rx) = mpsc::channel::<String>(8);
    let (mut event_stream, handle) = session.run(input_rx);

    if is_entry_field_mode {
        handle.update(|req| {
            req.response_format = Some(serde_json::json!({ "type": "json_object" }));
        }).await;
    }

    let result: Result<String, String> = async {
        input_tx
            .send(prompt)
            .await
            .map_err(|_| "总结会话已关闭".to_string())?;

        let mut output = String::new();
        while let Some(event) = event_stream.next().await {
            match event {
                SessionEvent::ContentDelta(text) => output.push_str(&text),
                SessionEvent::Error(error) => return Err(error),
                SessionEvent::TurnEnd { status, .. } => match status {
                    TurnStatus::Ok => break,
                    TurnStatus::Cancelled => return Err("总结任务已取消".to_string()),
                    TurnStatus::Interrupted => return Err("总结任务被中断".to_string()),
                    TurnStatus::Error(error) => return Err(error),
                },
                _ => {}
            }
        }
        Ok(output)
    }.await;

    if let Some(conv_id) = temp_conv_id {
        let client = ai_state.client.lock().await;
        let _ = client.ai_delete_conversation(&conv_id);
    }

    let output = result?;
    let summary_text = if is_entry_field_mode {
        extract_summary_field(&output).unwrap_or(output)
    } else {
        output
    };

    Ok(SummaryResult::from_text(
        summary_text,
        request.entry_ids,
        Vec::new(),
    ))
}

fn extract_summary_field(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    // 直接解析
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(s) = v.get("summary").and_then(|s| s.as_str()) {
            return Some(s.trim().to_string());
        }
    }
    // 从文本中提取第一个 {...} 块
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[start..=end]) {
                if let Some(s) = v.get("summary").and_then(|s| s.as_str()) {
                    return Some(s.trim().to_string());
                }
            }
        }
    }
    None
}
