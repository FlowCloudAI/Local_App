pub(super) use crate::AiSessionKind;
pub(super) use crate::AiState;
pub(super) use crate::ApiKeyStore;
pub(super) use crate::PathsState;
pub(super) use crate::PendingEditsState;
pub(super) use flowcloudai_client::llm::config::SessionConfig;
pub(super) use flowcloudai_client::{
    AudioDecoder, AudioSource, ConversationMeta, DefaultOrchestrator, ImageSession, PluginKind,
    SessionEvent, StoredConversation, TaskContext, TurnStatus, Usage, image::ImageRequest,
};
pub(super) use futures::StreamExt;
pub(super) use serde::{Deserialize, Serialize};
pub(super) use std::collections::HashMap;
pub(super) use std::fs::File;
pub(super) use std::io::{Read, Write};
pub(super) use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;
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

#[derive(Serialize, Clone)]
pub(crate) struct EventBranchChanged {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) node_id: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationUiState {
    pub pinned_at: Option<String>,
    pub archived_at: Option<String>,
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

pub(super) fn conversation_ui_state_path(
    paths: &PathsState,
) -> Result<std::path::PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir
        .join("chats")
        .join("metadata")
        .join("conversation_ui_state.json"))
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

pub(crate) async fn save_api_usage(app: &AppHandle, session_id: &str, usage: &Usage) {
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
        session_id,
        model,
        plugin_id,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens
    );

    let app_state = app.state::<std::sync::Arc<tokio::sync::Mutex<crate::AppState>>>();
    let state = app_state.lock().await;
    let db = state.sqlite_db.lock().await;
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

fn schedule_turn_begin_stall_watchdog(
    app: AppHandle,
    session_id: String,
    run_id: String,
    turn_id: u64,
    node_id: u64,
    event_seq: Arc<AtomicU64>,
    turn_begin_seq: u64,
    delay_secs: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        if event_seq.load(Ordering::Relaxed) != turn_begin_seq {
            return;
        }

        let ai_state = app.state::<AiState>();
        let snapshot_target = {
            let sessions = ai_state.sessions.lock().await;
            sessions.get(&session_id).map(|entry| {
                (
                    entry.handle.clone(),
                    entry.kind.clone(),
                    entry.plugin_id.clone(),
                    entry.model.clone(),
                    sessions.len(),
                )
            })
        };
        if let Some((handle, kind, plugin_id, model, active_count)) = snapshot_target {
            log::warn!(
                "[ai:turn_stall] session_id={} run_id={} turn_id={} node_id={} stalled_secs={} kind={:?} plugin_id={} model={} active_count={} hint=turn_begin 后没有收到 delta/tool/turn_end/error，卡点在 client 内部的 snapshot/orchestrator/prepare_request/http_send/stream_read 阶段",
                session_id,
                run_id,
                turn_id,
                node_id,
                delay_secs,
                kind,
                plugin_id,
                model,
                active_count
            );
            log::warn!(
                "[ai:turn_stall_snapshot][start] session_id={} run_id={} stalled_secs={} timeout_secs=3",
                session_id,
                run_id,
                delay_secs
            );
            match tokio::time::timeout(Duration::from_secs(3), handle.get_conversation()).await {
                Ok(req) => {
                    let tool_count = req.tools.as_ref().map_or(0, Vec::len);
                    let content_chars: usize = req
                        .messages
                        .iter()
                        .filter_map(|message| message.content.as_ref())
                        .map(|content| content.chars().count())
                        .sum();
                    let last_role = req
                        .messages
                        .last()
                        .map(|message| message.role.as_str())
                        .unwrap_or("<none>");
                    log::warn!(
                        "[ai:turn_stall_snapshot] session_id={} run_id={} stalled_secs={} snapshot_read=ok messages={} last_role={} content_chars={} tool_count={} stream={:?} thinking_set={}",
                        session_id,
                        run_id,
                        delay_secs,
                        req.messages.len(),
                        last_role,
                        content_chars,
                        tool_count,
                        req.stream,
                        req.thinking.is_some()
                    );
                }
                Err(_) => {
                    log::warn!(
                        "[ai:turn_stall_snapshot] session_id={} run_id={} stalled_secs={} snapshot_read=timeout timeout_secs=3 hint=读取 session 快照超时，优先检查 conversation/tree 锁或快照线性化",
                        session_id,
                        run_id,
                        delay_secs
                    );
                }
            }
        } else {
            log::warn!(
                "[ai:turn_stall] session_id={} run_id={} turn_id={} node_id={} stalled_secs={} session_missing=true hint=turn_begin 后没有收到下游事件，但 session 已不在活动表中",
                session_id,
                run_id,
                turn_id,
                node_id,
                delay_secs
            );
        }
    });
}

pub(crate) fn spawn_session_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    event_stream: S,
) where
    S: futures::Stream<Item = SessionEvent> + Send + 'static,
{
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("[ai:event_loop][start] session_id={} run_id={}", sid, rid);
        futures::pin_mut!(event_stream);
        let event_seq = Arc::new(AtomicU64::new(0));
        while let Some(ev) = event_stream.next().await {
            let current_event_seq = event_seq.fetch_add(1, Ordering::Relaxed) + 1;
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
                    for delay_secs in [15_u64, 45, 90] {
                        schedule_turn_begin_stall_watchdog(
                            app_clone.clone(),
                            sid.clone(),
                            rid.clone(),
                            turn_id,
                            node_id,
                            Arc::clone(&event_seq),
                            current_event_seq,
                            delay_secs,
                        );
                    }
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
                    log::info!("[ai:delta] run_id={} len={}", rid, text.len());
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
                    log::info!("[ai:reasoning] run_id={} len={}", rid, text.len());
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
                    log::info!(
                        "[ai:tool_call] run_id={} index={} name={} args_len={}",
                        rid,
                        index,
                        name,
                        arguments.len()
                    );
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
                    log::info!(
                        "[ai:tool_result] run_id={} index={} is_error={} output_len={}",
                        rid,
                        index,
                        is_error,
                        output.len()
                    );
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
                SessionEvent::TurnEnd {
                    status,
                    node_id,
                    usage,
                } => {
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
                SessionEvent::BranchChanged { node_id } => {
                    log::info!("[ai:branch_changed] run_id={} node_id={}", rid, node_id);
                    app_clone
                        .emit(
                            "ai:branch_changed",
                            EventBranchChanged {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                node_id,
                            },
                        )
                        .ok();
                }
            }
        }

        log::info!(
            "[ai:event_loop][finished] session_id={} run_id={}",
            sid,
            rid
        );
        cleanup_session_state(&app_clone, &sid, &rid).await;
    });
}
