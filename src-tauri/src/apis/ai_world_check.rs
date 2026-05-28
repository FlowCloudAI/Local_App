use crate::ai_services::artifact_parser::parse_json_artifact;
use crate::ai_services::context_builders::{build_task_context, build_world_check_prompt};
use crate::ai_services::world_check::{
    WorldCheckLoadRequest, load_world_check_corpus, world_check_definition,
};
use crate::apis::ai_client::{
    CreateLlmSessionResult, EventDelta, EventError, EventReady, EventToolCall, EventToolResult,
    EventTurnBegin, EventTurnEnd, cleanup_session_state, save_api_usage, turn_status_str,
};
use crate::reports::world_check_report::{WorldCheckKind, WorldCheckReport};
use crate::senses::world_check_sense::WorldCheckSense;
use crate::{AiSessionKind, AiState, ApiError, ApiKeyStore, AppState};
use flowcloudai_client::llm::config::SessionConfig;
use flowcloudai_client::{DefaultOrchestrator, ErrorCode, SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{Mutex, mpsc, oneshot};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckSessionRequest {
    pub session_id: String,
    pub plugin_id: String,
    pub check_kind: WorldCheckKind,
    #[serde(flatten)]
    pub load: WorldCheckLoadRequest,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub max_tool_rounds: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckSessionResult {
    #[serde(flatten)]
    pub session: CreateLlmSessionResult,
    pub check_kind: WorldCheckKind,
    pub report: WorldCheckReport,
    pub project_id: String,
    pub project_name: String,
    pub plugin_id: String,
    pub model: Option<String>,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn ai_start_world_check_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<Mutex<AppState>>>,
    request: WorldCheckSessionRequest,
) -> Result<WorldCheckSessionResult, ApiError> {
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

    let check_definition = world_check_definition(request.check_kind);
    if check_definition.requires_target_entry && request.load.target_entry_id.is_none() {
        return Err(ApiError::internal(format!(
            "{}需要传入 targetEntryId",
            check_definition.title
        )));
    }

    let corpus = {
        let app_state = app_state.inner().lock().await;
        load_world_check_corpus(&app_state, &request.load)
            .await
            .map_err(ApiError::internal)?
    };
    if check_definition.requires_target_entry && corpus.target_entry_block.is_none() {
        return Err(ApiError::internal(format!(
            "{}未能载入目标词条",
            check_definition.title
        )));
    }

    let prompt = build_world_check_prompt(&check_definition, &corpus);

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = WorldCheckSense::new(check_definition.clone());
    let whitelist = check_definition.tool_whitelist.clone();
    let config = Some(SessionConfig {
        max_tool_rounds: request.max_tool_rounds.unwrap_or(50),
        ..Default::default()
    });
    let mut session = client.create_llm_session(&request.plugin_id, &api_key, config)?;
    drop(client);

    session.load_sense(sense).await?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(Some(whitelist)),
    ));
    session
        .set_response_format(json!({ "type": "json_object" }))
        .await;

    if let Some(model) = &request.model {
        session.set_model(model).await;
    }
    if let Some(temperature) = request.temperature {
        session.set_temperature(temperature).await;
    } else {
        session
            .set_temperature(check_definition.default_temperature)
            .await;
    }
    if let Some(max_tokens) = request.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let conversation_id = request.session_id.clone();
    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.try_run(input_rx)?;
    let run_id = Uuid::new_v4().to_string();
    let handle_for_error = handle.clone();

    handle
        .set_task_context(build_task_context(
            Some(corpus.project_id.clone()),
            check_definition.task_type,
            HashMap::from([
                (
                    "checkKind".to_string(),
                    check_definition.kind.as_str().to_string(),
                ),
                (
                    "promptTemplate".to_string(),
                    check_definition.prompt_template.to_string(),
                ),
                (
                    "systemTemplate".to_string(),
                    check_definition.system_template.to_string(),
                ),
                ("scope".to_string(), corpus.scope_summary.clone()),
                (
                    "entryCount".to_string(),
                    corpus.source_entry_ids.len().to_string(),
                ),
            ]),
            HashMap::from([("read_only".to_string(), true)]),
        ))
        .await
        .map_err(ApiError::internal)?;

    let (first_turn_tx, first_turn_rx) = oneshot::channel::<Result<WorldCheckReport, String>>();
    spawn_world_check_event_loop(
        app.clone(),
        request.session_id.clone(),
        run_id.clone(),
        event_stream,
        first_turn_tx,
    );

    let resolved_model = request
        .model
        .clone()
        .unwrap_or_else(|| "default".to_string());
    ai_state.sessions.lock().await.insert(
        request.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx: input_tx.clone(),
            handle,
            conversation_id: conversation_id.clone(),
            kind: AiSessionKind::WorldCheck,
            model: resolved_model,
            plugin_id: request.plugin_id.clone(),
            settings: None,
        },
    );

    input_tx
        .send(prompt)
        .await
        .map_err(|_| ApiError::new(ErrorCode::LlmSessionClosed, "检测会话已关闭"))?;

    let report = match first_turn_rx.await {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => {
            let api_err = ApiError::internal(error);
            app.emit(
                "ai:error",
                EventError {
                    session_id: request.session_id.clone(),
                    run_id: run_id.clone(),
                    error: api_err.clone(),
                },
            )
            .ok();
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err(api_err);
        }
        Err(_) => {
            let api_err = ApiError::internal("检测首轮未返回结果");
            app.emit(
                "ai:error",
                EventError {
                    session_id: request.session_id.clone(),
                    run_id: run_id.clone(),
                    error: api_err.clone(),
                },
            )
            .ok();
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err(api_err);
        }
    };

    if let Some(handle) = ai_state
        .sessions
        .lock()
        .await
        .get(&request.session_id)
        .map(|entry| entry.handle.clone())
    {
        handle
            .update(|req| {
                req.response_format = None;
            })
            .await;
    }

    Ok(WorldCheckSessionResult {
        session: CreateLlmSessionResult {
            session_id: request.session_id,
            conversation_id,
            run_id,
        },
        check_kind: request.check_kind,
        report,
        project_id: corpus.project_id,
        project_name: corpus.project_name,
        plugin_id: request.plugin_id,
        model: request.model,
        scope_summary: corpus.scope_summary,
        source_entry_ids: corpus.source_entry_ids,
        target_entry_id: corpus.target_entry_id,
        truncated: corpus.truncated,
    })
}

