use crate::apis::ai_client::{spawn_session_event_loop, CreateLlmSessionResult};
use crate::senses::character_sense::{CharacterProjectSnapshot, CharacterSense};
use crate::{AiSessionKind, AiState, ApiKeyStore};
use flowcloudai_client::{sense::Sense, DefaultOrchestrator};
use serde::Deserialize;
use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSessionInput {
    pub session_id: String,
    pub plugin_id: String,
    pub character_name: String,
    pub project_snapshot: CharacterProjectSnapshot,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

#[tauri::command]
pub async fn ai_create_character_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    input: CharacterSessionInput,
) -> Result<CreateLlmSessionResult, String> {
    let api_key = ApiKeyStore::get(&input.plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", input.plugin_id))?;

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = CharacterSense::new(
        input.character_name.clone(),
        input.project_snapshot.clone(),
    );
    let whitelist = sense.tool_whitelist();
    let mut session = client
        .create_llm_session(&input.plugin_id, &api_key)
        .map_err(|e| e.to_string())?;
    drop(client);

    session
        .load_sense(sense)
        .await
        .map_err(|e| e.to_string())?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(whitelist),
    ));

    if let Some(model) = &input.model {
        session.set_model(model).await;
    }
    if let Some(temperature) = input.temperature {
        session.set_temperature(temperature).await;
    }
    if let Some(max_tokens) = input.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let conversation_id = session
        .conversation_id()
        .map(str::to_string)
        .unwrap_or_else(|| input.session_id.clone());

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.run(input_rx);
    let run_id = Uuid::new_v4().to_string();

    spawn_session_event_loop(app, input.session_id.clone(), run_id.clone(), event_stream);

    ai_state.sessions.lock().await.insert(
        input.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx,
            handle,
            kind: AiSessionKind::Character,
        },
    );

    Ok(CreateLlmSessionResult {
        session_id: input.session_id,
        conversation_id,
        run_id,
    })
}
