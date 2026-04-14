use anyhow::Result;
use flowcloudai_client::{FlowCloudAIClient, SessionHandle};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use worldflow_core::SqliteDb;

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
    pub fn new(plugins_dir: PathBuf, app_state: Arc<Mutex<AppState>>) -> Result<Self> {
        let mut client = FlowCloudAIClient::new(plugins_dir)?;

        // 注册 Worldflow 工具（在创建任何 Session 之前）
        client.install_tools(|registry| {
            crate::tools::register_worldflow_tools(registry, app_state.clone())
        })?;

        Ok(Self {
            client: Mutex::new(client),
            sessions: Mutex::new(HashMap::new()),
            _app_state: app_state,
        })
    }
}
