use crate::AppState;
use crate::settings::SearchSourceSettings;
use std::collections::HashMap;
use tokio::sync::oneshot;

/// Worldflow 工具的状态结构
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
