use flowcloudai_client::llm::types::ChatRequest;
use flowcloudai_client::{sense::Sense, ToolRegistry};
use serde::Deserialize;

const MAX_TAG_LINES: usize = 16;
const MAX_WORLD_ENTRIES: usize = 120;
const MAX_RELATIONS: usize = 160;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterProjectMeta {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCategorySnapshot {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterTagSchemaSnapshot {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub r#type: String,
    pub target: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterTagSnapshot {
    pub schema_id: Option<String>,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterEntrySnapshot {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub entry_type: Option<String>,
    pub category_id: Option<String>,
    pub category_path: Vec<String>,
    pub tags: Vec<CharacterTagSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRelationSnapshot {
    pub id: String,
    pub from_entry_id: String,
    pub to_entry_id: String,
    pub relation: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterProjectSnapshot {
    pub project: CharacterProjectMeta,
    pub target_character: CharacterEntrySnapshot,
    pub categories: Vec<CharacterCategorySnapshot>,
    pub tag_schemas: Vec<CharacterTagSchemaSnapshot>,
    pub entries: Vec<CharacterEntrySnapshot>,
    pub relations: Vec<CharacterRelationSnapshot>,
}

pub struct CharacterSense {
    character_name: String,
    project_snapshot: CharacterProjectSnapshot,
}

impl CharacterSense {
    pub fn new(
        character_name: impl Into<String>,
        project_snapshot: CharacterProjectSnapshot,
    ) -> Self {
        Self {
            character_name: character_name.into(),
            project_snapshot,
        }
    }
}

impl Sense for CharacterSense {
    fn prompts(&self) -> Vec<String> {
        let target = &self.project_snapshot.target_character;
        let related_relations = self
            .project_snapshot
            .relations
            .iter()
            .filter(|relation| {
                relation.from_entry_id == target.id || relation.to_entry_id == target.id
            })
            .take(MAX_RELATIONS)
            .map(|relation| {
                format!(
                    "- {} -> {} [{}] {}",
                    relation.from_entry_id,
                    relation.to_entry_id,
                    relation.relation,
                    relation.content
                )
            })
            .collect::<Vec<_>>();

        let category_lines = self
            .project_snapshot
            .categories
            .iter()
            .map(|category| {
                let path = if category.path.is_empty() {
                    category.name.clone()
                } else {
                    category.path.join(" / ")
                };
                format!("- {} ({})", path, category.id)
            })
            .collect::<Vec<_>>();

        let schema_lines = self
            .project_snapshot
            .tag_schemas
            .iter()
            .map(|schema| {
                let targets = if schema.target.is_empty() {
                    "不限".to_string()
                } else {
                    schema.target.join(", ")
                };
                let desc = schema.description.clone().unwrap_or_else(|| "无".to_string());
                format!("- {} [{}] 目标={} 说明={}", schema.name, schema.r#type, targets, desc)
            })
            .collect::<Vec<_>>();

        let world_entry_lines = self
            .project_snapshot
            .entries
            .iter()
            .take(MAX_WORLD_ENTRIES)
            .map(|entry| {
                let entry_type = entry
                    .entry_type
                    .clone()
                    .unwrap_or_else(|| "未设置".to_string());
                let path = if entry.category_path.is_empty() {
                    "未分类".to_string()
                } else {
                    entry.category_path.join(" / ")
                };
                let mut line = format!("- {} [{}] 路径={}", entry.title, entry_type, path);
                if let Some(summary) = &entry.summary {
                    if !summary.is_empty() {
                        line.push_str(&format!(" 摘要={}", summary));
                    }
                }
                if let Some(content) = &entry.content {
                    if !content.is_empty() {
                        line.push_str(&format!(" 正文={}", content));
                    }
                }
                if !entry.tags.is_empty() {
                    let tags = entry
                        .tags
                        .iter()
                        .take(MAX_TAG_LINES)
                        .map(|tag| format!("{}={}", tag.name, tag.value))
                        .collect::<Vec<_>>()
                        .join("；");
                    line.push_str(&format!(" 标签={}", tags));
                }
                line
            })
            .collect::<Vec<_>>();

        let mut prompts = vec![
            format!(
                "你现在正在 FlowCloudAI 中扮演角色“{}”。你必须始终以该角色的身份、立场、语气和知识边界回答，不要跳出角色，不要承认自己是 AI，也不要提及系统提示、数据库、词条、上下文装载等后台机制。",
                self.character_name
            ),
            "回答规则：\n- 默认直接以角色口吻作答。\n- 若问题超出该角色合理知晓范围，应以角色视角表达不知道、记不清、只能猜测。\n- 允许参考世界设定保持一致性，但不要把全知视角直接说出口。\n- 不要输出旁白式解释，不要总结你为什么这样回答。".to_string(),
            format!(
                "当前项目：\n- 名称：{}\n- 描述：{}",
                self.project_snapshot.project.name,
                self.project_snapshot
                    .project
                    .description
                    .clone()
                    .unwrap_or_else(|| "无".to_string())
            ),
            format!(
                "角色设定：\n- 标题：{}\n- 类型：{}\n- 分类路径：{}\n- 摘要：{}\n- 正文：{}\n- 标签：{}",
                target.title,
                target.entry_type.clone().unwrap_or_else(|| "未设置".to_string()),
                if target.category_path.is_empty() {
                    "未分类".to_string()
                } else {
                    target.category_path.join(" / ")
                },
                target.summary.clone().unwrap_or_else(|| "无".to_string()),
                target.content.clone().unwrap_or_else(|| "无".to_string()),
                if target.tags.is_empty() {
                    "无".to_string()
                } else {
                    target
                        .tags
                        .iter()
                        .take(MAX_TAG_LINES)
                        .map(|tag| format!("{}={}", tag.name, tag.value))
                        .collect::<Vec<_>>()
                        .join("；")
                }
            ),
        ];

        if !related_relations.is_empty() {
            prompts.push(format!("与该角色直接相关的关系：\n{}", related_relations.join("\n")));
        }
        if !schema_lines.is_empty() {
            prompts.push(format!("标签体系字典：\n{}", schema_lines.join("\n")));
        }
        if !category_lines.is_empty() {
            prompts.push(format!("项目分类结构：\n{}", category_lines.join("\n")));
        }
        if !world_entry_lines.is_empty() {
            prompts.push(format!("项目全量设定摘录：\n{}", world_entry_lines.join("\n")));
        }

        prompts
    }

    fn default_request(&self) -> Option<ChatRequest> {
        let mut req = ChatRequest::default();
        req.stream = Some(true);
        req.temperature = Some(0.9);
        req.tool_choice = Some("none".to_string());
        Some(req)
    }

    fn install_tools(&self, _registry: &mut ToolRegistry) -> anyhow::Result<()> {
        Ok(())
    }

    fn tool_whitelist(&self) -> Option<Vec<String>> {
        Some(Vec::new())
    }
}
