pub(super) use crate::AiSessionKind;
pub(super) use crate::AiState;
pub(super) use crate::ApiKeyStore;
pub(super) use crate::PathsState;
pub(super) use crate::PendingEditsState;
pub(super) use flowcloudai_client::llm::config::SessionConfig;
pub(super) use flowcloudai_client::{
    image::ImageRequest, AudioDecoder, AudioSource, ConversationMeta, DefaultOrchestrator,
    ImageSession,
    PluginKind, SessionEvent, StoredConversation, TaskContext, TurnStatus, Usage,
};
pub(super) use futures::StreamExt;
pub(super) use serde::{Deserialize, Serialize};
pub(super) use std::collections::HashMap;
pub(super) use std::fs::File;
pub(super) use std::io::{Read, Write};
pub(super) use std::path::Path;
pub(super) use tauri::{AppHandle, Emitter, Manager, State};
pub(super) use tokio::sync::mpsc;
pub(super) use uuid::Uuid;
pub(super) use zip::ZipArchive;

// ============ 前端事件 Payload ============

#[derive(Serialize, Clone)]
pub(crate) struct EventReady {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventDelta {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) text: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventToolCall {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) arguments: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventTurnEnd {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) status: String, // "ok" | "cancelled" | "interrupted" | "error:<msg>"
    pub(crate) node_id: u64,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventTurnBegin {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) turn_id: u64,
    pub(crate) node_id: u64,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventToolResult {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) index: usize,
    pub(crate) output: String,
    pub(crate) result: String,
    pub(crate) is_error: bool,
}

#[derive(Debug, Serialize)]
pub struct CreateLlmSessionResult {
    pub session_id: String,
    pub conversation_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterConversationMeta {
    pub mode: Option<String>,
    pub character_entry_id: Option<String>,
    pub character_name: Option<String>,
    pub background_image_url: Option<String>,
    pub character_voice_id: Option<String>,
    pub character_auto_play: Option<bool>,
    pub report_context: Option<serde_json::Value>,
    pub report_seeded: Option<bool>,
}

pub(super) fn character_conversation_meta_path(
    paths: &PathsState,
) -> Result<std::path::PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir
        .join("chats")
        .join("metadata")
        .join("character_conversations.json"))
}

#[derive(Serialize, Clone)]
pub(crate) struct EventError {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) error: String,
}

pub(crate) fn turn_status_str(s: &TurnStatus) -> String {
    match s {
        TurnStatus::Ok => "ok".to_string(),
        TurnStatus::Cancelled => "cancelled".to_string(),
        TurnStatus::Interrupted => "interrupted".to_string(),
        TurnStatus::Error(e) => format!("error:{}", e),
    }
}

pub(crate) async fn cleanup_session_state(app: &AppHandle, session_id: &str, run_id: &str) {
    let state = app.state::<AiState>();
    let mut sessions = state.sessions.lock().await;
    let current_entry_run_id = sessions.get(session_id).map(|entry| entry.run_id.clone());
    log::info!(
        "[ai:cleanup] session_id={} stream_run_id={} current_entry_run_id={:?}",
        session_id,
        run_id,
        current_entry_run_id
    );
    let should_remove = sessions
        .get(session_id)
        .map(|entry| entry.run_id == run_id)
        .unwrap_or(false);
    if should_remove {
        sessions.remove(session_id);
        drop(sessions);
        state.contradiction_bindings.lock().await.remove(session_id);
    }
}

async fn save_api_usage(app: &AppHandle, session_id: &str, usage: &Usage) {
    let model;
    let plugin_id;
    {
        let ai_state = app.state::<AiState>();
        let sessions = ai_state.sessions.lock().await;
        let Some(entry) = sessions.get(session_id) else {
            log::warn!("[usage] session '{}' not found, skipping save", session_id);
            return;
        };
        model = entry.model.clone();
        plugin_id = entry.plugin_id.clone();
    }

    log::info!(
        "[usage] saving: session={} model={} plugin={} prompt={} completion={} total={}",
        session_id, model, plugin_id,
        usage.prompt_tokens, usage.completion_tokens, usage.total_tokens
    );

    let app_state = app.state::<crate::AppState>();
    let db = app_state.sqlite_db.lock().await;
    let input = worldflow_core::models::CreateApiUsageLog {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        model,
        provider: plugin_id,
        modality: "llm".to_string(),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
    };
    if let Err(e) = worldflow_core::insert_api_usage(&db.pool, &input).await {
        log::error!("[usage] insert failed: {}", e);
    } else {
        log::info!("[usage] saved successfully for session {}", session_id);
    }
}

pub(crate) fn spawn_session_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    event_stream: S,
) where
    S: futures::Stream<Item=SessionEvent> + Send + 'static,
{
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
                SessionEvent::TurnEnd { status, node_id, usage } => {
                    log::info!(
                        "[ai:turn_end] session_id={} run_id={} status={} node_id={} has_usage={}",
                        sid,
                        rid,
                        turn_status_str(&status),
                        node_id,
                        usage.is_some()
                    );
                    if let Some(ref u) = usage {
                        save_api_usage(&app_clone, &sid, u).await;
                    }
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
                SessionEvent::BranchChanged { .. } => {}
            }
        }

        cleanup_session_state(&app_clone, &sid, &rid).await;
    });
}
