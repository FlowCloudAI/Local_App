use crate::NetworkState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

const FEEDBACK_ENDPOINT: &str = "https://www.flowcloudai.cn/api/v1/feedback";

#[derive(Debug, Deserialize)]
pub struct FeedbackPayload {
    kind: String,
    title: Option<String>,
    content: String,
    contact: Option<String>,
    app_version: Option<String>,
    page: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct FeedbackSubmitResult {
    id: Option<String>,
    ok: bool,
}

#[tauri::command]
pub async fn submit_public_feedback(
    network: State<'_, NetworkState>,
    payload: FeedbackPayload,
) -> Result<FeedbackSubmitResult, String> {
    let kind = payload.kind.trim();
    if !matches!(kind, "suggestion" | "issue") {
        return Err("反馈类型无效".into());
    }
    let content = payload.content.trim();
    if content.is_empty() {
        return Err("反馈内容不能为空".into());
    }

    let body = json!({
        "kind": kind,
        "priority": "normal",
        "source": "app",
        "app_version": payload.app_version.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        "platform": std::env::consts::OS,
        "title": payload.title.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        "content": content,
        "page": payload.page.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or("关于页"),
        "action": "用户主动提交反馈",
        "error_message": null,
        "stack": null,
        "contact": payload.contact.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        "metadata": {},
    });

    let response = network
        .client
        .post(FEEDBACK_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("反馈提交失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取反馈响应失败：{error}"))?;

    if !status.is_success() {
        return Err(if text.trim().is_empty() {
            format!("反馈提交失败：HTTP {status}")
        } else {
            format!("反馈提交失败：HTTP {status} {text}")
        });
    }

    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("反馈响应格式异常：{error}"))?;
    Ok(FeedbackSubmitResult {
        id: value
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        ok: value.get("ok").and_then(|value| value.as_bool()).unwrap_or(true),
    })
}
