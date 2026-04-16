use crate::tools;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};

/// 注册词条相关工具（查询、列表、更新）
pub fn register_entry_tools(registry: &mut ToolRegistry) -> Result<()> {
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
                .max(100)
                .default(10),
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
                .max(100)
                .default(50),
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

    // ⑦ list_projects - 列出所有项目
    registry.register_async::<WorldflowToolState, _>(
        "list_projects",
        "列出所有项目的ID、名称和描述，用于了解有哪些可用项目",
        vec![],
        |_state, _args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let app_state_guard = app_state.lock().await;
                let projects = tools::list_projects(&*app_state_guard)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_projects(&projects))
            })
        },
    );

    // ⑧ update_entry_title - 更新词条标题
    registry.register_async::<WorldflowToolState, _>(
        "update_entry_title",
        "更新指定词条的标题",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("title", "string")
                .required(true)
                .desc("新标题"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let title = arg_str(args, "title")?;

                let app_state_guard = app_state.lock().await;
                let entry =
                    tools::update_entry_title(&*app_state_guard, entry_id, title.to_string())
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑨ update_entry_summary - 更新词条摘要
    registry.register_async::<WorldflowToolState, _>(
        "update_entry_summary",
        "更新指定词条的摘要；传入空字符串可清空摘要",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("summary", "string")
                .required(true)
                .desc("新摘要内容"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let summary = arg_str(args, "summary")?;
                let summary = if summary.is_empty() {
                    None
                } else {
                    Some(summary.to_string())
                };

                let app_state_guard = app_state.lock().await;
                let entry = tools::update_entry_summary(&*app_state_guard, entry_id, summary)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑩ update_entry_content - 更新词条正文
    registry.register_async::<WorldflowToolState, _>(
        "update_entry_content",
        "更新指定词条的正文内容；传入空字符串可清空正文",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("content", "string")
                .required(true)
                .desc("新正文内容，支持 Markdown"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let content = arg_str(args, "content")?;
                let content = if content.is_empty() {
                    None
                } else {
                    Some(content.to_string())
                };

                let app_state_guard = app_state.lock().await;
                let entry = tools::update_entry_content(&*app_state_guard, entry_id, content)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑪ update_entry_type - 更新词条类型
    registry.register_async::<WorldflowToolState, _>(
        "update_entry_type",
        "更新指定词条的类型",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("entry_type", "string")
                .required(true)
                .desc("词条类型（如 character, item, location, event, faction）"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let entry_type = arg_str(args, "entry_type")?;

                let app_state_guard = app_state.lock().await;
                let entry = tools::update_entry_type(
                    &*app_state_guard,
                    entry_id,
                    Some(entry_type.to_string()),
                )
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑫ update_entry_tags - 更新词条标签（全量替换）
    registry.register_async::<WorldflowToolState, _>(
        "update_entry_tags",
        "全量替换指定词条的标签列表；调用前建议先用 list_tag_schemas 确认可用标签",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("tags", "array")
                .required(true)
                .desc("标签对象数组，每个对象包含 schema_id（或 name）和 value"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let tags_json = args
                    .get("tags")
                    .ok_or_else(|| anyhow::anyhow!("缺少 tags 参数"))?;

                let tags: Vec<worldflow_core::models::EntryTag> =
                    serde_json::from_value(tags_json.clone())
                        .map_err(|e| anyhow::anyhow!("tags 格式错误: {}", e))?;

                let app_state_guard = app_state.lock().await;
                let entry = tools::update_entry_tags(&*app_state_guard, entry_id, tags)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    Ok(())
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
