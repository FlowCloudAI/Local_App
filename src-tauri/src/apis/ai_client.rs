use crate::AiState;
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
    api_key: String,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<(), String> {
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

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, _handle) = session.run(input_rx, None);

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
                SessionEvent::TurnEnd { status } => {
                    app_clone
                        .emit(
                            "ai:turn_end",
                            EventTurnEnd {
                                session_id: sid.clone(),
                                status: turn_status_str(&status),
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
                _ => {}
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
        .insert(session_id, crate::SessionEntry { input_tx });

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

// ============ 图像生成 ============

#[derive(Serialize)]
pub struct ImageData {
    pub url: Option<String>,
    pub size: Option<String>,
}

async fn make_image_session(
    ai_state: &AiState,
    plugin_id: &str,
    api_key: &str,
) -> Result<ImageSession, String> {
    let client = ai_state.client.lock().await;
    client
        .create_image_session(plugin_id, api_key)
        .map_err(|e| e.to_string())
}

/// 文生图
#[tauri::command]
pub async fn ai_text_to_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    api_key: String,
    model: String,
    prompt: String,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id, &api_key).await?;
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
    api_key: String,
    model: String,
    prompt: String,
    image_url: String,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id, &api_key).await?;
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
    api_key: String,
    model: String,
    prompt: String,
    image_urls: Vec<String>,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id, &api_key).await?;
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
    api_key: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<TtsResult, String> {
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

/// 文本转语音并直接播放（通过系统音频设备）
#[tauri::command]
pub async fn ai_play_tts(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    api_key: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<(), String> {
    let client = ai_state.client.lock().await;
    let session = client
        .create_tts_session(&plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

    let result = session
        .speak(&model, &text, &voice_id)
        .await
        .map_err(|e| e.to_string())?;

    let source = AudioSource::Raw(result.audio);
    AudioDecoder::play_source(&source, Some(&result.format))
        .await
        .map_err(|e| e.to_string())
}
