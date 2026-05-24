pub(super) use crate::AiSessionKind;
pub(super) use crate::AiState;
pub(super) use crate::ApiKeyStore;
pub(super) use crate::PathsState;
pub(super) use crate::PendingEditsState;
pub(super) use flowcloudai_client::llm::config::SessionConfig;
pub(super) use flowcloudai_client::{
    AudioDecoder, AudioSource, ConversationNode, ConversationNodeSeed, DefaultOrchestrator,
    ImageSession, PluginKind, SessionEvent, TaskContext, TurnStatus, Usage, image::ImageRequest,
    llm::types::{Message, ToolCall},
};
pub(super) use futures::StreamExt;
pub(super) use serde::{Deserialize, Serialize};
pub(super) use std::collections::{HashMap, HashSet};
pub(super) use std::fs::File;
pub(super) use std::io::{Read, Write};
pub(super) use std::path::{Path, PathBuf};
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
    pub(crate) usage: Option<Usage>,
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

/// 对话元信息（不含消息体，用于列表展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub plugin_id: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}

/// App 侧保存的单条对话消息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<u64>,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

/// compact 文本的 App 侧元数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCompact {
    pub position_node_id: u64,
    pub text: String,
    pub created_at: String,
}

/// 当前对话独有的大模型参数与系统提示词。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StoredConversationSettings {
    pub temperature: f64,
    pub top_p: f64,
    pub frequency_penalty_enabled: bool,
    pub frequency_penalty: f64,
    pub presence_penalty_enabled: bool,
    pub presence_penalty: f64,
    pub system_prompt: String,
}

impl Default for StoredConversationSettings {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 1.0,
            frequency_penalty_enabled: false,
            frequency_penalty: 1.1,
            presence_penalty_enabled: false,
            presence_penalty: 0.0,
            system_prompt: String::new(),
        }
    }
}

impl StoredConversationSettings {
    pub fn is_default(value: &Self) -> bool {
        value == &Self::default()
    }
}

/// App 侧对话文件结构，兼容旧 core v3 JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConversation {
    #[serde(default = "default_conversation_schema_version")]
    pub schema_version: u32,
    #[serde(flatten)]
    pub meta: ConversationMeta,
    #[serde(default, skip_serializing_if = "StoredConversationSettings::is_default")]
    pub settings: StoredConversationSettings,
    pub messages: Vec<StoredMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compact: Option<StoredCompact>,
}

fn default_conversation_schema_version() -> u32 {
    3
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

pub(super) fn conversations_dir(paths: &PathsState) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("chats"))
}

fn sanitize_conversation_id(id: &str) -> Result<&str, String> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'));
    if valid {
        Ok(id)
    } else {
        Err("无效的会话 ID".to_string())
    }
}

fn conversation_file_path(paths: &PathsState, id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_conversation_id(id)?;
    Ok(conversations_dir(paths)?.join(format!("{}.json", safe_id)))
}

pub(super) fn chat_store_list_conversations(
    paths: &PathsState,
) -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir(paths)?;
    let mut metas = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(metas);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<StoredConversation>(&content).ok())
        {
            Some(conversation) => metas.push(conversation.meta),
            None => log::warn!("[chat_store] 解析对话文件失败: path={}", path.display()),
        }
    }

    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(metas)
}

pub(super) fn chat_store_get_conversation(
    paths: &PathsState,
    id: &str,
) -> Result<Option<StoredConversation>, String> {
    let path = conversation_file_path(paths, id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取对话文件失败 {:?}: {}", path, e))?;
    serde_json::from_str::<StoredConversation>(&content)
        .map(Some)
        .map_err(|e| format!("解析对话文件失败 {:?}: {}", path, e))
}

pub(super) fn chat_store_save_conversation(
    paths: &PathsState,
    conversation: &StoredConversation,
) -> Result<(), String> {
    let path = conversation_file_path(paths, &conversation.meta.id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建对话目录失败 {:?}: {}", parent, e))?;
    }

    let json = serde_json::to_string_pretty(conversation)
        .map_err(|e| format!("序列化对话失败: {}", e))?;
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("创建对话临时文件失败 {:?}: {}", temp_path, e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("写入对话临时文件失败 {:?}: {}", temp_path, e))?;
        file.flush()
            .map_err(|e| format!("刷新对话临时文件失败 {:?}: {}", temp_path, e))?;
    }

    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("移除旧对话文件失败 {:?}: {}", path, e))?;
    }
    std::fs::rename(&temp_path, &path).map_err(|e| format!("保存对话文件失败 {:?}: {}", path, e))
}

