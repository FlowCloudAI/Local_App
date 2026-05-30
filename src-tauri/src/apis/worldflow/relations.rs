use super::common::*;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationGraphNode {
    pub id: String,
    pub label: String,
    pub title: String,
    pub summary: String,
    pub cover_image: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationGraphData {
    pub nodes: Vec<RelationGraphNode>,
    pub edges: Vec<RelationGraphEdge>,
}

#[tauri::command]
pub async fn db_create_relation(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    a_id: String,
    b_id: String,
    relation: RelationDirection,
    content: String,
) -> Result<EntryRelation, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let a_id = Uuid::parse_str(&a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(&b_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    let relation = db
        .create_relation(CreateEntryRelation {
            project_id,
            a_id,
            b_id,
            relation,
            content,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &relation.project_id).await?;
    Ok(relation)
}

/// 查询单条词条关系
#[tauri::command]
pub async fn db_get_relation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.get_relation(&id).await.map_err(|e| e.to_string())
}

/// 查询某词条的所有关系（含双向）
#[tauri::command]
pub async fn db_list_relations_for_entry(
    state: State<'_, Arc<AppState>>,
    entry_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 查询项目下所有词条关系（用于构建关系图）
#[tauri::command]
pub async fn db_list_relations_for_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<EntryRelation>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 聚合关系图渲染所需的节点和边，避免前端重复拉取与转换。
#[tauri::command]
pub async fn db_get_relation_graph_data(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<RelationGraphData, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    let entries = db
        .list_entries(&project_id, EntryFilter::default(), 1000, 0)
        .await
        .map_err(|e| e.to_string())?;
    let relations = db
        .list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let node_ids = entries.iter().map(|entry| entry.id).collect::<HashSet<_>>();
    let valid_relations = relations
        .into_iter()
        .filter(|relation| node_ids.contains(&relation.a_id) && node_ids.contains(&relation.b_id))
        .collect::<Vec<_>>();
    let mut connected_node_ids = HashSet::new();
    for relation in &valid_relations {
        connected_node_ids.insert(relation.a_id);
        connected_node_ids.insert(relation.b_id);
    }

    Ok(RelationGraphData {
        nodes: entries
            .into_iter()
            .filter(|entry| connected_node_ids.contains(&entry.id))
            .map(|entry| RelationGraphNode {
                id: entry.id.to_string(),
                label: entry.title.clone(),
                title: entry.title,
                summary: entry.summary.unwrap_or_else(|| "暂无摘要".to_string()),
                cover_image: entry.cover,
            })
            .collect(),
        edges: valid_relations
            .into_iter()
            .map(|relation| RelationGraphEdge {
                id: relation.id.to_string(),
                source: relation.a_id.to_string(),
                target: relation.b_id.to_string(),
                label: relation.content,
                kind: relation.relation.as_str().to_string(),
            })
            .collect(),
    })
}

/// 更新词条关系的方向或描述内容
#[tauri::command]
pub async fn db_update_relation(
    state: State<'_, Arc<AppState>>,
    id: String,
    relation: Option<RelationDirection>,
    content: Option<String>,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    let relation = db
        .update_relation(&id, UpdateEntryRelation { relation, content })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &relation.project_id).await?;
    Ok(relation)
}

/// 删除单条词条关系
#[tauri::command]
pub async fn db_delete_relation(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    let relation = db.get_relation(&id).await.map_err(|e| e.to_string())?;
    db.delete_relation(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &relation.project_id).await
}

/// 删除两个词条之间的所有关系；返回删除的条数
#[tauri::command]
pub async fn db_delete_relations_between(
    state: State<'_, Arc<AppState>>,
    entry_a_id: String,
    entry_b_id: String,
) -> Result<u64, String> {
    let entry_a_id = Uuid::parse_str(&entry_a_id).map_err(|e| e.to_string())?;
    let entry_b_id = Uuid::parse_str(&entry_b_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    let entry = db.get_entry(&entry_a_id).await.map_err(|e| e.to_string())?;
    let deleted = db
        .delete_relations_between(&entry_a_id, &entry_b_id)
        .await
        .map_err(|e| e.to_string())?;

    if deleted > 0 {
        touch_project_updated_at(&db, &entry.project_id).await?;
    }

    Ok(deleted)
}

// ============ 词条类型 ============
