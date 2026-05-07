use crate::AppState;
use crate::apis::worldflow::common::initialize_default_timeline_tags;
use uuid::Uuid;
use worldflow_core::{
    CategoryOps, EntryOps, EntryRelationOps, EntryTypeOps, ProjectOps, TagSchemaOps, models::*,
};

pub mod category_tools;
pub mod confirm;
pub mod edit_tools;
pub mod entry_tools;
pub mod project_tools;
pub mod registry;
pub mod state;
pub mod web_tools;
pub use registry::register_worldflow_tools;

/// 工具返回结果格式化辅助
pub mod format {
    use super::*;
    use crate::template::render_global_template;
    use serde::Serialize;

    #[derive(Serialize)]
    struct ListItemsTemplateContext {
        items: Vec<String>,
    }

    #[derive(Serialize)]
    struct EntryTemplateContext {
        title: String,
        summary: Option<String>,
        entry_type: Option<String>,
        content: Option<String>,
        tags: Vec<String>,
    }

    #[derive(Serialize)]
    struct RelationsTemplateContext {
        current_name: String,
        items: Vec<String>,
    }

    #[derive(Serialize)]
    struct ProjectSummaryTemplateContext {
        name: String,
        description: Option<String>,
        count_lines: Vec<String>,
        created_at: String,
        updated_at: String,
    }

    #[derive(Serialize)]
    struct LinesTemplateContext {
        lines: Vec<String>,
    }

    #[derive(Serialize)]
    struct CategoriesSubtreeTemplateContext {
        header: String,
        lines: Vec<String>,
    }

