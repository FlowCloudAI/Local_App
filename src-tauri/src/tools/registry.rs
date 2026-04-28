use crate::AppState;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::sense::sense_state_new;
use flowcloudai_client::tool::ToolRegistry;
use std::collections::HashMap;
use tauri::AppHandle;
use tauri::Emitter;
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

    // ── 进度汇报工具（供 contradiction 检测等长任务使用） ──
    registry.register::<WorldflowToolState, _>(
        "report_progress",
        "向用户报告当前任务进度。每完成一个步骤都应该调用一次，让用户知道 AI 正在做什么。",
        vec![ToolFunctionArg::new("message", "string")
            .required(true)
            .desc("进度描述文字，简短的一句话，如'正在检查角色A和角色B的年龄关系…'")],
        |state: &mut WorldflowToolState, args: &serde_json::Value| {
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("工作中…");
            if let Some(ref handle) = state.app_handle {
                handle
                    .emit(
                        "ai:contradiction_progress",
                        serde_json::json!({"message": message}),
                    )
                    .ok();
            }
            Ok(format!("[进度] {}", message))
        },
    );

    Ok(())
}
