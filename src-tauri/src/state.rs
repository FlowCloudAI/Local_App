use anyhow::Result;
use flowcloudai_client::FlowCloudAIClient;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::{Mutex, mpsc};
use worldflow_core::SqliteDb;

// ── AppState ──────────────────────────────────────────────────────────────────

/// 数据库连接池状态
pub struct AppState {
    pub sqlite_db: Mutex<SqliteDb>,
}

// ── AiState ───────────────────────────────────────────────────────────────────

/// LLM 会话的内部句柄（通过 channel 向后台事件循环发送用户消息）
pub(crate) struct SessionEntry {
    pub(crate) input_tx: mpsc::Sender<String>,
}

/// AI 客户端全局状态（插件注册中心 + 活跃 LLM 会话）
pub struct AiState {
    pub client: Mutex<FlowCloudAIClient>,
    pub(crate) sessions: Mutex<HashMap<String, SessionEntry>>,
}

impl AiState {
    pub fn new(plugins_dir: PathBuf) -> Result<Self> {
        let client = FlowCloudAIClient::new(plugins_dir)?;
        Ok(Self {
            client: Mutex::new(client),
            sessions: Mutex::new(HashMap::new()),
        })
    }
}
