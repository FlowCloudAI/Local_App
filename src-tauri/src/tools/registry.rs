use crate::AppState;
use crate::tools;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::sense::SenseState;
use flowcloudai_client::sense::sense_state_new;
use flowcloudai_client::tool::{ToolRegistry, arg_str};

/// Worldflow 工具的状态结构
#[derive(Clone, Default)]
pub struct WorldflowToolState {
    pub app_state: Option<std::sync::Arc<tokio::sync::Mutex<AppState>>>,
}

/// 注册所有 Worldflow 工具到 ToolRegistry
pub fn register_worldflow_tools(
    registry: &mut ToolRegistry,
    app_state: std::sync::Arc<tokio::sync::Mutex<AppState>>,
) -> Result<()> {
    // 创建并注入状态
    let state = WorldflowToolState {
        app_state: Some(app_state.clone()),
    };

    // 使用 tokio runtime 初始化 SenseState
    let rt = tokio::runtime::Runtime::new()?;
    let sense_state: SenseState<WorldflowToolState> = sense_state_new();
    {
        let mut locked = rt.block_on(sense_state.lock());
        *locked = state;
    }

    registry.put_state::<SenseState<WorldflowToolState>>(sense_state);

    // 由于我们的工具需要访问 AppState，而 AppState 已经在 Arc<Mutex<>> 中，
    // 我们需要调整策略：直接在 handler 中克隆 Arc

    // ① search_entries - FTS 搜索词条
    registry.register_async::<WorldflowToolState, _>(
        "search_entries",
        "在项目中全文搜索词条，返回匹配的词条简报列表",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("query", "string")
                .required(true)
                .desc("搜索关键词"),
            ToolFunctionArg::new("entry_type", "string")
                .desc("可选：词条类型过滤（如 character, item, location）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认10")
                .min(1)
                .max(100),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let query = arg_str(args, "query")?;
                let entry_type = args.get("entry_type").and_then(|v| v.as_str());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

                let app_state_guard = app_state.lock().await;
                let result =
                    tools::search_entries(&*app_state_guard, project_id, query, entry_type, limit)
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry_briefs(&result))
            })
        },
    );

    // ② get_entry - 获取完整词条
    registry.register_async::<WorldflowToolState, _>(
        "get_entry",
        "根据词条ID获取完整的词条内容，包括正文、标签和图像信息",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;

                let app_state_guard = app_state.lock().await;
                let entry = tools::get_entry(&*app_state_guard, entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ③ list_entries_by_type - 按类型列出词条
    registry.register_async::<WorldflowToolState, _>(
        "list_entries_by_type",
        "列出项目中指定类型的词条简报，用于了解同类词条的整体情况",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("entry_type", "string")
                .required(true)
                .desc("词条类型（如 character, item, location, event, faction）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认50")
                .min(1)
                .max(100),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let entry_type = arg_str(args, "entry_type")?;
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

                let app_state_guard = app_state.lock().await;
                let result =
                    tools::list_entries_by_type(&*app_state_guard, project_id, entry_type, limit)
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry_briefs(&result))
            })
        },
    );

    // ④ list_tag_schemas - 获取标签定义
    registry.register_async::<WorldflowToolState, _>(
        "list_tag_schemas",
        "获取项目的标签定义列表，了解可用的标签名称、类型和目标",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;

                let app_state_guard = app_state.lock().await;
                let schemas = tools::list_tag_schemas(&*app_state_guard, project_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_tag_schemas(&schemas))
            })
        },
    );

    // ⑤ get_entry_relations - 获取词条关系网络
    registry.register_async::<WorldflowToolState, _>(
        "get_entry_relations",
        "获取指定词条的所有关联关系（单向/双向），用于检测关系链中的矛盾",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;

                let app_state_guard = app_state.lock().await;
                let relations = tools::get_entry_relations(&*app_state_guard, entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_relations(&relations, entry_id))
            })
        },
    );

    // ⑥ get_project_summary - 获取项目统计
    registry.register_async::<WorldflowToolState, _>(
        "get_project_summary",
        "获取项目的基本信息和各类型词条的统计数据",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;

                let app_state_guard = app_state.lock().await;
                let (project, counts) = tools::get_project_summary(&*app_state_guard, project_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_project_summary(&project, &counts))
            })
        },
    );

    Ok(())
}
