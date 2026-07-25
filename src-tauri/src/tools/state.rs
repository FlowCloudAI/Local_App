//! 工具执行所需的应用状态与确认通道。
//!
//! 该状态由注册表创建后放入客户端 SenseState；默认值只供测试或未装配环境使用，真实工具调用
//! 需要完整的应用状态和窗口句柄才能执行数据访问或人工确认。

use crate::AppState;
use crate::settings::SearchSourceSettings;
use std::collections::HashMap;
use tokio::sync::oneshot;

/// Worldflow 工具共享的依赖容器。
///
/// `pending_edits` 将一次性确认请求与前端响应关联，不能在操作完成前替换为独立映射。
#[derive(Clone)]
pub struct WorldflowToolState {
    pub app_state: Option<std::sync::Arc<AppState>>,
    pub http_client: reqwest::Client,
    pub search_engine: std::sync::Arc<tokio::sync::Mutex<String>>,
    pub search_sources: std::sync::Arc<tokio::sync::Mutex<SearchSourceSettings>>,
    pub app_handle: Option<tauri::AppHandle>,
    pub pending_edits: std::sync::Arc<tokio::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl Default for WorldflowToolState {
    fn default() -> Self {
        Self {
            app_state: None,
            http_client: reqwest::Client::new(),
            search_engine: std::sync::Arc::new(tokio::sync::Mutex::new("bing".to_string())),
            search_sources: std::sync::Arc::new(tokio::sync::Mutex::new(
                SearchSourceSettings::default(),
            )),
            app_handle: None,
            pending_edits: std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}
