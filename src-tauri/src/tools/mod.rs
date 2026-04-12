use crate::AppState;
use uuid::Uuid;
use worldflow_core::{EntryOps, EntryRelationOps, ProjectOps, TagSchemaOps, models::*};

pub mod registry;
pub use registry::register_worldflow_tools;

/// 工具返回结果格式化辅助
pub mod format {
    use super::*;

    /// 格式化词条简报列表（用于 search_entries 返回）
    pub fn format_entry_briefs(briefs: &[EntryBrief]) -> String {
        if briefs.is_empty() {
            return "未找到相关词条".to_string();
        }

        let mut result = String::from("找到以下词条：\n\n");
        for (i, brief) in briefs.iter().enumerate() {
            result.push_str(&format!(
                "{}. **{}** (ID: {})\n",
                i + 1,
                brief.title,
                brief.id
            ));
            if let Some(summary) = &brief.summary {
                result.push_str(&format!("   摘要：{}\n", summary));
            }
            result.push('\n');
        }
        result
    }

    /// 格式化完整词条（用于 get_entry 返回）
    pub fn format_entry(entry: &Entry) -> String {
        let mut result = String::new();
        result.push_str(&format!("# {}\n\n", entry.title));

        if let Some(summary) = &entry.summary {
            result.push_str(&format!("**摘要**：{}\n\n", summary));
        }

        if let Some(entry_type) = &entry.r#type {
            result.push_str(&format!("**类型**：{}\n\n", entry_type));
        }

        if !entry.content.is_empty() {
            result.push_str(&format!("## 内容\n\n{}\n\n", entry.content));
        }

        // 格式化标签
        if !entry.tags.0.is_empty() {
            result.push_str("## 标签\n\n");
            for tag in &entry.tags.0 {
                result.push_str(&format!("- {} : {}\n", tag.schema_id, tag.value));
            }
            result.push('\n');
        }

        result
    }

    /// 格式化标签定义列表（用于 list_tag_schemas 返回）
    pub fn format_tag_schemas(schemas: &[TagSchema]) -> String {
        if schemas.is_empty() {
            return "该项目未定义任何标签".to_string();
        }

        let mut result = String::from("项目标签定义：\n\n");
        for schema in schemas {
            result.push_str(&format!(
                "- **{}** (类型: {}, 目标: {})\n",
                schema.name, schema.r#type, schema.target
            ));
            if let Some(desc) = &schema.description {
                result.push_str(&format!("  描述：{}\n", desc));
            }
            if let Some(default) = &schema.default_val {
                result.push_str(&format!("  默认值：{}\n", default));
            }
        }
        result
    }

    /// 格式化词条关系列表（用于 get_entry_relations 返回）
    pub fn format_relations(relations: &[EntryRelation], current_entry_id: &str) -> String {
        if relations.is_empty() {
            return "该词条没有任何关系".to_string();
        }

        let current_id = match Uuid::parse_str(current_entry_id) {
            Ok(id) => id,
            Err(_) => return "当前词条 ID 格式无效".to_string(),
        };

        let mut result = String::from("词条关系网络：\n\n");
        for rel in relations {
            let direction = match rel.relation {
                RelationDirection::OneWay => "→",
                RelationDirection::TwoWay => "↔",
            };

            result.push_str(&format!(
                "- {} {} {}\n  关系描述：{}\n\n",
                if rel.a_id == current_id {
                    "我"
                } else {
                    "对方"
                },
                direction,
                if rel.a_id == current_id {
                    "对方"
                } else {
                    "我"
                },
                rel.content
            ));
        }
        result
    }

    /// 格式化项目统计信息（用于 get_project_summary 返回）
    pub fn format_project_summary(
        project: &Project,
        entry_counts: &std::collections::HashMap<String, i64>,
    ) -> String {
        let mut result = String::new();
        result.push_str(&format!("# 项目：{}\n\n", project.name));

        if let Some(desc) = &project.description {
            result.push_str(&format!("**描述**：{}\n\n", desc));
        }

        result.push_str("## 词条统计\n\n");
        if entry_counts.is_empty() {
            result.push_str("暂无词条\n");
        } else {
            for (entry_type, count) in entry_counts {
                result.push_str(&format!("- {} : {} 个\n", entry_type, count));
            }
        }

        result.push_str(&format!("\n**创建时间**：{}\n", project.created_at));
        result.push_str(&format!("**更新时间**：{}\n", project.updated_at));

        result
    }
}

// ============ 内部工具函数（不暴露给前端） ============

/// 搜索词条（FTS）
pub async fn search_entries(
    state: &AppState,
    project_id: &str,
    query: &str,
    entry_type: Option<&str>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.search_entries(
        &project_id,
        query,
        EntryFilter {
            category_id: None,
            entry_type,
        },
        limit,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 获取词条完整内容
pub async fn get_entry(state: &AppState, entry_id: &str) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.get_entry(&entry_id).await.map_err(|e| e.to_string())
}

/// 列出指定类型的词条简报
pub async fn list_entries_by_type(
    state: &AppState,
    project_id: &str,
    entry_type: &str,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: None,
            entry_type: Some(entry_type),
        },
        limit,
        0,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 获取项目标签定义
pub async fn list_tag_schemas(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<TagSchema>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取词条关系网络
pub async fn get_entry_relations(
    state: &AppState,
    entry_id: &str,
) -> Result<Vec<EntryRelation>, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取项目统计信息
pub async fn get_project_summary(
    state: &AppState,
    project_id: &str,
) -> Result<(Project, std::collections::HashMap<String, i64>), String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;

    // 获取项目信息
    let project = db
        .get_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    // 统计各类型词条数量
    let entry_types = vec!["character", "item", "location", "event", "faction"];
    let mut counts = std::collections::HashMap::new();

    for entry_type in entry_types {
        let count = db
            .count_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: Some(entry_type),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        if count > 0 {
            counts.insert(entry_type.to_string(), count);
        }
    }

    Ok((project, counts))
}
