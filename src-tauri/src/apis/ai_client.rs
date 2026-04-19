use crate::AiState;
use crate::ApiKeyStore;
use crate::PendingEditsState;
use flowcloudai_client::{
    AudioDecoder, AudioSource, ConversationMeta, DefaultOrchestrator, ImageSession, PluginKind,
    SessionEvent, StoredConversation, TaskContext, TurnStatus,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use uuid::Uuid;

// ============ 前端事件 Payload ============

#[derive(Serialize, Clone)]
struct EventReady {
    session_id: String,
    run_id: String,
}

#[derive(Serialize, Clone)]
struct EventDelta {
    session_id: String,
    run_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct EventToolCall {
    session_id: String,
    run_id: String,
    index: usize,
    name: String,
    arguments: String,
}

#[derive(Serialize, Clone)]
struct EventTurnEnd {
    session_id: String,
    run_id: String,
    status: String, // "ok" | "cancelled" | "interrupted" | "error:<msg>"
    node_id: u64,
}

#[derive(Serialize, Clone)]
struct EventTurnBegin {
    session_id: String,
    run_id: String,
    turn_id: u64,
    node_id: u64,
}

#[derive(Serialize, Clone)]
struct EventToolResult {
    session_id: String,
    run_id: String,
    index: usize,
    output: String,
    result: String,
    is_error: bool,
}

#[derive(Serialize)]
pub struct CreateLlmSessionResult {
    pub session_id: String,
    pub conversation_id: String,
    pub run_id: String,
}

#[derive(Serialize, Clone)]
struct EventError {
    session_id: String,
    run_id: String,
    error: String,
}

fn turn_status_str(s: &TurnStatus) -> String {
    match s {
        TurnStatus::Ok => "ok".to_string(),
        TurnStatus::Cancelled => "cancelled".to_string(),
        TurnStatus::Interrupted => "interrupted".to_string(),
        TurnStatus::Error(e) => format!("error:{}", e),
    }
}

// ============ 插件 ============

#[derive(Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub models: Vec<String>,
    pub default_model: Option<String>,
}

/// 列出指定类型的可用插件；kind 为 "llm" / "image" / "tts"
#[tauri::command]
pub async fn ai_list_plugins(
    ai_state: State<'_, AiState>,
    kind: String,
) -> Result<Vec<PluginInfo>, String> {
    let plugin_kind = match kind.to_lowercase().as_str() {
        "llm" => PluginKind::LLM,
        "image" => PluginKind::Image,
        "tts" => PluginKind::TTS,
        other => return Err(format!("未知插件类型: {}", other)),
    };

    let client = ai_state.client.lock().await;
    let list = client
        .list_by_kind(plugin_kind)
        .into_iter()
        .map(|(id, meta)| PluginInfo {
            id: id.clone(),
            name: meta.name.clone(),
            kind: kind.clone(),
            models: meta.models().to_vec(),
            default_model: meta.default_model().map(str::to_string),
        })
        .collect();

    Ok(list)
}

// ============ LLM 会话 ============

/// 创建 LLM 会话并启动后台事件循环。
///
/// 创建后立即可通过 `ai_send_message` 发送消息。
/// 事件通过 Tauri 事件推送到前端：
///
/// - `"ai:ready"`        `{ session_id, run_id }`                      —— 会话就绪，等待用户输入
/// - `"ai:delta"`        `{ session_id, run_id, text }`                —— AI 生成内容片段
/// - `"ai:reasoning"`    `{ session_id, run_id, text }`                —— 思考过程片段
/// - `"ai:tool_call"`    `{ session_id, run_id, index, name }`         —— AI 调用工具
/// - `"ai:turn_end"`     `{ session_id, run_id, status }`              —— 对话结束
/// - `"ai:error"`        `{ session_id, run_id, error }`               —— 发生错误
#[tauri::command]
pub async fn ai_create_llm_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    session_id: String,
    plugin_id: String,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    conversation_id: Option<String>,
) -> Result<CreateLlmSessionResult, String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let mut session = match conversation_id {
        Some(ref conv_id) => client
            .resume_llm_session(&plugin_id, &api_key, conv_id)
            .map_err(|e| e.to_string())?,
        None => client
            .create_llm_session(&plugin_id, &api_key)
            .map_err(|e| e.to_string())?,
    };
    drop(client);

    session.set_orchestrator(Box::new(DefaultOrchestrator::new(registry)));

    if let Some(m) = model {
        session.set_model(&m).await;
    }
    if let Some(t) = temperature {
        session.set_temperature(t).await;
    }
    if let Some(n) = max_tokens {
        session.set_max_tokens(n).await;
    }
    session.set_stream(true).await;
    let resolved_conversation_id = session
        .conversation_id()
        .map(str::to_string)
        .unwrap_or_else(|| session_id.clone());

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.run(input_rx);
    let run_id = Uuid::new_v4().to_string();
    log::info!(
        "[ai_create_llm_session] conversation_id={} session_id={} run_id={}",
        resolved_conversation_id,
        session_id,
        run_id
    );

    // 启动后台事件循环
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        futures::pin_mut!(event_stream);
        while let Some(ev) = event_stream.next().await {
            match ev {
                SessionEvent::NeedInput => {
                    log::info!("[ai:ready] session_id={} run_id={}", sid, rid);
                    app_clone
                        .emit(
                            "ai:ready",
                            EventReady {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                            },
                        )
                        .ok();
                }
                SessionEvent::TurnBegin { turn_id, node_id } => {
                    log::info!(
                        "[ai:turn_begin] session_id={} run_id={} turn_id={} node_id={}",
                        sid,
                        rid,
                        turn_id,
                        node_id
                    );
                    app_clone
                        .emit(
                            "ai:turn_begin",
                            EventTurnBegin {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                turn_id,
                                node_id,
                            },
                        )
                        .ok();
                }
                SessionEvent::ContentDelta(text) => {
                    app_clone
                        .emit(
                            "ai:delta",
                            EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text,
                            },
                        )
                        .ok();
                }
                SessionEvent::ReasoningDelta(text) => {
                    app_clone
                        .emit(
                            "ai:reasoning",
                            EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text,
                            },
                        )
                        .ok();
                }
                SessionEvent::ToolCall {
                    index,
                    name,
                    arguments,
                } => {
                    app_clone
                        .emit(
                            "ai:tool_call",
                            EventToolCall {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                index,
                                name,
                                arguments,
                            },
                        )
                        .ok();
                }
                SessionEvent::ToolResult {
                    index,
                    output,
                    is_error,
                } => {
                    app_clone
                        .emit(
                            "ai:tool_result",
                            EventToolResult {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                index,
                                output: output.clone(),
                                result: output.clone(),
                                is_error,
                            },
                        )
                        .ok();
                }
                SessionEvent::TurnEnd { status, node_id } => {
                    log::info!(
                        "[ai:turn_end] session_id={} run_id={} status={} node_id={}",
                        sid,
                        rid,
                        turn_status_str(&status),
                        node_id
                    );
                    app_clone
                        .emit(
                            "ai:turn_end",
                            EventTurnEnd {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                status: turn_status_str(&status),
                                node_id,
                            },
                        )
                        .ok();
                }
                SessionEvent::Error(e) => {
                    log::error!("[ai:error] session_id={} run_id={} error={}", sid, rid, e);
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: e,
                            },
                        )
                        .ok();
                    break;
                }
            }
        }

        // 事件流结束，清理 session
        let state = app_clone.state::<AiState>();
        let mut sessions = state.sessions.lock().await;
        let current_entry_run_id = sessions.get(&sid).map(|entry| entry.run_id.clone());
        log::info!(
            "[ai:cleanup] session_id={} stream_run_id={} current_entry_run_id={:?}",
            sid,
            rid,
            current_entry_run_id
        );
        let should_remove = sessions
            .get(&sid)
            .map(|entry| entry.run_id == rid)
            .unwrap_or(false);
        if should_remove {
            sessions.remove(&sid);
        }
    });

    ai_state.sessions.lock().await.insert(
        session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx,
            handle,
        },
    );

    Ok(CreateLlmSessionResult {
        session_id,
        conversation_id: resolved_conversation_id,
        run_id,
    })
}

