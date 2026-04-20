use crate::ai_services::contradiction_loader::ContradictionCorpus;
use flowcloudai_client::TaskContext;
use std::collections::HashMap;
use worldflow_core::models::Entry;

pub fn build_task_context(
    project_id: Option<String>,
    task_type: &str,
    attributes: HashMap<String, String>,
    flags: HashMap<String, bool>,
) -> TaskContext {
    TaskContext {
        project_id,
        task_type: task_type.to_string(),
        attributes,
        flags,
        ..Default::default()
    }
}

pub fn build_entry_markdown(entry: &Entry, max_content_chars: usize) -> String {
    let tags = entry
        .tags
        .0
        .iter()
        .map(|tag| (tag.schema_id.to_string(), tag.value.to_string()))
        .collect::<Vec<_>>();
    build_entry_snapshot_markdown(
        &entry.id.to_string(),
        &entry.title,
        entry.r#type.as_deref(),
        entry.summary.as_deref(),
        &tags,
        &entry.content,
        max_content_chars,
    )
}

pub fn build_entry_snapshot_markdown(
    entry_id: &str,
    title: &str,
    entry_type: Option<&str>,
    summary: Option<&str>,
    tags: &[(String, String)],
    content: &str,
    max_content_chars: usize,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("### {} ({})\n", title, entry_id));
    if let Some(entry_type) = entry_type {
        output.push_str(&format!("- 类型：{}\n", entry_type));
    }
    if let Some(summary) = summary {
        output.push_str(&format!("- 摘要：{}\n", summary));
    }
    if !tags.is_empty() {
        let tag_text = tags
            .iter()
            .map(|(schema_id, value)| format!("{}={}", schema_id, value))
            .collect::<Vec<_>>()
            .join("；");
        output.push_str(&format!("- 标签：{}\n", tag_text));
    }

    let content: String = if content.chars().count() > max_content_chars {
        let clipped = content.chars().take(max_content_chars).collect::<String>();
        format!("{}\n……（正文过长，已截断）", clipped)
    } else {
        content.to_string()
    };
    output.push_str("\n正文：\n");
    output.push_str(&content);
    output.push('\n');
    output
}

pub fn build_summary_prompt(
    project_name: &str,
    focus: Option<&str>,
    entry_blocks: &[String],
    output_mode: Option<&str>,
) -> String {
    let is_entry_field_mode = matches!(output_mode, Some("entry_field"));
    let mut prompt = if is_entry_field_mode {
        format!(
            "请基于以下项目资料，为当前词条生成可直接写入“摘要”字段的中文概括。项目名：{}。\n",
            project_name
        )
    } else {
        format!(
            "请基于以下项目资料生成一份中文总结。项目名：{}。\n",
            project_name
        )
    };
    if let Some(focus) = focus {
        prompt.push_str(&format!("总结重点：{}。\n", focus));
    }
    prompt.push_str("输出要求：\n");
    if is_entry_field_mode {
        prompt.push_str("1. 只输出一个 JSON 对象，不要有任何其他文字：{\"summary\": \"摘要内容\"}\n");
        prompt.push_str("2. summary 字段：30-120 字中文，优先概括身份、核心设定或主要作用。\n");
        prompt.push_str("3. 不要写”该词条””这个角色”等空泛指代，不要编造资料中不存在的设定。\n\n");
    } else {
        prompt.push_str("1. 使用 Markdown。\n");
        prompt.push_str("2. 先给一个总览，再给 3-6 条关键信息。\n");
        prompt.push_str("3. 不要编造资料中不存在的设定。\n\n");
    }
    prompt.push_str("资料如下：\n\n");
    prompt.push_str(&entry_blocks.join("\n\n"));
    prompt
}

pub fn build_contradiction_prompt(corpus: &ContradictionCorpus) -> String {
    let mut prompt = format!(
        "请检测以下项目资料中的设定矛盾，并按约定 JSON schema 输出。\n项目：{}。\n",
        corpus.project_name
    );
    prompt.push_str(&format!("检测范围：{}。\n", corpus.scope_summary));
    if corpus.truncated {
        prompt.push_str("注意：本轮资料经过裁剪；若证据不足，请放入 unresolvedQuestions，不要硬判定。\n");
    }
    prompt.push_str("判断标准：\n");
    prompt.push_str("1. 只有在两条或多条证据明确互相冲突时，才放入 issues。\n");
    prompt.push_str("2. 同一条资料中的模糊描述、未定设定、开放问题，不要误判为矛盾。\n");
    prompt.push_str("3. evidence.quote 必须直接引用资料原文片段。\n\n");
    prompt.push_str("资料如下：\n\n");
    prompt.push_str(&corpus.entry_blocks.join("\n\n"));
    prompt
}
