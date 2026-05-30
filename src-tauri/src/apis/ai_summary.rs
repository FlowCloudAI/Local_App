use crate::ai_services::context_builders::{
    build_entry_markdown, build_entry_snapshot_markdown, build_summary_prompt,
};
use crate::reports::summary_result::SummaryResult;
use crate::tools;
use crate::{AiState, ApiError, ApiKeyStore, AppState};
use flowcloudai_client::{ErrorCode, SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::mpsc;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePromptFillRequest {
    pub plugin_id: String,
    pub model: Option<String>,
    pub current_prompt: Option<String>,
    pub usage: Option<String>,
    pub project_name: Option<String>,
    pub entry_title: Option<String>,
    pub entry_summary: Option<String>,
    pub entry_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePromptFillResult {
    pub prompt: String,
}

#[tauri::command]
pub async fn ai_generate_entry_summary(
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<AppState>>,
    request: SummaryRequest,
) -> Result<SummaryResult, ApiError> {
    if request.entry_ids.is_empty() {
        return Err(
            ApiError::new(ErrorCode::ValidationMissingField, "entryIds 不能为空")
                .with_kv("field", "entryIds"),
        );
    }

    let api_key = ApiKeyStore::get(&request.plugin_id).ok_or_else(|| {
        ApiError::new(
            ErrorCode::AuthApiKeyMissing,
            format!(
                "插件 '{}' 未配置 API Key，请在设置中配置",
                request.plugin_id
            ),
        )
        .with_kv("plugin_id", request.plugin_id.clone())
    })?;

    let (project_name, entry_blocks) = {
        let app_state = app_state.inner().as_ref();
        let (project, _) = tools::get_project_summary(app_state, &request.project_id)
            .await
            .map_err(ApiError::internal)?;
        let mut blocks = Vec::new();
        for entry_id in &request.entry_ids {
            let entry = tools::get_entry(app_state, entry_id)
                .await
                .map_err(ApiError::internal)?;
            let block = if let Some(draft_entry) = request
                .draft_entry
                .as_ref()
                .filter(|draft| draft.entry_id == *entry_id)
            {
                let title = draft_entry.title.as_deref().unwrap_or(&entry.title);
                let summary = draft_entry.summary.as_deref().or(entry.summary.as_deref());
                let content = draft_entry.content.as_deref().unwrap_or(&entry.content);
                let entry_type = draft_entry
                    .entry_type
                    .as_deref()
                    .or(entry.r#type.as_deref());
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

    let mut session = {
        let client = ai_state.client.lock().await;
        client.create_llm_session(&request.plugin_id, &api_key, None)?
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
    let (mut event_stream, handle) = session.try_run(input_rx)?;

    if is_entry_field_mode {
        handle
            .update(|req| {
                req.response_format = Some(serde_json::json!({ "type": "json_object" }));
            })
            .await;
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
                SessionEvent::Error(error) => return Err(error.to_string()),
                SessionEvent::TurnEnd { status, .. } => match status {
                    TurnStatus::Ok => break,
                    TurnStatus::Cancelled => return Err("总结任务已取消".to_string()),
                    TurnStatus::Interrupted => return Err("总结任务被中断".to_string()),
                    TurnStatus::Error(error) => return Err(error.to_string()),
                },
                _ => {}
            }
        }
        Ok(output)
    }
    .await;

    let output = result.map_err(ApiError::internal)?;
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

#[tauri::command]
pub async fn ai_fill_image_prompt(
    ai_state: State<'_, AiState>,
    request: ImagePromptFillRequest,
) -> Result<ImagePromptFillResult, ApiError> {
    let api_key = ApiKeyStore::get(&request.plugin_id).ok_or_else(|| {
        ApiError::new(
            ErrorCode::AuthApiKeyMissing,
            format!(
                "插件 '{}' 未配置 API Key，请在设置中配置",
                request.plugin_id
            ),
        )
        .with_kv("plugin_id", request.plugin_id.clone())
    })?;

    let prompt = build_image_prompt_fill_prompt(&request);
    let mut session = {
        let client = ai_state.client.lock().await;
        client.create_llm_session(&request.plugin_id, &api_key, None)?
    };

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        session.set_model(model).await;
    }
    session.set_max_tokens(700).await;
    session.set_stream(true).await;

    let (input_tx, input_rx) = mpsc::channel::<String>(8);
    let (mut event_stream, handle) = session.try_run(input_rx)?;
    handle
        .update(|req| {
            req.response_format = Some(serde_json::json!({ "type": "json_object" }));
        })
        .await;

    input_tx
        .send(prompt)
        .await
        .map_err(|_| ApiError::new(ErrorCode::LlmSessionClosed, "绘图提示词会话已关闭"))?;

    let mut output = String::new();
    while let Some(event) = event_stream.next().await {
        match event {
            SessionEvent::ContentDelta(text) => output.push_str(&text),
            SessionEvent::Error(error) => return Err(error.into()),
            SessionEvent::TurnEnd { status, .. } => match status {
                TurnStatus::Ok => break,
                TurnStatus::Cancelled => {
                    return Err(ApiError::new(
                        ErrorCode::CoreClientCancelled,
                        "绘图提示词任务已取消",
                    ));
                }
                TurnStatus::Interrupted => {
                    return Err(ApiError::new(
                        ErrorCode::CoreClientCancelled,
                        "绘图提示词任务被中断",
                    ));
                }
                TurnStatus::Error(error) => return Err(error.into()),
            },
            _ => {}
        }
    }

    let filled_prompt = extract_prompt_field(&output).unwrap_or_else(|| output.trim().to_string());
    if filled_prompt.is_empty() {
        return Err(ApiError::new(
            ErrorCode::LlmResponseEmpty,
            "AI 未返回可用绘图提示词",
        ));
    }

    Ok(ImagePromptFillResult {
        prompt: filled_prompt,
    })
}

fn build_image_prompt_fill_prompt(request: &ImagePromptFillRequest) -> String {
    let usage = match request.usage.as_deref() {
        Some("project_cover") => "项目封面",
        _ => "词条配图",
    };
    let current_prompt = request
        .current_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");
    let project_name = request
        .project_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名项目");
    let entry_title = request
        .entry_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");
    let entry_type = request
        .entry_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");
    let entry_summary = request
        .entry_summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");

    format!(
        r#"你是专业的 AI 生图提示词设计助手。请根据上下文生成一条可直接用于文生图模型的中文绘图提示词。

要求：
- 只输出 JSON，不要 Markdown，不要解释。
- JSON 格式必须为 {{"prompt":"..."}}
- prompt 使用中文，长度控制在 80 到 180 字。
- 写清主体、场景、构图、光线、色彩、风格、氛围和画面质量。
- 不要加入与上下文冲突的角色、地点或设定。
- 如果已有提示词不是“无”，请在保留其核心意图的基础上补全为更适合生图的提示词。

用途：{usage}
项目：{project_name}
词条标题：{entry_title}
词条类型：{entry_type}
词条摘要：{entry_summary}
已有提示词：{current_prompt}
"#
    )
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

fn extract_prompt_field(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(s) = v.get("prompt").and_then(|s| s.as_str()) {
            return Some(s.trim().to_string());
        }
    }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[start..=end]) {
                if let Some(s) = v.get("prompt").and_then(|s| s.as_str()) {
                    return Some(s.trim().to_string());
                }
            }
        }
    }
    None
}