/// 将消息树 head 移动到指定节点（重说 / 分支 / 历史回退）
///
/// node_id 来自 `ai:turn_begin` 或 `ai:turn_end` 事件中的 `node_id` 字段。
/// 在会话等待用户输入期间生效：
/// - 目标节点 role 为 "user" → drive loop 立即继续（免去下一次输入）
/// - 目标节点 role 为 "assistant" → drive loop 继续等待用户输入
#[tauri::command]
pub async fn ai_checkout(
    ai_state: State<'_, AiState>,
    session_id: String,
    node_id: u64,
) -> Result<(), String> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };

    handle.checkout(node_id).await
}

/// 切换会话使用的插件（下一轮对话生效）
#[tauri::command]
pub async fn ai_switch_plugin(
    ai_state: State<'_, AiState>,
    session_id: String,
    plugin_id: String,
) -> Result<(), String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };

    handle.switch_plugin(&plugin_id, &api_key).await
}

/// 运行时会话参数更新（所有字段可选，只更新传入的字段）
#[tauri::command]
pub async fn ai_update_session(
    ai_state: State<'_, AiState>,
    session_id: String,
    params: serde_json::Value,
) -> Result<(), String> {
    use flowcloudai_client::ThinkingType;
    use serde_json::{Map, Value};

    fn as_object(params: Value) -> Result<Map<String, Value>, String> {
        params
            .as_object()
            .cloned()
            .ok_or_else(|| "params 必须是对象".to_string())
    }

    fn parse_f64_field(
        obj: &Map<String, Value>,
        key: &str,
        min: Option<f64>,
        max: Option<f64>,
    ) -> Result<Option<Option<f64>>, String> {
        let Some(value) = obj.get(key) else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(Some(None));
        }
        let parsed = value
            .as_f64()
            .ok_or_else(|| format!("参数 '{}' 必须是数字", key))?;
        if !parsed.is_finite() {
            return Err(format!("参数 '{}' 不能是 NaN 或 Infinity", key));
        }
        if let Some(min) = min
            && parsed < min
        {
            return Err(format!("参数 '{}' 不能小于 {}", key, min));
        }
        if let Some(max) = max
            && parsed > max
        {
            return Err(format!("参数 '{}' 不能大于 {}", key, max));
        }
        Ok(Some(Some(parsed)))
    }

    fn parse_i64_field(
        obj: &Map<String, Value>,
        key: &str,
        min: Option<i64>,
        max: Option<i64>,
    ) -> Result<Option<Option<i64>>, String> {
        let Some(value) = obj.get(key) else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(Some(None));
        }
        let parsed = value
            .as_i64()
            .ok_or_else(|| format!("参数 '{}' 必须是整数", key))?;
        if let Some(min) = min
            && parsed < min
        {
            return Err(format!("参数 '{}' 不能小于 {}", key, min));
        }
        if let Some(max) = max
            && parsed > max
        {
            return Err(format!("参数 '{}' 不能大于 {}", key, max));
        }
        Ok(Some(Some(parsed)))
    }

    fn parse_i32_field(
        obj: &Map<String, Value>,
        key: &str,
        min: Option<i32>,
        max: Option<i32>,
    ) -> Result<Option<Option<i32>>, String> {
        let parsed = parse_i64_field(obj, key, min.map(i64::from), max.map(i64::from))?;
        Ok(parsed.map(|inner| inner.map(|value| value as i32)))
    }

    fn parse_bool_field(
        obj: &Map<String, Value>,
        key: &str,
    ) -> Result<Option<Option<bool>>, String> {
        let Some(value) = obj.get(key) else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(Some(None));
        }
        let parsed = value
            .as_bool()
            .ok_or_else(|| format!("参数 '{}' 必须是布尔值", key))?;
        Ok(Some(Some(parsed)))
    }

    fn parse_string_field(
        obj: &Map<String, Value>,
        key: &str,
    ) -> Result<Option<Option<String>>, String> {
        let Some(value) = obj.get(key) else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(Some(None));
        }
        let parsed = value
            .as_str()
            .ok_or_else(|| format!("参数 '{}' 必须是字符串", key))?;
        Ok(Some(Some(parsed.to_string())))
    }

    fn parse_string_list_field(
        obj: &Map<String, Value>,
        key: &str,
    ) -> Result<Option<Option<Vec<String>>>, String> {
        let Some(value) = obj.get(key) else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(Some(None));
        }
        let arr = value
            .as_array()
            .ok_or_else(|| format!("参数 '{}' 必须是字符串数组", key))?;
        let mut result = Vec::with_capacity(arr.len());
        for item in arr {
            let text = item
                .as_str()
                .ok_or_else(|| format!("参数 '{}' 必须是字符串数组", key))?;
            result.push(text.to_string());
        }
        Ok(Some(Some(result)))
    }

    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };
    let params = as_object(params)?;
    let model = parse_string_field(&params, "model")?;
    let temperature = parse_f64_field(&params, "temperature", Some(0.0), Some(2.0))?;
    let max_tokens = parse_i64_field(&params, "maxTokens", Some(1), None)?;
    let stream = parse_bool_field(&params, "stream")?;
    let thinking = parse_bool_field(&params, "thinking")?;
    let frequency_penalty = parse_f64_field(&params, "frequencyPenalty", Some(-2.0), Some(2.0))?;
    let presence_penalty = parse_f64_field(&params, "presencePenalty", Some(-2.0), Some(2.0))?;
    let top_p = parse_f64_field(&params, "topP", Some(0.0), Some(1.0))?;
    let stop = parse_string_list_field(&params, "stop")?;
    let response_format = if params.contains_key("responseFormat") {
        Some(params.get("responseFormat").cloned())
    } else {
        None
    };
    let n = parse_i32_field(&params, "n", Some(1), None)?;
    let tool_choice = parse_string_field(&params, "toolChoice")?;
    let logprobs = parse_bool_field(&params, "logprobs")?;
    let top_logprobs = parse_i64_field(&params, "topLogprobs", Some(0), None)?;

    handle
        .update(|req| {
            if let Some(v) = model {
                if let Some(v) = v {
                    req.model = v;
                }
            }
            if let Some(v) = temperature {
                req.temperature = v;
            }
            if let Some(v) = max_tokens {
                req.max_tokens = v;
            }
            if let Some(v) = stream {
                req.stream = v;
            }
            if let Some(v) = thinking {
                req.thinking = v.map(|flag| {
                    if flag {
                        ThinkingType::enabled()
                    } else {
                        ThinkingType::disabled()
                    }
                });
            }
            if let Some(v) = frequency_penalty {
                req.frequency_penalty = v;
            }
            if let Some(v) = presence_penalty {
                req.presence_penalty = v;
            }
            if let Some(v) = top_p {
                req.top_p = v;
            }
            if let Some(v) = stop {
                req.stop = v;
            }
            if let Some(v) = response_format {
                req.response_format = v;
            }
            if let Some(v) = n {
                req.n = v;
            }
            if let Some(v) = tool_choice {
                req.tool_choice = v;
            }
            if let Some(v) = logprobs {
                req.logprobs = v;
            }
            if let Some(v) = top_logprobs {
                req.top_logprobs = v;
            }
        })
        .await;

    Ok(())
}

