use crate::AppState;
use crate::settings::SearchSourceSettings;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::sense::sense_state_new;
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
    app_state: std::sync::Arc<AppState>,
    search_engine: std::sync::Arc<tokio::sync::Mutex<String>>,
    search_sources: std::sync::Arc<tokio::sync::Mutex<SearchSourceSettings>>,
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
        search_sources,
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
        vec![
            ToolFunctionArg::new("message", "string")
                .required(true)
                .desc("进度描述文字，简短的一句话，如'正在检查角色A和角色B的年龄关系…'"),
        ],
        |state: &mut WorldflowToolState, args: &serde_json::Value| {
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("工作中…");
            if let Some(ref handle) = state.app_handle {
                handle
                    .emit(
                        "ai:world_check_progress",
                        serde_json::json!({"message": message}),
                    )
                    .ok();
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

    // ── 读写标注（read_only 会话据此拦截，未标注默认按写禁止） ──
    // 读集合必须覆盖 AppSense::reader_tool_whitelist 与 world_check_tool_whitelist
    // 的并集，遗漏会打断 read_only 检测链路（world_check / contradiction）。
    registry.mark_read(&[
        "list_projects",
        "search_entries",
        "get_entry",
        "get_entry_content_by_line",
        "list_all_entries",
        "list_categories",
        "list_entries_by_type",
        "query_categories",
        "list_tag_schemas",
        "get_entry_relations",
        "get_project_summary",
        "list_entry_types",
        "list_entries_dev",
        "report_progress",
        "web_search",
        "open_url",
    ]);
    registry.mark_write(&[
        "create_entry",
        "update_entry",
        "update_entry_tags",
        "add_entry_tag",
        "remove_entry_tag",
        "edit_entry_content_lines",
        "replace_entry_content",
        "delete_entry",
        "move_entry",
        "create_relation",
        "update_relation",
        "delete_relation",
        "create_category",
        "delete_category",
        "create_project",
    ]);

    Ok(())
}
