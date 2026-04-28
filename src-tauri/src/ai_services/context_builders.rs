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
        "请检测以下项目资料中的设定矛盾，并按约定 JSON 对象格式输出。\n项目：{}。\n",
        corpus.project_name
    );
    prompt.push_str(&format!("检测范围：{}。\n", corpus.scope_summary));
    if corpus.truncated {
        prompt.push_str("注意：本轮资料经过裁剪；若证据不足，请放入 unresolvedQuestions，不要硬判定。\n");
    }
    prompt.push_str("【数据格式说明】\n");
    prompt.push_str("每条词条包含以下字段，其中\"类型\"和\"标签\"是系统管理字段，不属于世界观设定内容：\n");
    prompt.push_str("- 类型：系统分类标签（如 character、location 等），仅作识别用途，不同词条类型不一致不是矛盾。\n");
    prompt.push_str("- 标签：结构化属性键值对（如 age=18），是作者填写的设定数据。\n");
    prompt.push_str("- 摘要：词条简介。\n");
    prompt.push_str("- 正文：词条的详细设定描述，是最主要的分析对象。\n\n");
    prompt.push_str("【判断标准】\n");
    prompt.push_str("1. 只分析世界观设定内容本身（正文、摘要、标签数值），不评判数据结构是否完整。\n");
    prompt.push_str("2. 以下情况【不得】放入 issues 或 unresolvedQuestions：\n");
    prompt.push_str("   - 某词条没有填写\"类型\"字段\n");
    prompt.push_str("   - 不同词条的\"类型\"字段值不同（这是正常的分类差异）\n");
    prompt.push_str("   - 词条缺少某个标签或摘要（信息缺失不是矛盾）\n");
    prompt.push_str("   - 词条正文内容简短或是占位文字（内容稀少不是矛盾）\n");
    prompt.push_str("3. 只有当两条或多条词条的设定内容存在明确逻辑冲突时，才放入 issues。\n");
    prompt.push_str("4. unresolvedQuestions 只用于：有两条以上证据暗示可能存在冲突，但现有信息不足以确认。\n");
    prompt.push_str("   不得用于：提问作者为何没有填写某字段，或建议作者补充信息。\n");
    prompt.push_str("5. evidence.quote 必须直接引用词条原文片段，不得改写或概括。\n\n");
    prompt.push_str("【检测维度】请沿以下六个维度逐一审查，并在 issues 的 category 字段中注明所属维度：\n");
    prompt.push_str("- timeline：时间线矛盾——事件年份、发生顺序、角色年龄与历史时间线不自洽。\n");
    prompt.push_str("- relationship：人物关系矛盾——两个词条对同一关系的描述存在对立（如一方说友好，另一方说敌对）。\n");
    prompt.push_str("- geography：地理空间矛盾——同一地点的位置、归属、距离在不同词条中相互冲突。\n");
    prompt.push_str("- ability：能力/规则矛盾——角色能力或事件违反了世界观规则词条中明确规定的限制。\n");
    prompt.push_str("- faction：阵营/立场矛盾——某角色或势力在不同词条中被归入对立阵营，或立场描述明显冲突。\n");
    prompt.push_str("- other：其他——不属于以上维度的内容事实冲突。\n\n");
    prompt.push_str("【输出要求】\n");
    prompt.push_str("1. 只输出一个 JSON 对象，不要输出 Markdown、解释文字或代码块。\n");
    prompt.push_str("2. 顶层字段必须且只能包含：overview、issues、unresolvedQuestions、suggestions。\n");
    prompt.push_str("3. overview 必须是一段纯文字摘要字符串（不得是对象或数组），一两句话概括整体情况。\n");
    prompt.push_str("   示例：\"overview\": \"共发现 2 处设定冲突，主要集中在角色年龄与时间线之间。\"\n");
    prompt.push_str("4. issues 中每一项必须包含：issueId、severity、category、title、description、relatedEntryIds、evidence；可选 recommendation。\n");
    prompt.push_str("5. severity 只能是 low、medium、high、critical 之一。\n");
    prompt.push_str("6. category 只能是 timeline、relationship、geography、ability、faction、other 之一。\n");
    prompt.push_str("7. evidence 中每一项必须包含：entryId、entryTitle、quote；可选 note。\n");
    prompt.push_str("8. unresolvedQuestions 和 suggestions 均为字符串数组。\n");
    prompt.push_str("9. 如果分析范围内的词条内容不足以判断是否存在冲突，issues 和 unresolvedQuestions 均留空即可。\n\n");
    prompt.push_str("资料如下：\n\n");
    prompt.push_str(&corpus.entry_blocks.join("\n\n"));
    // JSON priming：引导模型直接续写 JSON，避免输出解释性文本
    prompt.push_str("\n\n请严格按照以上 JSON 格式输出：\n{\n  \"overview\": \"");
    prompt
}
