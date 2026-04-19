use crate::AppState;
use anyhow::Result;
use flowcloudai_client::sense::sense_state_new;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::sync::oneshot;

use super::category_tools;
use super::edit_tools;
use super::entry_tools;
use super::project_tools;
use super::state::WorldflowToolState;
use super::web_tools;

/// 注册所有 Worldflow 工具到 ToolRegistry
pub fn register_worldflow_tools(
    registry: &mut flowcloudai_client::tool::ToolRegistry,
    app_state: std::sync::Arc<tokio::sync::Mutex<AppState>>,
    search_engine: std::sync::Arc<tokio::sync::Mutex<String>>,
    app_handle: AppHandle,
    pending_edits: std::sync::Arc<tokio::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>>,
) -> Result<()> {
    // 创建并注入状态
    let state = WorldflowToolState {
        app_state: Some(app_state.clone()),
        http_client: reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default(),
        search_engine,
        app_handle: Some(app_handle),
        pending_edits,
    };

    // 使用 tokio runtime 初始化 SenseState
    let rt = tokio::runtime::Runtime::new()?;
    let sense_state: flowcloudai_client::sense::SenseState<WorldflowToolState> = sense_state_new();
    {
        let mut locked = rt.block_on(sense_state.lock());
        *locked = state;
    }

    registry.put_state::<flowcloudai_client::sense::SenseState<WorldflowToolState>>(sense_state);

    // 注册各模块工具
    entry_tools::register_entry_tools(registry)?;
    edit_tools::register_edit_tools(registry)?;
    category_tools::register_category_tools(registry)?;
    project_tools::register_project_tools(registry)?;
    web_tools::register_web_tools(registry)?;

    Ok(())
}
