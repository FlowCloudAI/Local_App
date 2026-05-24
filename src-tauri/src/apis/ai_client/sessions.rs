use super::common::*;
use crate::senses::app_sense::AppSense;

/// 创建 LLM 会话并启动后台事件循环。
///
/// 创建后立即可通过 `ai_send_message` 发送消息。
/// 事件通过 Tauri 事件推送到前端：
///
/// - `"ai:ready"`        `{ session_id, run_id }`                      —— 会话就绪，等待用户输入
/// - `"ai:delta"`        `{ session_id, run_id, text }`                —— AI 生成内容片段
/// - `"ai:reasoning"`    `{ session_id, run_id, text }`                —— 思考过程片段
/// - `"ai:tool_call"`    `{ session_id, run_id, index, name }`         —— AI 调用工具
/// - `"ai:turn_end"`     `{ session_id, run_id, status, usage }`       —— 对话结束
/// - `"ai:error"`        `{ session_id, run_id, error }`               —— 发生错误
#[tauri::command]
pub async fn ai_create_llm_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    paths: State<'_, PathsState>,
    session_id: String,
    plugin_id: String,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    max_tool_rounds: Option<i32>,
    conversation_id: Option<String>,
    client_trace_id: Option<String>,
    settings: Option<StoredConversationSettings>,
) -> Result<CreateLlmSessionResult, String> {
    let trace_id = client_trace_id.as_deref().unwrap_or("none");
    log::info!(
        "[ai_create_llm_session][recv] trace_id={} session_id={} plugin_id={} model={:?} conversation_id={:?} temperature={:?} max_tokens={:?} max_tool_rounds={:?}",
        trace_id,
        session_id,
        plugin_id,
        model,
        conversation_id,
        temperature,
        max_tokens,
        max_tool_rounds
    );
    let api_key = match ApiKeyStore::get(&plugin_id) {
        Some(api_key) => api_key,
        None => {
            log::warn!(
                "[ai_create_llm_session][missing_api_key] trace_id={} session_id={} plugin_id={}",
                trace_id,
                session_id,
                plugin_id
            );
            return Err(format!(
                "插件 '{}' 未配置 API Key，请在设置中配置",
                plugin_id
            ));
        }
    };

    log::info!(
        "[ai_create_llm_session][lock_client_start] trace_id={} session_id={} plugin_id={}",
        trace_id,
        session_id,
        plugin_id
    );
    let mut restored_head = None;
    let mut restored_model = None;
    let mut restored_settings = None;
    let mut restored_history = None;
    let resolved_conversation_id = if let Some(conv_id) = conversation_id.as_deref() {
        let conversation = chat_store_get_conversation(paths.inner(), conv_id)?
            .ok_or_else(|| format!("未找到会话：{}", conv_id))?;
        restored_head = conversation.head;
        restored_model = Some(conversation.meta.model.clone());
        restored_settings = Some(conversation.settings.clone());
        restored_history = Some(stored_conversation_to_runtime_seeds(&conversation));
        conversation.meta.id
    } else {
        session_id.clone()
    };

    let client = ai_state.client.lock().await;
    log::info!(
        "[ai_create_llm_session][lock_client_done] trace_id={} session_id={} plugin_id={}",
        trace_id,
        session_id,
        plugin_id
    );
    let registry = client.tool_registry().clone();
    let config = max_tool_rounds.map(|rounds| SessionConfig {
        max_tool_rounds: rounds as usize,
        ..Default::default()
    });
    log::info!(
        "[ai_create_llm_session][create_start] trace_id={} session_id={} plugin_id={} conversation_id={} restored={}",
        trace_id,
        session_id,
        plugin_id,
        resolved_conversation_id,
        restored_history.is_some()
    );
    let mut session = client
        .create_llm_session(&plugin_id, &api_key, config)
        .map_err(|e| {
            log::error!(
                "[ai_create_llm_session][create_failed] trace_id={} session_id={} plugin_id={} error={}",
                trace_id,
                session_id,
                plugin_id,
                e
            );
            e.to_string()
        })?;
    drop(client);

    if let Some(history) = restored_history {
        session.preload_history(history, restored_head);
    }
    session
        .load_sense(AppSense::new())
        .await
        .map_err(|e| e.to_string())?;
    session.set_orchestrator(Box::new(DefaultOrchestrator::new(registry)));

    let model_to_apply = model
        .clone()
        .or_else(|| restored_model.filter(|m| !m.is_empty() && m != "default"));
    let resolved_model = model_to_apply
        .clone()
        .unwrap_or_else(|| "default".to_string());
    if let Some(m) = model_to_apply {
        session.set_model(&m).await;
    }
    if let Some(t) = temperature {
        session.set_temperature(t).await;
    }
    if let Some(n) = max_tokens {
        session.set_max_tokens(n).await;
    }
    session.set_stream(true).await;
    log::info!(
        "[ai_create_llm_session][configured] trace_id={} session_id={} plugin_id={} model={}",
        trace_id,
        session_id,
        plugin_id,
        resolved_model
    );
    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    log::info!(
        "[ai_create_llm_session][try_run_start] trace_id={} session_id={} conversation_id={}",
        trace_id,
        session_id,
        resolved_conversation_id
    );
    let (event_stream, handle) = session.try_run(input_rx).map_err(|e| {
        log::error!(
            "[ai_create_llm_session][try_run_failed] trace_id={} session_id={} conversation_id={} error={}",
            trace_id,
            session_id,
            resolved_conversation_id,
            e
        );
        e.to_string()
    })?;
    let run_id = Uuid::new_v4().to_string();
    let conversation_settings = settings.clone().or(restored_settings);
    log::info!(
        "[ai_create_llm_session][run_started] trace_id={} conversation_id={} session_id={} run_id={} plugin_id={} model={}",
        trace_id,
        resolved_conversation_id,
        session_id,
        run_id,
        plugin_id,
        resolved_model
    );

    spawn_session_event_loop(app, session_id.clone(), run_id.clone(), event_stream);

    {
        let mut sessions = ai_state.sessions.lock().await;
        sessions.insert(
            session_id.clone(),
            crate::SessionEntry {
                run_id: run_id.clone(),
                input_tx,
                handle,
                conversation_id: resolved_conversation_id.clone(),
                kind: AiSessionKind::General,
                model: resolved_model.clone(),
                plugin_id: plugin_id.clone(),
                settings: conversation_settings,
            },
        );
        log::info!(
            "[ai_create_llm_session][registered] trace_id={} session_id={} run_id={} active_count={}",
            trace_id,
            session_id,
            run_id,
            sessions.len()
        );
    }

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
    use serde::Deserialize;

    #[derive(Debug, Default, Deserialize)]
    #[serde(default)]
    struct SessionUpdateParams {
        model: Option<Option<String>>,
        #[serde(rename = "temperature")]
        temperature: Option<Option<f64>>,
        #[serde(rename = "maxTokens")]
        max_tokens: Option<Option<i64>>,
        stream: Option<Option<bool>>,
        thinking: Option<Option<bool>>,
        #[serde(rename = "frequencyPenalty")]
        frequency_penalty: Option<Option<f64>>,
        #[serde(rename = "presencePenalty")]
        presence_penalty: Option<Option<f64>>,
        #[serde(rename = "topP")]
        top_p: Option<Option<f64>>,
        stop: Option<Option<Vec<String>>>,
        #[serde(rename = "responseFormat")]
        response_format: Option<serde_json::Value>,
        n: Option<Option<i32>>,
        #[serde(rename = "toolChoice")]
        tool_choice: Option<Option<String>>,
        logprobs: Option<Option<bool>>,
        #[serde(rename = "topLogprobs")]
        top_logprobs: Option<Option<i64>>,
    }

    fn validate_f64(value: f64, name: &str, min: f64, max: f64) -> Result<(), String> {
        if !value.is_finite() {
            return Err(format!("参数 '{}' 不能是 NaN 或 Infinity", name));
        }
        if value < min || value > max {
            return Err(format!("参数 '{}' 必须在 {}-{} 之间", name, min, max));
        }
        Ok(())
    }

    let params: SessionUpdateParams =
        serde_json::from_value(params).map_err(|e| format!("参数解析失败: {}", e))?;

    if let Some(Some(t)) = params.temperature {
        validate_f64(t, "temperature", 0.0, 2.0)?;
    }
    if let Some(Some(fp)) = params.frequency_penalty {
        validate_f64(fp, "frequencyPenalty", -2.0, 2.0)?;
    }
    if let Some(Some(pp)) = params.presence_penalty {
        validate_f64(pp, "presencePenalty", -2.0, 2.0)?;
    }
    if let Some(Some(tp)) = params.top_p {
        validate_f64(tp, "topP", 0.0, 1.0)?;
    }
    if let Some(Some(mt)) = params.max_tokens {
        if mt < 1 {
            return Err("参数 'maxTokens' 必须大于 0".to_string());
        }
    }
    if let Some(Some(n)) = params.n {
        if n < 1 {
            return Err("参数 'n' 必须大于 0".to_string());
        }
    }
    if let Some(Some(tl)) = params.top_logprobs {
        if tl < 0 {
            return Err("参数 'topLogprobs' 不能为负数".to_string());
        }
    }
    let changed_fields = [
        params.model.is_some().then_some("model"),
        params.temperature.is_some().then_some("temperature"),
        params.max_tokens.is_some().then_some("maxTokens"),
        params.stream.is_some().then_some("stream"),
        params.thinking.is_some().then_some("thinking"),
        params
            .frequency_penalty
            .is_some()
            .then_some("frequencyPenalty"),
        params
            .presence_penalty
            .is_some()
            .then_some("presencePenalty"),
        params.top_p.is_some().then_some("topP"),
        params.stop.is_some().then_some("stop"),
        params.response_format.is_some().then_some("responseFormat"),
        params.n.is_some().then_some("n"),
        params.tool_choice.is_some().then_some("toolChoice"),
        params.logprobs.is_some().then_some("logprobs"),
        params.top_logprobs.is_some().then_some("topLogprobs"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    log::info!(
        "[ai_update_session][recv] session_id={} fields={:?}",
        session_id,
        changed_fields
    );

    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("Session '{}' 不存在", session_id))?
    };

    handle
        .update(|req| {
            if let Some(v) = params.model {
                if let Some(v) = v {
                    req.model = v;
                }
            }
            if let Some(v) = params.temperature {
                req.temperature = v;
            }
            if let Some(v) = params.max_tokens {
                req.max_tokens = v;
            }
            if let Some(v) = params.stream {
                req.stream = v;
            }
            if let Some(v) = params.thinking {
                req.thinking = v.map(|flag| {
                    if flag {
                        ThinkingType::enabled()
                    } else {
                        ThinkingType::disabled()
                    }
                });
            }
            if let Some(v) = params.frequency_penalty {
                req.frequency_penalty = v;
            }
            if let Some(v) = params.presence_penalty {
                req.presence_penalty = v;
            }
            if let Some(v) = params.top_p {
                req.top_p = v;
            }
            if let Some(v) = params.stop {
                req.stop = v;
            }
            if let Some(v) = params.response_format {
                req.response_format = Some(v);
            }
            if let Some(v) = params.n {
                req.n = v;
            }
            if let Some(v) = params.tool_choice {
                req.tool_choice = v;
            }
            if let Some(v) = params.logprobs {
                req.logprobs = v;
            }
            if let Some(v) = params.top_logprobs {
                req.top_logprobs = v;
            }
        })
        .await;
    log::info!(
        "[ai_update_session][applied] session_id={} fields={:?}",
        session_id,
        changed_fields
    );

    Ok(())
}

