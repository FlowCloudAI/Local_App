use anyhow::Result;
use flowcloudai_client::{FlowCloudAIClient, SessionHandle};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, oneshot};
use worldflow_core::SqliteDb;

// ── SearchEngineState ─────────────────────────────────────────────────────────

/// 当前搜索引擎选择（与设置同步，供 AI 工具使用）
pub struct SearchEngineState {
    pub engine: Arc<Mutex<String>>,
}

// ── NetworkState ──────────────────────────────────────────────────────────────

/// 全局共享 HTTP 客户端（连接池复用）
pub struct NetworkState {
    pub client: reqwest::Client,
}

impl NetworkState {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

// ── PathsState ────────────────────────────────────────────────────────────────

/// 解析后的数据目录路径（db 和 plugins）
pub struct PathsState {
    pub db_path: PathBuf,
    pub plugins_path: PathBuf,
}

// ── AppState ──────────────────────────────────────────────────────────────────

/// 数据库连接池状态
pub struct AppState {
    pub sqlite_db: Mutex<SqliteDb>,
}

// ── PendingEditsState ─────────────────────────────────────────────────────────

/// AI 工具发起的待确认编辑请求。
/// key = request_id（UUID 字符串），value = oneshot sender（true=确认，false=取消）
pub struct PendingEditsState {
    pub pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

// ── AiState ───────────────────────────────────────────────────────────────────

/// LLM 会话的内部句柄（通过 channel 向后台事件循环发送用户消息）
pub(crate) struct SessionEntry {
    pub(crate) input_tx: mpsc::Sender<String>,
    pub(crate) handle: SessionHandle,
}

/// AI 客户端全局状态（插件注册中心 + 活跃 LLM 会话）
pub struct AiState {
    pub client: Mutex<FlowCloudAIClient>,
    pub(crate) sessions: Mutex<HashMap<String, SessionEntry>>,
    _app_state: Arc<Mutex<AppState>>,
}

impl AiState {
    pub fn new(
        plugins_dir: PathBuf,
        storage_path: Option<PathBuf>,
        app_state: Arc<Mutex<AppState>>,
        search_engine: Arc<Mutex<String>>,
        app_handle: tauri::AppHandle,
        pending_edits: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    ) -> Result<Self> {
        let mut client = FlowCloudAIClient::new(plugins_dir, storage_path)?;

        // 注册 Worldflow 工具（在创建任何 Session 之前）
        client.install_tools(|registry| {
            crate::tools::register_worldflow_tools(
                registry,
                app_state.clone(),
                search_engine.clone(),
                app_handle.clone(),
                pending_edits.clone(),
            )
        })?;

        Ok(Self {
            client: Mutex::new(client),
            sessions: Mutex::new(HashMap::new()),
            _app_state: app_state,
        })
    }
}