/// 向指定会话发送用户消息
#[tauri::command]
pub async fn ai_send_message(
    ai_state: State<'_, AiState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let input_tx = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.input_tx.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };

    input_tx
        .send(message)
        .await
        .map_err(|_| format!("Session '{}' 已关闭", session_id))
}

/// 取消当前进行中的 LLM 轮次
#[tauri::command]
pub async fn ai_cancel_session(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<(), String> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };
    handle.cancel();
    Ok(())
}

/// 关闭并释放 LLM 会话
#[tauri::command]
pub async fn ai_close_session(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<(), String> {
    // 先触发取消，再移除 entry，避免流式请求继续向前端发送事件。
    let removed = ai_state.sessions.lock().await.remove(&session_id);
    if let Some(ref entry) = removed {
        entry.handle.cancel();
    }
    Ok(())
}

/// 关闭并释放所有 LLM 会话
#[tauri::command]
pub async fn ai_close_all_sessions(ai_state: State<'_, AiState>) -> Result<usize, String> {
    let removed = {
        let mut sessions = ai_state.sessions.lock().await;
        sessions.drain().map(|(_, entry)| entry).collect::<Vec<_>>()
    };

    let count = removed.len();
    for entry in removed {
        entry.handle.cancel();
    }

    Ok(count)
}

// ============ 工具管理 ============

/// 启用指定工具
#[tauri::command]
pub async fn ai_enable_tool(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let mut client = ai_state.client.lock().await;
    let registry = client.tool_registry_mut().map_err(|e| e.to_string())?;
    Ok(registry.enable_tool(&name))
}

/// 禁用指定工具
#[tauri::command]
pub async fn ai_disable_tool(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let mut client = ai_state.client.lock().await;
    let registry = client.tool_registry_mut().map_err(|e| e.to_string())?;
    Ok(registry.disable_tool(&name))
}

/// 查询工具是否启用
#[tauri::command]
pub async fn ai_is_enabled(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let client = ai_state.client.lock().await;
    Ok(client.tool_registry().is_enabled(&name))
}

/// 列出所有已注册工具的状态（名称 + 是否启用）
#[derive(Serialize)]
pub struct ToolStatus {
    pub name: String,
    pub enabled: bool,
}

#[tauri::command]
pub async fn ai_list_tools(ai_state: State<'_, AiState>) -> Result<Vec<ToolStatus>, String> {
    let client = ai_state.client.lock().await;
    let registry = client.tool_registry();
    let list = registry
        .tool_names()
        .into_iter()
        .map(|name| ToolStatus {
            name: name.to_string(),
            enabled: registry.is_enabled(&name),
        })
        .collect();
    Ok(list)
}

// ============ 图像生成 ============

#[derive(Serialize)]
pub struct ImageData {
    pub url: Option<String>,
    pub size: Option<String>,
}

async fn make_image_session(ai_state: &AiState, plugin_id: &str) -> Result<ImageSession, String> {
    let api_key = ApiKeyStore::get(plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let client = ai_state.client.lock().await;
    client
        .create_image_session(plugin_id, &api_key)
        .map_err(|e| format!("创建图像会话失败: {}", e))
}

/// 文生图
#[tauri::command]
pub async fn ai_text_to_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session.text_to_image(&model, &prompt).await.map_err(|e| {
        format!(
            "text_to_image 调用失败 [plugin={} model={}]: {}",
            plugin_id, model, e
        )
    })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

/// 图文编辑
#[tauri::command]
pub async fn ai_edit_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    image_url: String,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .edit_image(&model, &prompt, &image_url)
        .await
        .map_err(|e| {
            format!(
                "edit_image 调用失败 [plugin={} model={}]: {}",
                plugin_id, model, e
            )
        })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

/// 多图融合
#[tauri::command]
pub async fn ai_merge_images(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    image_urls: Vec<String>,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .merge_images(&model, &prompt, image_urls)
        .await
        .map_err(|e| {
            format!(
                "merge_images 调用失败 [plugin={} model={}]: {}",
                plugin_id, model, e
            )
        })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

// ============ 语音合成 ============

/// 文本转语音；返回 base64 编码的音频字节和格式（如 "mp3"）
#[derive(Serialize)]
pub struct TtsResult {
    pub audio_base64: String,
    pub audio_url: Option<String>,
    pub format: String,
    pub duration_ms: Option<u64>,
}

#[tauri::command]
pub async fn ai_speak(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<TtsResult, String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;
    let client = ai_state.client.lock().await;
    let session = client
        .create_tts_session(&plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

    let result = session
        .speak(&model, &text, &voice_id)
        .await
        .map_err(|e| e.to_string())?;

    use base64::Engine;
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&result.audio);

    Ok(TtsResult {
        audio_base64,
        audio_url: result.url,
        format: result.format,
        duration_ms: result.duration_ms,
    })
}

/// 文本转语音并直接播放（通过系统音频设备，后台播放，立即返回）
#[tauri::command]
pub async fn ai_play_tts(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<(), String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;
    let client = ai_state.client.lock().await;
    let session = client
        .create_tts_session(&plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

    let result = session
        .speak(&model, &text, &voice_id)
        .await
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        let source = if result.audio.is_empty() {
            match result.url {
                Some(url) if !url.is_empty() => AudioSource::Url(url),
                _ => AudioSource::Raw(result.audio),
            }
        } else {
            AudioSource::Raw(result.audio)
        };
        if let Err(e) = AudioDecoder::play_source(&source, Some(&result.format)).await {
            log::warn!("ai_play_tts 播放失败: {}", e);
        }
    });

    Ok(())
}

// ============ 对话历史管理 ============

/// 列出所有已保存对话的元信息，按 updated_at 降序
#[tauri::command]
pub async fn ai_list_conversations(
    ai_state: State<'_, AiState>,
) -> Result<Vec<ConversationMeta>, String> {
    let client = ai_state.client.lock().await;
    Ok(client.ai_list_conversations())
}

/// 返回完整对话（元信息 + 消息列表）
#[tauri::command]
pub async fn ai_get_conversation(
    ai_state: State<'_, AiState>,
    id: String,
) -> Result<Option<StoredConversation>, String> {
    let client = ai_state.client.lock().await;
    Ok(client.ai_get_conversation(&id))
}

/// 删除指定对话文件
#[tauri::command]
pub async fn ai_delete_conversation(
    ai_state: State<'_, AiState>,
    id: String,
) -> Result<(), String> {
    let client = ai_state.client.lock().await;
    client
        .ai_delete_conversation(&id)
        .map_err(|e| e.to_string())
}

/// 修改对话标题
#[tauri::command]
pub async fn ai_rename_conversation(
    ai_state: State<'_, AiState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let client = ai_state.client.lock().await;
    client
        .ai_rename_conversation(&id, title)
        .map_err(|e| e.to_string())
}

// ============ 编辑确认 ============

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

// ============ 编排上下文 ============

/// 前端传入的任务上下文 DTO。
///
/// 所有字段可选——只传有意义的字段，未传的字段在后端以 Default 填充。
#[derive(Deserialize)]
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
