use super::common::*;

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
    max_tool_rounds: Option<i32>,
    conversation_id: Option<String>,
) -> Result<CreateLlmSessionResult, String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let config = max_tool_rounds.map(|rounds| {
        SessionConfig {
            max_tool_rounds: rounds as usize,
            ..Default::default()
        }
    });
    let mut session = match conversation_id {
        Some(ref conv_id) => client
            .resume_llm_session(&plugin_id, &api_key, conv_id, config)
            .map_err(|e| e.to_string())?,
        None => client
            .create_llm_session(&plugin_id, &api_key, config)
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

    spawn_session_event_loop(app, session_id.clone(), run_id.clone(), event_stream);

    ai_state.sessions.lock().await.insert(
        session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx,
            handle,
            kind: AiSessionKind::General,
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
