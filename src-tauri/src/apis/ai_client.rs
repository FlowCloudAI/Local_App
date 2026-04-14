use crate::AiState;
use crate::ApiKeyStore;
use flowcloudai_client::{
    AudioDecoder, AudioSource, ImageSession, PluginKind, SessionEvent, TurnStatus,
};
use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

// ============ 前端事件 Payload ============

#[derive(Serialize, Clone)]
struct EventDelta {
    session_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct EventToolCall {
    session_id: String,
    index: usize,
    name: String,
}

#[derive(Serialize, Clone)]
struct EventTurnEnd {
    session_id: String,
    status: String, // "ok" | "cancelled" | "interrupted" | "error:<msg>"
    node_id: u64,
}

#[derive(Serialize, Clone)]
struct EventTurnBegin {
    session_id: String,
    turn_id: u64,
    node_id: u64,
}

#[derive(Serialize, Clone)]
struct EventToolResult {
    session_id: String,
    index: usize,
    output: String,
    is_error: bool,
}

#[derive(Serialize, Clone)]
struct EventError {
    session_id: String,
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
/// - `"ai:ready"`        `{ session_id }`              —— 会话就绪，等待用户输入
/// - `"ai:delta"`        `{ session_id, text }`        —— AI 生成内容片段
/// - `"ai:reasoning"`    `{ session_id, text }`        —— 思考过程片段
/// - `"ai:tool_call"`    `{ session_id, index, name }` —— AI 调用工具
/// - `"ai:turn_end"`     `{ session_id, status }`      —— 对话结束
/// - `"ai:error"`        `{ session_id, error }`       —— 发生错误
#[tauri::command]
pub async fn ai_create_llm_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    session_id: String,
    plugin_id: String,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<(), String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let client = ai_state.client.lock().await;
    let mut session = client
        .create_llm_session(&plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

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

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.run(input_rx, None);

    // 启动后台事件循环
    let sid = session_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        futures::pin_mut!(event_stream);
        while let Some(ev) = event_stream.next().await {
            match ev {
                SessionEvent::NeedInput => {
                    app_clone.emit("ai:ready", &sid).ok();
                }
                SessionEvent::TurnBegin { turn_id, node_id } => {
                    app_clone
                        .emit(
                            "ai:turn_begin",
                            EventTurnBegin {
                                session_id: sid.clone(),
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
                                text,
                            },
                        )
                        .ok();
                }
                SessionEvent::ToolCall { index, name } => {
                    app_clone
                        .emit(
                            "ai:tool_call",
                            EventToolCall {
                                session_id: sid.clone(),
                                index,
                                name,
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
                                index,
                                output,
                                is_error,
                            },
                        )
                        .ok();
                }
                SessionEvent::TurnEnd { status, node_id } => {
                    app_clone
                        .emit(
                            "ai:turn_end",
                            EventTurnEnd {
                                session_id: sid.clone(),
                                status: turn_status_str(&status),
                                node_id,
                            },
                        )
                        .ok();
                }
                SessionEvent::Error(e) => {
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                error: e,
                            },
                        )
                        .ok();
                    break;
                }
            }
        }

        // 事件流结束，清理 session
        app_clone
            .state::<AiState>()
            .sessions
            .lock()
            .await
            .remove(&sid);
    });

    ai_state
        .sessions
        .lock()
        .await
        .insert(session_id, crate::SessionEntry { input_tx, handle });

    Ok(())
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
    let sessions = ai_state.sessions.lock().await;
    let entry = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session '{}' 不存在", session_id))?;

    entry.handle.checkout(node_id).await
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

    let sessions = ai_state.sessions.lock().await;
    let entry = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session '{}' 不存在", session_id))?;

    entry.handle.switch_plugin(&plugin_id, &api_key).await
}

/// 运行时会话参数更新（所有字段可选，只更新传入的字段）
#[derive(serde::Deserialize)]
pub struct UpdateSessionParams {
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub stream: Option<bool>,
    pub thinking: Option<bool>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub top_p: Option<f64>,
    pub stop: Option<Vec<String>>,
    pub response_format: Option<serde_json::Value>,
    pub n: Option<i32>,
    pub tool_choice: Option<String>,
    pub logprobs: Option<bool>,
    pub top_logprobs: Option<i64>,
}

#[tauri::command]
pub async fn ai_update_session(
    ai_state: State<'_, AiState>,
    session_id: String,
    params: UpdateSessionParams,
) -> Result<(), String> {
    use flowcloudai_client::ThinkingType;

    let sessions = ai_state.sessions.lock().await;
    let entry = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session '{}' 不存在", session_id))?;

    entry
        .handle
        .update(|req| {
            if let Some(v) = params.model {
                req.model = v;
            }
            if let Some(v) = params.temperature {
                req.temperature = Some(v);
            }
            if let Some(v) = params.max_tokens {
                req.max_tokens = Some(v);
            }
            if let Some(v) = params.stream {
                req.stream = Some(v);
            }
            if let Some(v) = params.thinking {
                req.thinking = Some(if v {
                    ThinkingType::enabled()
                } else {
                    ThinkingType::disabled()
                });
            }
            if let Some(v) = params.frequency_penalty {
                req.frequency_penalty = Some(v);
            }
            if let Some(v) = params.presence_penalty {
                req.presence_penalty = Some(v);
            }
            if let Some(v) = params.top_p {
                req.top_p = Some(v);
            }
            if let Some(v) = params.stop {
                req.stop = Some(v);
            }
            if let Some(v) = params.response_format {
                req.response_format = Some(v);
            }
            if let Some(v) = params.n {
                req.n = Some(v);
            }
            if let Some(v) = params.tool_choice {
                req.tool_choice = Some(v);
            }
            if let Some(v) = params.logprobs {
                req.logprobs = Some(v);
            }
            if let Some(v) = params.top_logprobs {
                req.top_logprobs = Some(v);
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
    let sessions = ai_state.sessions.lock().await;
    let entry = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session '{}' 不存在", session_id))?;

    entry
        .input_tx
        .send(message)
        .await
        .map_err(|_| format!("Session '{}' 已关闭", session_id))
}

/// 关闭并释放 LLM 会话
#[tauri::command]
pub async fn ai_close_session(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<(), String> {
    // 移除 entry，input_tx drop 后 session 内部循环自然退出
    ai_state.sessions.lock().await.remove(&session_id);
    Ok(())
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
        .map_err(|e| e.to_string())
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
    let result = session
        .text_to_image(&model, &prompt)
        .await
        .map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?;

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
        let source = AudioSource::Raw(result.audio);
        if let Err(e) = AudioDecoder::play_source(&source, Some(&result.format)).await {
            log::warn!("ai_play_tts 播放失败: {}", e);
        }
    });

    Ok(())
}
