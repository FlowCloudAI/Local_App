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
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只搜索该分类下的词条（从 list_categories 获取分类ID）"),
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
                let category_id = args.get("category_id").and_then(|v| v.as_str());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

                let app_state_guard = app_state.lock().await;
                let result = tools::search_entries(
                    &*app_state_guard,
                    project_id,
                    query,
                    entry_type,
                    category_id,
                    limit,
                )
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

    // ②-1 get_entry_content_by_line - 按行获取词条正文（节省token）
    registry.register_async::<WorldflowToolState, _>(
        "get_entry_content_by_line",
        "按行范围获取词条正文内容，用于精确编辑前的内容预览；返回带行号的文本",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("start_line", "integer")
                .desc("起始行号（从1开始），默认为1")
                .min(1),
            ToolFunctionArg::new("end_line", "integer")
                .desc("结束行号（含），默认为最后一行")
                .min(1),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let start_line =
                    args.get("start_line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let end_line_opt = args.get("end_line").and_then(|v| v.as_u64());

                if start_line == 0 {
                    anyhow::bail!("start_line 必须从 1 开始");
                }

                let app_state_guard = app_state.lock().await;
                let entry = tools::get_entry(&*app_state_guard, entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                let lines: Vec<&str> = entry.content.lines().collect();
                let total_lines = lines.len();

                if total_lines == 0 {
                    return Ok("该词条正文为空".to_string());
                }

                let start = if start_line > total_lines {
                    return Ok(format!(
                        "起始行号 {} 超出总行数 {}",
                        start_line, total_lines
                    ));
                } else {
                    start_line - 1 // 转为 0-indexed
                };

                let end = match end_line_opt {
                    Some(e) => {
                        if e == 0 {
                            anyhow::bail!("end_line 必须从 1 开始");
                        }
                        (e as usize).min(total_lines) - 1
                    }
                    None => total_lines - 1,
                };

                if end < start {
                    anyhow::bail!("end_line ({}) 不能小于 start_line ({})", end + 1, start + 1);
                }

                let mut result = format!("词条: {} (共 {} 行)\n\n", entry.title, total_lines);
                for (i, line) in lines[start..=end].iter().enumerate() {
                    result.push_str(&format!("{:>4}: {}\n", start + i + 1, line));
                }

                Ok(result)
            })
        },
    );

    // ②-2 list_all_entries - 列出项目内全部词条
    registry.register_async::<WorldflowToolState, _>(
        "list_all_entries",
        "列出项目内所有词条的简报（不限类型），支持按分类过滤和分页",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只列出该分类下的词条（从 list_categories 获取分类ID）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认50")
                .min(1)
                .max(200)
                .default(50),
            ToolFunctionArg::new("offset", "integer")
                .desc("跳过条数，用于分页，默认0")
                .min(0)
                .default(0),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let category_id = args.get("category_id").and_then(|v| v.as_str());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

                let app_state_guard = app_state.lock().await;
                let result = tools::list_all_entries(
                    &*app_state_guard,
                    project_id,
                    category_id,
                    limit,
                    offset,
                )
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry_briefs(&result))
            })
        },
    );

    // ②-3 list_categories - 列出项目分类
    registry.register_async::<WorldflowToolState, _>(
        "list_categories",
        "列出项目的所有分类（含层级结构），用于获取分类ID以过滤词条列表",
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
                let categories = tools::list_categories(&*app_state_guard, project_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_categories(&categories))
            })
        },
    );

    // ③ list_entries_by_type - 按类型列出词条
    registry.register_async::<WorldflowToolState, _>(
        "list_entries_by_type",
        "列出项目中指定类型的词条简报，支持按分类过滤和分页",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("entry_type", "string")
                .required(true)
                .desc("词条类型（如 character, item, location, event, faction）"),
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只列出该分类下的词条（从 list_categories 获取分类ID）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认50")
                .min(1)
                .max(100)
                .default(50),
            ToolFunctionArg::new("offset", "integer")
                .desc("跳过条数，用于分页，默认0")
                .min(0)
                .default(0),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let entry_type = arg_str(args, "entry_type")?;
                let category_id = args.get("category_id").and_then(|v| v.as_str());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

                let app_state_guard = app_state.lock().await;
                let result = tools::list_entries_by_type(
                    &*app_state_guard,
                    project_id,
                    entry_type,
                    category_id,
                    limit,
                    offset,
                )
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
                let (relations, entry_names) =
                    tools::get_entry_relations(&*app_state_guard, entry_id)
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_relations(&relations, entry_id, &entry_names))
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

    // ⑦-1 create_entry - 新建词条
    registry.register_async::<WorldflowToolState, _>(
        "create_entry",
        "在指定项目中新建一个词条，返回新词条的完整信息",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("title", "string")
                .required(true)
                .desc("词条标题"),
            ToolFunctionArg::new("entry_type", "string")
                .desc("词条类型（如 character, item, location, event, faction）"),
            ToolFunctionArg::new("summary", "string").desc("词条摘要"),
            ToolFunctionArg::new("content", "string").desc("词条正文，支持 Markdown"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let title = arg_str(args, "title")?;
                let entry_type = args
                    .get("entry_type")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let summary = args
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let app_state_guard = app_state.lock().await;
                let entry = tools::create_entry(
                    &*app_state_guard,
                    project_id,
                    title.to_string(),
                    entry_type,
                    summary,
                    content,
                )
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑧ update_entry - 更新词条基本字段（标题、摘要、类型，至少传一个）
    registry.register_async::<WorldflowToolState, _>(
        "update_entry",
        "更新词条的标题、摘要或类型；三个字段均可选，但至少需提供一个。\
         entry_type 传空字符串可清空类型",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("title", "string").desc("新标题"),
            ToolFunctionArg::new("summary", "string").desc("新摘要内容"),
            ToolFunctionArg::new("entry_type", "string")
                .desc("新类型（如 character, item, location）；空字符串表示清空"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;

                // 仅在字段出现时更新；None = 不更新
                let title: Option<String> = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // summary: 字段未传 = None（不更新）；传空字符串 = Some(None)（清空）；传非空 = Some(Some(s))
                let summary: Option<Option<String>> =
                    args.get("summary").and_then(|v| v.as_str()).map(|s| {
                        if s.is_empty() {
                            None
                        } else {
                            Some(s.to_string())
                        }
                    });

                // entry_type: None = 不更新；Some(None) = 清空；Some(Some(s)) = 更新
                let entry_type: Option<Option<String>> =
                    args.get("entry_type").and_then(|v| v.as_str()).map(|s| {
                        if s.is_empty() {
                            None
                        } else {
                            Some(s.to_string())
                        }
                    });

                if title.is_none() && summary.is_none() && entry_type.is_none() {
                    anyhow::bail!("title、summary、entry_type 至少需要提供一个");
                }

                let app_state_guard = app_state.lock().await;
                let entry = tools::update_entry_fields(
                    &*app_state_guard,
                    entry_id,
                    title,
                    summary,
                    entry_type,
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

    // ⑫-1 add_entry_tag - 添加/覆盖单个标签
    registry.register_async::<WorldflowToolState, _>(
        "add_entry_tag",
        "向词条添加一个标签；若该 schema_id 的标签已存在则覆盖其值",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("schema_id", "string")
                .required(true)
                .desc("标签定义ID（从 list_tag_schemas 获取）"),
            ToolFunctionArg::new("value", "string")
                .required(true)
                .desc("标签值"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let schema_id = arg_str(args, "schema_id")?;
                let value = arg_str(args, "value")?;

                let app_state_guard = app_state.lock().await;
                let entry =
                    tools::add_entry_tag(&*app_state_guard, entry_id, schema_id, value.to_string())
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑫-2 remove_entry_tag - 删除单个标签
    registry.register_async::<WorldflowToolState, _>(
        "remove_entry_tag",
        "从词条移除指定 schema_id 的标签",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("schema_id", "string")
                .required(true)
                .desc("要移除的标签定义ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let schema_id = arg_str(args, "schema_id")?;

                let app_state_guard = app_state.lock().await;
                let entry = tools::remove_entry_tag(&*app_state_guard, entry_id, schema_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    // ⑬ create_relation - 创建词条关系
    registry.register_async::<WorldflowToolState, _>(
        "create_relation",
        "在两个词条之间创建关系；one_way 表示 a → b 单向，two_way 表示双向",
        vec![
            ToolFunctionArg::new("a_id", "string")
                .required(true)
                .desc("关系起点词条ID"),
            ToolFunctionArg::new("b_id", "string")
                .required(true)
                .desc("关系终点词条ID"),
            ToolFunctionArg::new("relation", "string")
                .required(true)
                .desc("关系方向：one_way（a→b 单向）或 two_way（双向）"),
            ToolFunctionArg::new("content", "string")
                .required(true)
                .desc("关系描述内容"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let a_id = arg_str(args, "a_id")?;
                let b_id = arg_str(args, "b_id")?;
                let relation_str = arg_str(args, "relation")?;
                let content = arg_str(args, "content")?;

                let relation = parse_relation_direction(relation_str)?;

                let app_state_guard = app_state.lock().await;
                let rel = tools::create_relation(
                    &*app_state_guard,
                    a_id,
                    b_id,
                    relation,
                    content.to_string(),
                )
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format!("关系已创建 (ID: {})", rel.id))
            })
        },
    );

    // ⑭ update_relation - 更新词条关系
    registry.register_async::<WorldflowToolState, _>(
        "update_relation",
        "更新词条关系的方向或描述内容；两个参数均可选，但至少需传一个",
        vec![
            ToolFunctionArg::new("relation_id", "string")
                .required(true)
                .desc("关系ID"),
            ToolFunctionArg::new("relation", "string").desc("新的关系方向：one_way 或 two_way"),
            ToolFunctionArg::new("content", "string").desc("新的关系描述内容"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let relation_id = arg_str(args, "relation_id")?;
                let relation = args
                    .get("relation")
                    .and_then(|v| v.as_str())
                    .map(parse_relation_direction)
                    .transpose()?;
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if relation.is_none() && content.is_none() {
                    anyhow::bail!("relation 和 content 至少需要提供一个");
                }

                let app_state_guard = app_state.lock().await;
                let rel = tools::update_relation(&*app_state_guard, relation_id, relation, content)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format!("关系已更新 (ID: {})", rel.id))
            })
        },
    );

    // ⑮ delete_relation - 删除词条关系
    registry.register_async::<WorldflowToolState, _>(
        "delete_relation",
        "删除指定的词条关系",
        vec![
            ToolFunctionArg::new("relation_id", "string")
                .required(true)
                .desc("关系ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let relation_id = arg_str(args, "relation_id")?;

                let app_state_guard = app_state.lock().await;
                tools::delete_relation(&*app_state_guard, relation_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok("关系已删除".to_string())
            })
        },
    );

    Ok(())
}

fn parse_relation_direction(s: &str) -> anyhow::Result<worldflow_core::models::RelationDirection> {
    match s {
        "one_way" => Ok(worldflow_core::models::RelationDirection::OneWay),
        "two_way" => Ok(worldflow_core::models::RelationDirection::TwoWay),
        other => anyhow::bail!("未知 relation 值: {}，应为 one_way 或 two_way", other),
    }
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