pub(super) fn chat_store_delete_conversation(paths: &PathsState, id: &str) -> Result<(), String> {
    let path = conversation_file_path(paths, id)?;
    if !path.exists() {
        return Err(format!("未找到会话：{}", id));
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除对话文件失败 {:?}: {}", path, e))
}

pub(super) fn chat_store_rename_conversation(
    paths: &PathsState,
    id: &str,
    title: String,
) -> Result<(), String> {
    let mut conversation =
        chat_store_get_conversation(paths, id)?.ok_or_else(|| format!("未找到会话：{}", id))?;
    conversation.meta.title = title;
    conversation.meta.updated_at = chrono::Utc::now().to_rfc3339();
    chat_store_save_conversation(paths, &conversation)
}

pub(super) fn stored_messages_to_seeds(messages: Vec<StoredMessage>) -> Vec<ConversationNodeSeed> {
    messages
        .into_iter()
        .map(|message| ConversationNodeSeed {
            node_id: message.node_id,
            parent: message.parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp),
            message: Message {
                role: message.role,
                content: message.content,
                reasoning_content: message.reasoning,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
            },
        })
        .collect()
}

fn compact_runtime_content(text: &str) -> String {
    format!(
        "以下是此前对话的压缩摘要，代表本摘要之前的完整聊天记录。继续对话时请把它当作历史上下文，但不要向用户主动提及压缩。\n\n{}",
        text.trim()
    )
}

pub(super) fn active_message_path(
    messages: &[StoredMessage],
    head: Option<u64>,
) -> Vec<StoredMessage> {
    let by_id = messages
        .iter()
        .filter_map(|message| message.node_id.map(|node_id| (node_id, message)))
        .collect::<HashMap<_, _>>();
    let mut current = head.or_else(|| messages.iter().rev().find_map(|message| message.node_id));
    let mut path = Vec::new();
    let mut visited = HashSet::new();

    while let Some(node_id) = current {
        if !visited.insert(node_id) {
            log::warn!(
                "[chat_store] active path detected parent cycle at node_id={}",
                node_id
            );
            break;
        }
        let Some(message) = by_id.get(&node_id) else {
            break;
        };
        path.push((*message).clone());
        current = message.parent;
    }

    path.reverse();
    path
}

pub(super) fn stored_conversation_to_runtime_seeds(
    conversation: &StoredConversation,
) -> Vec<ConversationNodeSeed> {
    let Some(compact) = conversation.compact.as_ref() else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let path = active_message_path(&conversation.messages, conversation.head);
    let Some(boundary_index) = path
        .iter()
        .position(|message| message.node_id == Some(compact.position_node_id))
    else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let Some(boundary_message) = path.get(boundary_index) else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let mut seeds = Vec::new();
    let mut parent = None;
    for message in path[..=boundary_index]
        .iter()
        .filter(|message| message.role == "system")
    {
        let node_id = message.node_id;
        seeds.push(ConversationNodeSeed {
            node_id,
            parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp.clone()),
            message: Message {
                role: message.role.clone(),
                content: message.content.clone(),
                reasoning_content: message.reasoning.clone(),
                tool_call_id: message.tool_call_id.clone(),
                tool_calls: message.tool_calls.clone(),
            },
        });
        if node_id.is_some() {
            parent = node_id;
        }
    }

    seeds.push(ConversationNodeSeed {
        node_id: Some(compact.position_node_id),
        parent,
        turn_id: boundary_message.turn_id,
        timestamp: Some(boundary_message.timestamp.clone()),
        message: Message::system(compact_runtime_content(&compact.text)),
    });

    parent = Some(compact.position_node_id);
    for message in path.into_iter().skip(boundary_index + 1) {
        let node_id = message.node_id;
        seeds.push(ConversationNodeSeed {
            node_id,
            parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp),
            message: Message {
                role: message.role,
                content: message.content,
                reasoning_content: message.reasoning,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
            },
        });
        parent = node_id;
    }

    seeds
}