    /// 格式化词条简报列表（用于 search_entries 返回）
    pub fn format_entry_briefs(briefs: &[EntryBrief]) -> String {
        if briefs.is_empty() {
            return "未找到相关词条".to_string();
        }

        let items = briefs
            .iter()
            .enumerate()
            .map(|(i, brief)| {
                let type_str = brief.r#type.as_deref().unwrap_or("未分类");
                let mut item = format!(
                    "{}. **{}** [{}] (ID: {})\n",
                    i + 1,
                    brief.title,
                    type_str,
                    brief.id
                );
                if let Some(summary) = &brief.summary {
                    item.push_str(&format!("   摘要：{}\n", summary));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/entry_briefs",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("找到以下词条：\n\n");
        for item in items {
            result.push_str(&item);
            result.push('\n');
        }
        result
    }

    /// 格式化完整词条（用于 get_entry 返回）
    pub fn format_entry(entry: &Entry) -> String {
        if let Some(rendered) = render_global_template(
            "formats/entry_full",
            &EntryTemplateContext {
                title: entry.title.clone(),
                summary: entry.summary.clone(),
                entry_type: entry.r#type.clone(),
                content: (!entry.content.is_empty()).then(|| entry.content.clone()),
                tags: entry
                    .tags
                    .0
                    .iter()
                    .map(|tag| format!("{} : {}", tag.schema_id, tag.value))
                    .collect(),
            },
        ) {
            return rendered;
        }

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

        let items = schemas
            .iter()
            .map(|schema| {
                let mut item = format!(
                    "- **{}** (schema_id: `{}`, 类型: {}, 目标: {})\n",
                    schema.name, schema.id, schema.r#type, schema.target
                );
                if let Some(desc) = &schema.description {
                    item.push_str(&format!("  描述：{}\n", desc));
                }
                if let Some(default) = &schema.default_val {
                    item.push_str(&format!("  默认值：{}\n", default));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/tag_schemas",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("项目标签定义：\n\n");
        for item in items {
            result.push_str(&item);
        }
        result
    }

    /// 格式化词条关系列表（用于 get_entry_relations 返回）
    pub fn format_relations(
        relations: &[EntryRelation],
        current_entry_id: &str,
        entry_names: &std::collections::HashMap<String, String>,
    ) -> String {
        if relations.is_empty() {
            return "该词条没有任何关系".to_string();
        }

        let current_id = match Uuid::parse_str(current_entry_id) {
            Ok(id) => id,
            Err(_) => return "当前词条 ID 格式无效".to_string(),
        };

        let name = |id: &Uuid| -> String {
            entry_names
                .get(&id.to_string())
                .cloned()
                .unwrap_or_else(|| id.to_string())
        };

        let current_name = name(&current_id);
        let items = relations
            .iter()
            .map(|rel| match rel.relation {
                RelationDirection::TwoWay => format!(
                    "- **{}** ↔ **{}**（双向）\n  描述：{}\n  关系ID：{}",
                    name(&rel.a_id),
                    name(&rel.b_id),
                    rel.content,
                    rel.id,
                ),
                RelationDirection::OneWay => format!(
                    "- **{}** → **{}**（单向）\n  描述：{}\n  关系ID：{}",
                    name(&rel.a_id),
                    name(&rel.b_id),
                    rel.content,
                    rel.id,
                ),
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/relations",
            &RelationsTemplateContext {
                current_name: current_name.clone(),
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = format!("「{}」的关系网络：\n\n", current_name);
        for item in items {
            result.push_str(&item);
            result.push_str("\n\n");
        }
        result
    }

    /// 格式化项目统计信息（用于 get_project_summary 返回）
    pub fn format_project_summary(
        project: &Project,
        entry_counts: &std::collections::HashMap<String, i64>,
    ) -> String {
        let count_lines = entry_counts
            .iter()
            .map(|(entry_type, count)| format!("- {} : {} 个", entry_type, count))
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/project_summary",
            &ProjectSummaryTemplateContext {
                name: project.name.clone(),
                description: project.description.clone(),
                count_lines: count_lines.clone(),
                created_at: project.created_at.to_string(),
                updated_at: project.updated_at.to_string(),
            },
        ) {
            return rendered;
        }

        let mut result = String::new();
        result.push_str(&format!("# 项目：{}\n\n", project.name));

        if let Some(desc) = &project.description {
            result.push_str(&format!("**描述**：{}\n\n", desc));
        }

        result.push_str("## 词条统计\n\n");
        if count_lines.is_empty() {
            result.push_str("暂无词条\n");
        } else {
            for line in count_lines {
                result.push_str(&line);
                result.push('\n');
            }
        }

        result.push_str(&format!("\n**创建时间**：{}\n", project.created_at));
        result.push_str(&format!("**更新时间**：{}\n", project.updated_at));

        result
    }

    /// 格式化项目列表（用于 list_projects 返回）
    pub fn format_projects(projects: &[Project]) -> String {
        if projects.is_empty() {
            return "暂无任何项目".to_string();
        }

        let items = projects
            .iter()
            .enumerate()
            .map(|(i, project)| {
                let mut item = format!("{}. **{}** (ID: {})\n", i + 1, project.name, project.id);
                if let Some(desc) = &project.description {
                    item.push_str(&format!("   描述：{}\n", desc));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/projects",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("项目列表：\n\n");
        for item in items {
            result.push_str(&item);
            result.push('\n');
        }
        result
    }

    /// 格式化分类列表（用于 list_categories 返回）
    pub fn format_categories(categories: &[Category]) -> String {
        if categories.is_empty() {
            return "该项目暂无分类".to_string();
        }

        let mut children_map: std::collections::HashMap<Option<Uuid>, Vec<&Category>> =
            std::collections::HashMap::new();
        for cat in categories {
            children_map.entry(cat.parent_id).or_default().push(cat);
        }

        fn render(
            parent: Option<Uuid>,
            depth: usize,
            map: &std::collections::HashMap<Option<Uuid>, Vec<&Category>>,
            out: &mut Vec<String>,
        ) {
            let Some(children) = map.get(&parent) else {
                return;
            };
            for cat in children {
                let indent = "  ".repeat(depth);
                out.push(format!("{}- **{}** (ID: {})", indent, cat.name, cat.id));
                render(Some(cat.id), depth + 1, map, out);
            }
        }

        let mut lines = Vec::new();
        render(None, 0, &children_map, &mut lines);

        if let Some(rendered) = render_global_template(
            "formats/categories",
            &LinesTemplateContext {
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("分类列表：\n\n");
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    /// 格式化词条类型列表（用于 list_entry_types 返回）
    pub fn format_entry_types(types: &[EntryTypeView]) -> String {
        if types.is_empty() {
            return "该项目未定义任何词条类型".to_string();
        }

        let lines = types
            .iter()
            .map(|et| match et {
                EntryTypeView::Builtin {
                    key,
                    name,
                    description,
                    ..
                } => {
                    let mut line = format!("- **{}** (key: `{}`, 内置)", name, key);
                    if !description.is_empty() {
                        line.push_str(&format!("\n  {}", description));
                    }
                    line
                }
                EntryTypeView::Custom(c) => {
                    let mut line = format!("- **{}** (id: `{}`, 自定义)", c.name, c.id);
                    if let Some(d) = &c.description {
                        line.push_str(&format!("\n  {}", d));
                    }
                    line
                }
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/entry_types",
            &LinesTemplateContext {
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("可用词条类型：\n\n");
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    /// 格式化分类子树（用于 query_categories 返回）
    pub fn format_categories_subtree(
        categories: &[Category],
        parent_id: Option<Uuid>,
        max_depth: Option<usize>,
    ) -> String {
        let mut children_map: std::collections::HashMap<Option<Uuid>, Vec<&Category>> =
            std::collections::HashMap::new();
        for cat in categories {
            children_map.entry(cat.parent_id).or_default().push(cat);
        }

        if !children_map.contains_key(&parent_id) {
            return match parent_id {
                None => "该项目暂无分类".to_string(),
                Some(pid) => {
                    let name = categories
                        .iter()
                        .find(|c| c.id == pid)
                        .map(|c| c.name.as_str())
                        .unwrap_or("未知分类");
                    format!("分类「{}」下暂无子分类", name)
                }
            };
        }

        let header = match parent_id {
            None => String::from("根目录下的分类：\n\n"),
            Some(pid) => {
                let name = categories
                    .iter()
                    .find(|c| c.id == pid)
                    .map(|c| c.name.as_str())
                    .unwrap_or("未知分类");
                format!("分类「{}」（ID: {}）的子分类：\n\n", name, pid)
            }
        };

        fn render(
            parent: Option<Uuid>,
            depth: usize,
            max_depth: Option<usize>,
            map: &std::collections::HashMap<Option<Uuid>, Vec<&Category>>,
            out: &mut Vec<String>,
        ) {
            if let Some(max) = max_depth {
                if depth >= max {
                    return;
                }
            }
            let Some(children) = map.get(&parent) else {
                return;
            };
            for cat in children {
                let indent = "  ".repeat(depth);
                out.push(format!("{}- **{}** (ID: {})", indent, cat.name, cat.id));
                render(Some(cat.id), depth + 1, max_depth, map, out);
            }
        }

        let mut lines = Vec::new();
        render(parent_id, 0, max_depth, &children_map, &mut lines);

        if let Some(rendered) = render_global_template(
            "formats/categories_subtree",
            &CategoriesSubtreeTemplateContext {
                header: header.clone(),
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = header;
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    // （已移除：format_category 和 format_project — 由统一工具返回消息替代）
}

// ============ 内部工具函数（不暴露给前端） ============

/// 创建词条
pub async fn create_entry(
    state: &AppState,
    project_id: &str,
    category_id: &str,
    title: String,
    entry_type: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> Result<Entry, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.create_entry(CreateEntry {
        project_id,
        category_id: Some(category_id),
        title,
        summary,
        content,
        r#type: entry_type,
        tags: None,
        images: None,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 列出项目分类
pub async fn list_categories(state: &AppState, project_id: &str) -> Result<Vec<Category>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 搜索词条（FTS）
pub async fn search_entries(
    state: &AppState,
    project_id: &str,
    query: &str,
    entry_type: Option<&str>,
    category_id: Option<&str>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = state.sqlite_db.lock().await;
    db.search_entries(
        &project_id,
        query,
        EntryFilter {
            category_id: category_id.as_ref(),
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

/// 列出项目内所有词条简报（不限类型）
pub async fn list_all_entries(
    state: &AppState,
    project_id: &str,
    category_id: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = state.sqlite_db.lock().await;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_ref(),
            entry_type: None,
        },
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 列出指定类型的词条简报
pub async fn list_entries_by_type(
    state: &AppState,
    project_id: &str,
    entry_type: &str,
    category_id: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = state.sqlite_db.lock().await;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_ref(),
            entry_type: Some(entry_type),
        },
        limit,
        offset,
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
) -> Result<
    (
        Vec<EntryRelation>,
        std::collections::HashMap<String, String>,
    ),
    String,
> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let relations = db
        .list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;

    // 收集关系中出现的所有词条 ID，查出名称
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut seen: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    for rel in &relations {
        seen.insert(rel.a_id);
        seen.insert(rel.b_id);
    }
    for id in seen {
        if let Ok(entry) = db.get_entry(&id).await {
            names.insert(id.to_string(), entry.title);
        }
    }

    Ok((relations, names))
}

/// 获取单条关系
pub async fn get_relation(state: &AppState, relation_id: &str) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.get_relation(&id).await.map_err(|e| e.to_string())
}

/// 创建词条关系
pub async fn create_relation(
    state: &AppState,
    a_id: &str,
    b_id: &str,
    relation: RelationDirection,
    content: String,
) -> Result<EntryRelation, String> {
    let a_id = Uuid::parse_str(a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(b_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    // project_id 从 a_id 所属词条推导，无需调用方传入
    let entry_a = db.get_entry(&a_id).await.map_err(|e| e.to_string())?;
    db.create_relation(CreateEntryRelation {
        project_id: entry_a.project_id,
        a_id,
        b_id,
        relation,
        content,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条关系
pub async fn update_relation(
    state: &AppState,
    relation_id: &str,
    relation: Option<RelationDirection>,
    content: Option<String>,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.update_relation(&id, UpdateEntryRelation { relation, content })
        .await
        .map_err(|e| e.to_string())
}

/// 删除词条关系
pub async fn delete_relation(state: &AppState, relation_id: &str) -> Result<(), String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.delete_relation(&id).await.map_err(|e| e.to_string())
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

    // 查出项目实际存在的所有词条类型，再分别统计数量
    let all_types = db
        .list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut counts = std::collections::HashMap::new();
    for et in &all_types {
        // builtin 以 key 作为 Entry.type 的值；custom 以 id（UUID string）作为值
        let (type_key, display_name): (String, String) = match et {
            EntryTypeView::Builtin { key, name, .. } => (key.to_string(), name.to_string()),
            EntryTypeView::Custom(c) => (c.id.to_string(), c.name.clone()),
        };
        let count = db
            .count_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: Some(type_key.as_str()),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        if count > 0 {
            counts.insert(display_name, count);
        }
    }

    Ok((project, counts))
}

/// 列出所有项目
pub async fn list_projects(state: &AppState) -> Result<Vec<Project>, String> {
    let db = state.sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
}

/// 更新词条基本字段（标题、摘要、类型，均可选）
/// - title:      None = 不更新；Some(s) = 更新
/// - summary:    None = 不更新；Some(None) = 清空；Some(Some(s)) = 更新
/// - entry_type: None = 不更新；Some(None) = 清空；Some(Some(s)) = 更新
pub async fn update_entry_fields(
    state: &AppState,
    entry_id: &str,
    title: Option<String>,
    summary: Option<Option<String>>,
    entry_type: Option<Option<String>>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: None,
            title,
            summary,
            content: None,
            r#type: entry_type,
            tags: None,
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条正文
pub async fn update_entry_content(
    state: &AppState,
    entry_id: &str,
    content: Option<String>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: None,
            title: None,
            summary: None,
            content,
            r#type: None,
            tags: None,
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 向词条添加单个标签（如 schema_id 已存在则覆盖其 value）
pub async fn add_entry_tag(
    state: &AppState,
    entry_id: &str,
    schema_id: &str,
    value: String,
) -> Result<Entry, String> {
    let entry_id_uuid = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let schema_id_uuid = Uuid::parse_str(schema_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let entry = db
        .get_entry(&entry_id_uuid)
        .await
        .map_err(|e| e.to_string())?;

    let mut tags = entry.tags.0;
    // 若已有同 schema_id 的标签则覆盖，否则追加
    if let Some(existing) = tags.iter_mut().find(|t| t.schema_id == schema_id_uuid) {
        existing.value = serde_json::Value::String(value);
    } else {
        tags.push(EntryTag {
            schema_id: schema_id_uuid,
            value: serde_json::Value::String(value),
        });
    }

    db.update_entry(
        &entry_id_uuid,
        UpdateEntry {
            category_id: None,
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: Some(tags),
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 从词条移除指定 schema_id 的标签
pub async fn remove_entry_tag(
    state: &AppState,
    entry_id: &str,
    schema_id: &str,
) -> Result<Entry, String> {
    let entry_id_uuid = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let schema_id_uuid = Uuid::parse_str(schema_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let entry = db
        .get_entry(&entry_id_uuid)
        .await
        .map_err(|e| e.to_string())?;

    let tags: Vec<EntryTag> = entry
        .tags
        .0
        .into_iter()
        .filter(|t| t.schema_id != schema_id_uuid)
        .collect();

    db.update_entry(
        &entry_id_uuid,
        UpdateEntry {
            category_id: None,
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: Some(tags),
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条标签（全量替换）
pub async fn update_entry_tags(
    state: &AppState,
    entry_id: &str,
    tags: Vec<EntryTag>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: None,
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: Some(tags),
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 删除词条
pub async fn delete_entry(state: &AppState, entry_id: &str) -> Result<(), String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.delete_entry(&entry_id).await.map_err(|e| e.to_string())
}

/// 创建分类
pub async fn create_category(
    state: &AppState,
    project_id: &str,
    name: String,
    parent_id: Option<&str>,
) -> Result<Category, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let parent_id = parent_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = state.sqlite_db.lock().await;
    db.create_category(CreateCategory {
        project_id,
        parent_id,
        name,
        sort_order: None,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 获取分类（含 project_id / parent_id 信息）
pub async fn get_category(state: &AppState, category_id: &str) -> Result<Category, String> {
    let category_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.get_category(&category_id)
        .await
        .map_err(|e| e.to_string())
}

/// 收集以 root_id 为根的分类子树（包含根节点本身），广度优先。
/// all_categories 为项目内全部分类列表（已从 DB 取出）。
pub fn collect_subtree_ids(root_id: Uuid, all_categories: &[Category]) -> Vec<Uuid> {
    let mut result = vec![root_id];
    let mut queue = vec![root_id];
    while let Some(current) = queue.pop() {
        for cat in all_categories {
            if cat.parent_id == Some(current) {
                result.push(cat.id);
                queue.push(cat.id);
            }
        }
    }
    result
}

/// 预览联级删除的影响范围，不执行任何写操作。
/// 返回 (entry_count, subcategory_count)
pub async fn preview_cascade_delete(
    state: &AppState,
    category_id: &str,
) -> Result<(usize, usize), String> {
    let root_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let root_cat = db.get_category(&root_id).await.map_err(|e| e.to_string())?;
    let all_cats = db
        .list_categories(&root_cat.project_id)
        .await
        .map_err(|e| e.to_string())?;
    let cat_ids = collect_subtree_ids(root_id, &all_cats);
    let subcategory_count = cat_ids.len().saturating_sub(1);

    let mut entry_count = 0usize;
    for cid in &cat_ids {
        let mut offset = 0usize;
        loop {
            let batch = db
                .list_entries(
                    &root_cat.project_id,
                    EntryFilter {
                        category_id: Some(cid),
                        entry_type: None,
                    },
                    200,
                    offset,
                )
                .await
                .map_err(|e| e.to_string())?;
            entry_count += batch.len();
            if batch.len() < 200 {
                break;
            }
            offset += 200;
        }
    }
    Ok((entry_count, subcategory_count))
}

/// 执行联级删除：删除子树内所有词条，再从叶到根删除所有分类。
/// 返回 (deleted_entries, deleted_categories)
pub async fn cascade_delete_category(
    state: &AppState,
    category_id: &str,
) -> Result<(usize, usize), String> {
    let root_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let root_cat = db.get_category(&root_id).await.map_err(|e| e.to_string())?;
    let all_cats = db
        .list_categories(&root_cat.project_id)
        .await
        .map_err(|e| e.to_string())?;
    let cat_ids = collect_subtree_ids(root_id, &all_cats);

    let mut entries_deleted = 0usize;
    for cid in &cat_ids {
        let mut offset = 0usize;
        loop {
            let batch = db
                .list_entries(
                    &root_cat.project_id,
                    EntryFilter {
                        category_id: Some(cid),
                        entry_type: None,
                    },
                    200,
                    offset,
                )
                .await
                .map_err(|e| e.to_string())?;
            if batch.is_empty() {
                break;
            }
            for brief in &batch {
                db.delete_entry(&brief.id)
                    .await
                    .map_err(|e| e.to_string())?;
                entries_deleted += 1;
            }
            if batch.len() < 200 {
                break;
            }
            offset += 200;
        }
    }

    // 从叶到根删除分类
    for cid in cat_ids.iter().rev() {
        db.delete_category(cid).await.map_err(|e| e.to_string())?;
    }

    Ok((entries_deleted, cat_ids.len()))
}

/// 删除分类并将直接子分类和词条上移到父分类（或根节点）。
pub async fn delete_category_move_to_parent(
    state: &AppState,
    category_id: &str,
) -> Result<(), String> {
    let cat_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    let category = db.get_category(&cat_id).await.map_err(|e| e.to_string())?;
    let new_parent = category.parent_id; // None = 根节点

    // 将直接子分类的 parent_id 指向祖父
    let all_cats = db
        .list_categories(&category.project_id)
        .await
        .map_err(|e| e.to_string())?;
    for child in all_cats.iter().filter(|c| c.parent_id == Some(cat_id)) {
        db.update_category(
            &child.id,
            UpdateCategory {
                parent_id: Some(new_parent),
                name: None,
                sort_order: None,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // 将该分类下词条移到父分类
    let mut offset = 0usize;
    loop {
        let batch = db
            .list_entries(
                &category.project_id,
                EntryFilter {
                    category_id: Some(&cat_id),
                    entry_type: None,
                },
                200,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        for brief in &batch {
            db.update_entry(
                &brief.id,
                UpdateEntry {
                    category_id: Some(new_parent),
                    title: None,
                    summary: None,
                    content: None,
                    r#type: None,
                    tags: None,
                    images: None,
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        if batch.len() < 200 {
            break;
        }
        offset += 200;
    }

    db.delete_category(&cat_id).await.map_err(|e| e.to_string())
}

/// 列出项目所有词条类型（内置 + 自定义）
pub async fn list_entry_types(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<EntryTypeView>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await;
    db.list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 移动词条到指定分类；category_id = None 表示移出所有分类（置为根节点词条）
pub async fn move_entry(
    state: &AppState,
    entry_id: &str,
    category_id: Option<&str>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = state.sqlite_db.lock().await;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: Some(category_id),
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: None,
            images: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 创建项目（含默认时间线标签初始化）
pub async fn create_project(
    state: &AppState,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let db = state.sqlite_db.lock().await;
    let project = db
        .create_project(CreateProject {
            name,
            description,
            cover_image: None,
        })
        .await
        .map_err(|e| e.to_string())?;

    if let Err(error) = initialize_default_timeline_tags(&db, &project.id).await {
        log::error!(
            "[tools] AI 创建项目后初始化时间线标签失败: project_id={} error={}",
            project.id,
            error
        );
        // 不回滚项目，避免 AI 工具链因标签初始化失败而中断
    }

    Ok(project)
}
