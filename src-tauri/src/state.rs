//! Tauri 管理状态与跨请求共享资源。
//!
//! 本文件只定义启动时注入的状态容器；API 和工具从中取得数据库、客户端、路径和确认通道，
//! 因此各状态的初始化顺序由 `lib` 中的启动流程保证。

use crate::reports::contradiction_report::ContradictionReport;
use crate::reports::world_check_report::WorldCheckReport;
use crate::settings::SearchSourceSettings;
use anyhow::Result;
use flowcloudai_client::{FlowCloudAIClient, SessionHandle};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tokio::sync::{Mutex, mpsc, oneshot};
use worldflow_core::{SqliteDb, WorldStore};

// ── 搜索引擎状态 ─────────────────────────────────────────────────────────────

/// 当前搜索引擎选择（与设置同步，供 AI 工具使用）。
pub struct SearchEngineState {
    pub engine: Arc<Mutex<String>>,
}

/// 当前启用的搜索信源组（与设置同步，供 AI 工具使用）
pub struct SearchSourcesState {
    pub sources: Arc<Mutex<SearchSourceSettings>>,
}

// ── 网络状态 ──────────────────────────────────────────────────────────────────

/// 全局共享 HTTP 客户端（连接池复用）。
///
/// Android 使用显式根证书配置，避免依赖桌面平台的默认 TLS 根证书来源。
pub struct NetworkState {
    pub client: reqwest::Client,
}

impl NetworkState {
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
        }
    }
}

#[cfg(target_os = "android")]
fn build_http_client() -> reqwest::Client {
    let root_store =
        rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    reqwest::Client::builder()
        .tls_backend_preconfigured(tls_config)
        .build()
        .expect("初始化 Android HTTP 客户端失败")
}

#[cfg(not(target_os = "android"))]
fn build_http_client() -> reqwest::Client {
    reqwest::Client::new()
}

// ── 启动就绪状态 ───────────────────────────────────────────────────────────────

/// 标记后端是否已经完成主线程状态注入。
/// 仅在 AppState / PathsState / PendingEditsState / AiState 初始化流程完成后置为 true。
pub struct BackendReadyState {
    status: StdMutex<BackendStartupStatus>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackendStartupStatus {
    pub phase: String,
    pub message: Option<String>,
}

impl BackendReadyState {
    pub fn new() -> Self {
        Self {
            status: StdMutex::new(BackendStartupStatus {
                phase: "initializing".to_string(),
                message: None,
            }),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.status().phase == "ready"
    }

    pub fn status(&self) -> BackendStartupStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn mark_ready(&self) {
        *self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = BackendStartupStatus {
            phase: "ready".to_string(),
            message: None,
        };
    }

    pub fn mark_failed(&self, message: String) {
        *self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = BackendStartupStatus {
            phase: "failed".to_string(),
            message: Some(message),
        };
    }
}

// ── 路径状态 ──────────────────────────────────────────────────────────────────

/// 解析后的数据目录路径（db 和 plugins）
#[derive(Clone)]
pub struct PathsState {
    pub db_path: PathBuf,
    pub plugins_path: PathBuf,
}

// ── 应用状态 ──────────────────────────────────────────────────────────────────

/// 数据库连接池状态
pub struct AppState {
    pub sqlite_db: Mutex<SqliteDb>,
    pub world_store: WorldStore,
    pub thumbnail_jobs: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

// ── 待确认编辑状态 ───────────────────────────────────────────────────────────

/// AI 工具发起的待确认编辑请求。
/// key = request_id（UUID 字符串），value = oneshot sender（true=确认，false=取消）
pub struct PendingEditsState {
    pub pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

// ── AI 状态 ───────────────────────────────────────────────────────────────────

/// LLM 会话的内部句柄（通过 channel 向后台事件循环发送用户消息）
#[derive(Clone, Debug)]
pub(crate) enum AiSessionKind {
    General,
    Character,
    Contradiction,
    WorldCheck,
}

#[derive(Clone)]
pub(crate) struct ContradictionSessionBinding {
    pub(crate) report: ContradictionReport,
    pub(crate) scope_summary: String,
    pub(crate) source_entry_ids: Vec<String>,
    pub(crate) truncated: bool,
}

#[derive(Clone)]
pub(crate) struct WorldCheckSessionBinding {
    pub(crate) report: WorldCheckReport,
    pub(crate) scope_summary: String,
    pub(crate) source_entry_ids: Vec<String>,
    pub(crate) target_entry_id: Option<String>,
    pub(crate) truncated: bool,
}

pub(crate) struct SessionEntry {
    pub(crate) run_id: String,
    pub(crate) input_tx: Option<mpsc::Sender<String>>,
    pub(crate) handle: SessionHandle,
    #[allow(dead_code)]
    pub(crate) kind: AiSessionKind,
    pub(crate) model: String,
    pub(crate) plugin_id: String,
}

/// AI 客户端全局状态（插件注册中心 + 活跃 LLM 会话）
pub struct AiState {
    pub client: Mutex<FlowCloudAIClient>,
    pub(crate) sessions: Mutex<HashMap<String, SessionEntry>>,
    pub(crate) contradiction_bindings: Mutex<HashMap<String, ContradictionSessionBinding>>,
    pub(crate) world_check_bindings: Mutex<HashMap<String, WorldCheckSessionBinding>>,
    pub(crate) contradiction_reports_dir: PathBuf,
    pub(crate) world_check_reports_dir: PathBuf,
    _app_state: Arc<AppState>,
}

impl AiState {
    pub fn new(
        plugins_dir: PathBuf,
        storage_path: Option<PathBuf>,
        app_state: Arc<AppState>,
        search_engine: Arc<Mutex<String>>,
        search_sources: Arc<Mutex<SearchSourceSettings>>,
        app_handle: tauri::AppHandle,
        pending_edits: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    ) -> Result<Self> {
        let contradiction_reports_dir = storage_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("chats"))
            .join("contradiction_reports");
        let world_check_reports_dir = storage_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("chats"))
            .join("world_check_reports");
        let mut client = FlowCloudAIClient::new(plugins_dir)?;

        std::fs::create_dir_all(&contradiction_reports_dir)?;
        std::fs::create_dir_all(&world_check_reports_dir)?;

        // 注册 Worldflow 工具（在创建任何 Session 之前）
        client.install_tools(|registry| {
            crate::tools::register_worldflow_tools(
                registry,
                app_state.clone(),
                search_engine.clone(),
                search_sources.clone(),
                app_handle.clone(),
                pending_edits.clone(),
            )
        })?;

        Ok(Self {
            client: Mutex::new(client),
            sessions: Mutex::new(HashMap::new()),
            contradiction_bindings: Mutex::new(HashMap::new()),
            world_check_bindings: Mutex::new(HashMap::new()),
            contradiction_reports_dir,
            world_check_reports_dir,
            _app_state: app_state,
        })
    }
}