fn message_log_preview(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let preview: String = normalized.chars().take(120).collect();
    if normalized.chars().count() > 120 {
        format!("{}...", preview)
    } else {
        preview
    }
}

/// 向指定会话发送用户消息
#[tauri::command]
pub async fn ai_send_message(
    ai_state: State<'_, AiState>,
    session_id: String,
    message: String,
    client_trace_id: Option<String>,
) -> Result<(), String> {
    let trace_id = client_trace_id.as_deref().unwrap_or("none");
    let message_bytes = message.len();
    let message_chars = message.chars().count();
    let preview = message_log_preview(&message);
    log::info!(
        "[ai_send_message][recv] trace_id={} session_id={} bytes={} chars={} preview={:?}",
        trace_id,
        session_id,
        message_bytes,
        message_chars,
        preview
    );

    let (input_tx, run_id, plugin_id, model, kind, channel_capacity, channel_max_capacity) = {
        let sessions = ai_state.sessions.lock().await;
        let active_count = sessions.len();
        let Some(entry) = sessions.get(&session_id) else {
            let active_session_ids = sessions.keys().cloned().collect::<Vec<_>>();
            log::warn!(
                "[ai_send_message][missing_session] trace_id={} session_id={} active_count={} active_session_ids={:?}",
                trace_id,
                session_id,
                active_count,
                active_session_ids
            );
            return Err(format!("Session '{}' 不存在", session_id));
        };
        log::info!(
            "[ai_send_message][session_found] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={} active_count={} channel_capacity={} channel_max_capacity={}",
            trace_id,
            session_id,
            entry.run_id,
            entry.kind,
            entry.plugin_id,
            entry.model,
            active_count,
            entry.input_tx.capacity(),
            entry.input_tx.max_capacity()
        );
        (
            entry.input_tx.clone(),
            entry.run_id.clone(),
            entry.plugin_id.clone(),
            entry.model.clone(),
            entry.kind.clone(),
            entry.input_tx.capacity(),
            entry.input_tx.max_capacity(),
        )
    };

    input_tx
        .send(message)
        .await
        .map_err(|_| {
            log::error!(
                "[ai_send_message][channel_closed] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={}",
                trace_id,
                session_id,
                run_id,
                kind,
                plugin_id,
                model
            );
            format!("Session '{}' 已关闭", session_id)
        })?;
    log::info!(
        "[ai_send_message][queued] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={} bytes={} chars={} previous_capacity={} previous_max_capacity={} current_capacity={}",
        trace_id,
        session_id,
        run_id,
        kind,
        plugin_id,
        model,
        message_bytes,
        message_chars,
        channel_capacity,
        channel_max_capacity,
        input_tx.capacity()
    );
    Ok(())
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
    ai_state
        .contradiction_bindings
        .lock()
        .await
        .remove(&session_id);
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
    ai_state.contradiction_bindings.lock().await.clear();

    Ok(count)
}