fn conversation_nodes_to_stored_messages(nodes: Vec<ConversationNode>) -> Vec<StoredMessage> {
    nodes
        .into_iter()
        .map(|node| {
            let message = node.message;
            StoredMessage {
                message_id: Some(format!("msg_{}", node.id)),
                node_id: Some(node.id),
                turn_id: Some(node.turn_id),
                parent: node.parent,
                role: message.role,
                content: message.content,
                reasoning: message.reasoning_content,
                timestamp: node.timestamp,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
            }
        })
        .collect()
}

fn auto_title(messages: &[StoredMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == "user")
        .and_then(|message| message.content.as_deref())
        .map(|content| {
            let truncated: String = content.chars().take(50).collect();
            if content.chars().count() > 50 {
                format!("{}…", truncated)
            } else {
                truncated
            }
        })
        .unwrap_or_else(|| "新对话".to_string())
}

fn merge_compacted_runtime_snapshot(
    existing: StoredConversation,
    runtime_messages: Vec<StoredMessage>,
) -> Vec<StoredMessage> {
    let Some(compact) = existing.compact.as_ref() else {
        return runtime_messages;
    };

    let runtime_compact_content = compact_runtime_content(&compact.text);
    let mut seen_ids = existing
        .messages
        .iter()
        .filter_map(|message| message.node_id)
        .collect::<HashSet<_>>();
    let mut merged = existing.messages;

    for message in runtime_messages {
        if message.node_id == Some(compact.position_node_id)
            && message.role == "system"
            && message.content.as_deref() == Some(runtime_compact_content.as_str())
        {
            continue;
        }

        if let Some(node_id) = message.node_id {
            if !seen_ids.insert(node_id) {
                continue;
            }
        }
        merged.push(message);
    }

    merged.sort_by_key(|message| message.node_id.unwrap_or(u64::MAX));
    merged
}

fn chat_store_save_snapshot(
    paths: &PathsState,
    conversation_id: &str,
    plugin_id: &str,
    model: &str,
    nodes: Vec<ConversationNode>,
    head: Option<u64>,
) -> Result<(), String> {
    let messages = conversation_nodes_to_stored_messages(nodes);
    if messages.is_empty() {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let existing = chat_store_get_conversation(paths, conversation_id)?;
    let (title, created_at, compact, settings, messages) = match existing {
        Some(conversation) => (
            conversation.meta.title.clone(),
            conversation.meta.created_at.clone(),
            conversation.compact.clone(),
            conversation.settings.clone(),
            merge_compacted_runtime_snapshot(conversation, messages),
        ),
        None => (
            auto_title(&messages),
            now.clone(),
            None,
            StoredConversationSettings::default(),
            messages,
        ),
    };

    let conversation = StoredConversation {
        schema_version: default_conversation_schema_version(),
        meta: ConversationMeta {
            id: conversation_id.to_string(),
            title,
            plugin_id: plugin_id.to_string(),
            model: model.to_string(),
            created_at,
            updated_at: now,
        },
        settings,
        messages,
        head,
        compact,
    };

    chat_store_save_conversation(paths, &conversation)
}

async fn save_session_snapshot(app: &AppHandle, session_id: &str) {
    let snapshot_target = {
        let ai_state = app.state::<AiState>();
        let sessions = ai_state.sessions.lock().await;
        sessions.get(session_id).map(|entry| {
            (
                entry.conversation_id.clone(),
                entry.plugin_id.clone(),
                entry.model.clone(),
                entry.handle.clone(),
            )
        })
    };

    let Some((conversation_id, plugin_id, model, handle)) = snapshot_target else {
        log::warn!("[chat_store] session '{}' 不存在，跳过快照保存", session_id);
        return;
    };

    let nodes = handle.get_all_nodes().await;
    let head = handle.head().await;
    let paths = app.state::<PathsState>();
    match chat_store_save_snapshot(paths.inner(), &conversation_id, &plugin_id, &model, nodes, head)
    {
        Ok(()) => log::info!(
            "[chat_store] 已保存会话快照: session_id={} conversation_id={}",
            session_id,
            conversation_id
        ),
        Err(error) => log::error!(
            "[chat_store] 保存会话快照失败: session_id={} conversation_id={} error={}",
            session_id,
            conversation_id,
            error
        ),
    }
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
                    if matches!(&status, TurnStatus::Ok) {
                        save_session_snapshot(&app_clone, &sid).await;
                    }
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
                    save_session_snapshot(&app_clone, &sid).await;
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
