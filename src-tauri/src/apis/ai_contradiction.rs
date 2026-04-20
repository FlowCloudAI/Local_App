use crate::ai_services::artifact_parser::parse_json_artifact;
use crate::ai_services::context_builders::{build_contradiction_prompt, build_task_context};
use crate::ai_services::contradiction_loader::{load_contradiction_corpus, ContradictionLoadRequest};
use crate::apis::ai_client::{
    cleanup_session_state, turn_status_str, CreateLlmSessionResult, EventDelta, EventError, EventReady,
    EventToolCall, EventToolResult, EventTurnBegin, EventTurnEnd,
};
use crate::reports::contradiction_report::ContradictionReport;
use crate::senses::contradiction_sense::ContradictionSense;
use crate::AppState;
use crate::{AiSessionKind, AiState, ApiKeyStore, ContradictionSessionBinding};
use flowcloudai_client::sense::Sense;
use flowcloudai_client::{DefaultOrchestrator, SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionSessionRequest {
    pub session_id: String,
    pub plugin_id: String,
    #[serde(flatten)]
    pub load: ContradictionLoadRequest,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionSessionResult {
    #[serde(flatten)]
    pub session: CreateLlmSessionResult,
    pub report: ContradictionReport,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionReportView {
    pub report: ContradictionReport,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn ai_start_contradiction_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<Mutex<AppState>>>,
    request: ContradictionSessionRequest,
) -> Result<ContradictionSessionResult, String> {
    let api_key = ApiKeyStore::get(&request.plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", request.plugin_id))?;

    let corpus = {
        let app_state = app_state.inner().lock().await;
        load_contradiction_corpus(&app_state, &request.load).await?
    };
    let prompt = build_contradiction_prompt(&corpus);

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = ContradictionSense::new();
    let whitelist = sense.tool_whitelist();
    let mut session = client
        .create_llm_session(&request.plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

    session
        .load_sense(sense)
        .await
        .map_err(|e| e.to_string())?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(whitelist),
    ));
    session
        .set_response_format(ContradictionReport::response_format_json_schema())
        .await;

    if let Some(model) = &request.model {
        session.set_model(model).await;
    }
    if let Some(temperature) = request.temperature {
        session.set_temperature(temperature).await;
    }
    if let Some(max_tokens) = request.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let conversation_id = session
        .conversation_id()
        .map(str::to_string)
        .unwrap_or_else(|| request.session_id.clone());

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.run(input_rx);
    let run_id = Uuid::new_v4().to_string();
    let handle_for_error = handle.clone();

    handle
        .set_task_context(build_task_context(
            Some(corpus.project_id.clone()),
            "contradiction_detection",
            HashMap::from([
                ("scope".to_string(), corpus.scope_summary.clone()),
                ("entryCount".to_string(), corpus.source_entry_ids.len().to_string()),
            ]),
            HashMap::from([("read_only".to_string(), true)]),
        ))
        .await?;

    let (first_turn_tx, first_turn_rx) = oneshot::channel::<Result<ContradictionReport, String>>();
    spawn_contradiction_event_loop(
        app,
        request.session_id.clone(),
        run_id.clone(),
        event_stream,
        first_turn_tx,
    );

    ai_state.sessions.lock().await.insert(
        request.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx: input_tx.clone(),
            handle,
            kind: AiSessionKind::Contradiction,
        },
    );

    input_tx
        .send(prompt)
        .await
        .map_err(|_| "矛盾检测会话已关闭".to_string())?;

    let report = match first_turn_rx.await {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => {
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err(error);
        }
        Err(_) => {
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err("矛盾检测首轮未返回结果".to_string());
        }
    };

    ai_state.contradiction_bindings.lock().await.insert(
        request.session_id.clone(),
        ContradictionSessionBinding {
            report: report.clone(),
            scope_summary: corpus.scope_summary.clone(),
            source_entry_ids: corpus.source_entry_ids.clone(),
            truncated: corpus.truncated,
        },
    );

    Ok(ContradictionSessionResult {
        session: CreateLlmSessionResult {
            session_id: request.session_id,
            conversation_id,
            run_id,
        },
        report,
        scope_summary: corpus.scope_summary,
        source_entry_ids: corpus.source_entry_ids,
        truncated: corpus.truncated,
    })
}

#[tauri::command]
pub async fn ai_get_contradiction_report(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<Option<ContradictionReportView>, String> {
    let bindings = ai_state.contradiction_bindings.lock().await;
    Ok(bindings.get(&session_id).map(|binding| ContradictionReportView {
        report: binding.report.clone(),
        scope_summary: binding.scope_summary.clone(),
        source_entry_ids: binding.source_entry_ids.clone(),
        truncated: binding.truncated,
    }))
}

fn spawn_contradiction_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    event_stream: S,
    first_turn_tx: oneshot::Sender<Result<ContradictionReport, String>>,
) where
    S: futures::Stream<Item=SessionEvent> + Send + 'static,
{
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        futures::pin_mut!(event_stream);
        let mut first_turn_sender = Some(first_turn_tx);
        let mut first_turn_buffer = String::new();

        while let Some(event) = event_stream.next().await {
            match event {
                SessionEvent::NeedInput => {
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
                    if first_turn_sender.is_some() {
                        first_turn_buffer.push_str(&text);
                    }
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

                    if let Some(sender) = first_turn_sender.take() {
                        let result = match status {
                            TurnStatus::Ok => {
                                parse_json_artifact::<ContradictionReport>(&first_turn_buffer)
                            }
                            TurnStatus::Cancelled => Err("矛盾检测首轮已取消".to_string()),
                            TurnStatus::Interrupted => Err("矛盾检测首轮被中断".to_string()),
                            TurnStatus::Error(error) => Err(error),
                        };
                        let _ = sender.send(result);
                    }
                }
                SessionEvent::Error(error) => {
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: error.clone(),
                            },
                        )
                        .ok();
                    if let Some(sender) = first_turn_sender.take() {
                        let _ = sender.send(Err(error));
                    }
                    break;
                }
            }
        }

        if let Some(sender) = first_turn_sender.take() {
            let _ = sender.send(Err("矛盾检测会话提前结束".to_string()));
        }

        cleanup_session_state(&app_clone, &sid, &rid).await;
    });
}
