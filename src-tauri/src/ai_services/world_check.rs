use crate::AppState;
use crate::ai_services::context_builders::build_entry_markdown;
use crate::reports::world_check_report::WorldCheckKind;
use crate::tools;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct WorldCheckDefinition {
    pub kind: WorldCheckKind,
    pub task_type: &'static str,
    pub prompt_template: &'static str,
    pub system_template: &'static str,
    pub title: &'static str,
    pub purpose: &'static str,
    pub requires_target_entry: bool,
    pub default_temperature: f64,
    pub tool_whitelist: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckLoadRequest {
    pub project_id: String,
    pub entry_ids: Option<Vec<String>>,
    pub target_entry_id: Option<String>,
    pub category_id: Option<String>,
    pub query: Option<String>,
    pub max_entries: Option<usize>,
    pub max_chars_per_entry: Option<usize>,
    pub max_total_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckCorpus {
    pub project_id: String,
    pub project_name: String,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub target_entry_title: Option<String>,
    pub target_entry_block: Option<String>,
    pub entry_blocks: Vec<String>,
    pub truncated: bool,
}

pub fn world_check_tool_whitelist() -> Vec<String> {
    [
        "search_entries",
        "get_entry",
        "get_entry_content_by_line",
        "list_all_entries",
        "list_categories",
        "list_entries_by_type",
        "list_tag_schemas",
        "get_entry_relations",
        "get_project_summary",
        "list_projects",
        "list_entry_types",
        "web_search",
        "open_url",
        "report_progress",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

pub fn world_check_definition(kind: WorldCheckKind) -> WorldCheckDefinition {
    match kind {
        WorldCheckKind::Contradiction => WorldCheckDefinition {
            kind,
            task_type: "world_check.contradiction",
            prompt_template: "world_check/contradiction_prompt",
            system_template: "sense/world_check_system",
            title: "设定矛盾检测",
            purpose: "发现词条之间互相冲突、时间顺序不一致、身份设定不一致、关系链不一致、术语定义冲突等问题。",
            requires_target_entry: false,
            default_temperature: 0.1,
            tool_whitelist: world_check_tool_whitelist(),
        },
        WorldCheckKind::EntryAlignment => WorldCheckDefinition {
            kind,
            task_type: "world_check.entry_alignment",
            prompt_template: "world_check/entry_alignment_prompt",
            system_template: "sense/world_check_system",
            title: "单词条世界观契合度检测",
            purpose: "评估指定词条是否与项目既有世界观、规则、时间线、风格和术语体系相契合。",
            requires_target_entry: true,
            default_temperature: 0.1,
            tool_whitelist: world_check_tool_whitelist(),
        },
        WorldCheckKind::PublicationRisk => WorldCheckDefinition {
            kind,
            task_type: "world_check.publication_risk",
            prompt_template: "world_check/publication_risk_prompt",
            system_template: "sense/world_check_system",
            title: "公开出版风险检测",
            purpose: "识别公开发布或出版前可能需要复核的侵权、敏感表达、现实指涉、低龄不适、合规和品牌风险。",
            requires_target_entry: false,
            default_temperature: 0.1,
            tool_whitelist: world_check_tool_whitelist(),
        },
    }
}

pub async fn load_world_check_corpus(
    app_state: &AppState,
    request: &WorldCheckLoadRequest,
) -> Result<WorldCheckCorpus, String> {
    let max_entries = request.max_entries.unwrap_or(12).clamp(1, 30);
    let max_chars_per_entry = request.max_chars_per_entry.unwrap_or(2200).clamp(400, 6000);
    let max_total_chars = request
        .max_total_chars
        .unwrap_or(18_000)
        .clamp(2_000, 40_000);

    let (project, _) = tools::get_project_summary(app_state, &request.project_id).await?;

    let mut candidate_ids = if let Some(entry_ids) = &request.entry_ids {
        entry_ids.clone()
    } else if let Some(query) = request.query.as_deref() {
        tools::search_entries(
            app_state,
            &request.project_id,
            query,
            None,
            request.category_id.as_deref(),
            max_entries,
        )
        .await?
        .into_iter()
        .map(|brief| brief.id.to_string())
        .collect()
    } else {
        tools::list_all_entries(
            app_state,
            &request.project_id,
            request.category_id.as_deref(),
            max_entries,
            0,
        )
        .await?
        .into_iter()
        .map(|brief| brief.id.to_string())
        .collect()
    };

    if let Some(target_entry_id) = request.target_entry_id.as_deref()
        && !candidate_ids.iter().any(|id| id == target_entry_id)
    {
        candidate_ids.insert(0, target_entry_id.to_string());
    }

    let mut dedup = HashSet::new();
    let selected_ids = candidate_ids
        .into_iter()
        .filter(|entry_id| dedup.insert(entry_id.clone()))
        .take(max_entries)
        .collect::<Vec<_>>();

    if selected_ids.is_empty() {
        return Err("检测范围内没有可用词条".to_string());
    }

    let mut entry_blocks = Vec::new();
    let mut used_entry_ids = Vec::new();
    let mut target_entry_title = None;
    let mut target_entry_block = None;
    let mut remaining_chars = max_total_chars;
    let mut truncated = false;

    for entry_id in &selected_ids {
        if remaining_chars < 200 {
            truncated = true;
            break;
        }

        let entry = tools::get_entry(app_state, entry_id).await?;
        let block = build_entry_markdown(&entry, max_chars_per_entry.min(remaining_chars));
        let char_count = block.chars().count();

        if char_count > remaining_chars {
            truncated = true;
            break;
        }

        remaining_chars = remaining_chars.saturating_sub(char_count);
        used_entry_ids.push(entry_id.clone());

        if request.target_entry_id.as_deref() == Some(entry_id.as_str()) {
            target_entry_title = Some(entry.title.clone());
            target_entry_block = Some(block);
        } else {
            entry_blocks.push(block);
        }
    }

    let mut scope_parts = vec![format!("项目「{}」", project.name)];
    if let Some(query) = request.query.as_deref() {
        scope_parts.push(format!("搜索词“{}”", query));
    }
    if let Some(category_id) = request.category_id.as_deref() {
        scope_parts.push(format!("分类 {}", category_id));
    }
    if request.entry_ids.is_some() {
        scope_parts.push("显式指定词条集合".to_string());
    }
    if let Some(target_entry_title) = target_entry_title.as_deref() {
        scope_parts.push(format!("目标词条「{}」", target_entry_title));
    }
    scope_parts.push(format!("共载入 {} 个词条", used_entry_ids.len()));

    Ok(WorldCheckCorpus {
        project_id: request.project_id.clone(),
        project_name: project.name,
        scope_summary: scope_parts.join("，"),
        source_entry_ids: used_entry_ids,
        target_entry_id: request.target_entry_id.clone(),
        target_entry_title,
        target_entry_block,
        entry_blocks,
        truncated,
    })
}