fn spawn_world_check_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    event_stream: S,
    first_turn_tx: oneshot::Sender<Result<WorldCheckReport, String>>,
) where
    S: futures::Stream<Item = SessionEvent> + Send + 'static,
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
                SessionEvent::TurnEnd {
                    status,
                    node_id,
                    usage,
                } => {
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
                                usage,
                            },
                        )
                        .ok();

                    log::info!(
                        "[world_check] 原始响应 ({} chars): {}",
                        first_turn_buffer.len(),
                        first_turn_buffer
                    );
                    app_clone
                        .emit(
                            "ai:debug_raw_response",
                            EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text: first_turn_buffer.clone(),
                            },
                        )
                        .ok();

                    if let Some(sender) = first_turn_sender.take() {
                        let result = match status {
                            TurnStatus::Ok => {
                                parse_json_artifact::<WorldCheckReport>(&first_turn_buffer)
                            }
                            TurnStatus::Cancelled => Err("检测首轮已取消".to_string()),
                            TurnStatus::Interrupted => Err("检测首轮被中断".to_string()),
                            TurnStatus::Error(error) => Err(error.to_string()),
                        };
                        let _ = sender.send(result);
                    }
                }
                SessionEvent::Error(error) => {
                    let api_err: crate::ApiError = error.clone().into();
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: api_err,
                            },
                        )
                        .ok();
                    if let Some(sender) = first_turn_sender.take() {
                        let _ = sender.send(Err(error.to_string()));
                    }
                    break;
                }
                SessionEvent::BranchChanged { .. } => {}
            }
        }

        if let Some(sender) = first_turn_sender.take() {
            let _ = sender.send(Err("检测会话提前结束".to_string()));
        }

        cleanup_session_state(&app_clone, &sid, &rid).await;
    });
}
