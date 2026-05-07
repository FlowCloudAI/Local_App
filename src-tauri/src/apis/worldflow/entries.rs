use super::common::*;
use super::images::copy_entry_images;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryRelationDraft {
    pub id: Option<String>,
    pub other_entry_id: Option<String>,
    pub direction: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryBundleInput {
    pub id: String,
    pub project_id: String,
    pub category_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub r#type: Option<String>,
    pub tags: Option<Vec<EntryTag>>,
    pub images: Option<Vec<FCImage>>,
    #[serde(default)]
    pub relation_drafts: Vec<SaveEntryRelationDraft>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryBundleResponse {
    pub entry: Entry,
    pub outgoing_links: Vec<EntryLink>,
    pub incoming_links: Vec<EntryLink>,
    pub relations: Vec<EntryRelation>,
}

fn normalize_entry_compare_text(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n").trim().to_string()
}

fn normalize_entry_lookup_title(value: &str) -> String {
    value.trim().to_lowercase()
}

fn parse_entry_uri(raw: &str) -> Option<Uuid> {
    let decoded = urlencoding::decode(raw).ok()?;
    Uuid::parse_str(decoded.trim()).ok()
}

fn parse_internal_entry_links(content: &str) -> Vec<(Option<Uuid>, String)> {
    let mut links = Vec::new();
    let mut offset = 0usize;

    while offset < content.len() {
        let Some(open_rel) = content[offset..].find('[') else {
            break;
        };
        let open = offset + open_rel;

        if content[open..].starts_with("[[") {
            let title_start = open + 2;
            if let Some(close_rel) = content[title_start..].find("]]") {
                let close = title_start + close_rel;
                let title = content[title_start..close].trim();
                if !title.is_empty() && !title.contains('\n') {
                    links.push((None, title.to_string()));
                }
                offset = close + 2;
                continue;
            }
        }

        let title_start = open + 1;
        let Some(title_close_rel) = content[title_start..].find(']') else {
            offset = title_start;
            continue;
        };
        let title_close = title_start + title_close_rel;
        let link_prefix = "](entry://";
        if !content[title_close..].starts_with(link_prefix) {
            offset = title_close + 1;
            continue;
        }

        let id_start = title_close + link_prefix.len();
        let Some(id_close_rel) = content[id_start..].find(')') else {
            offset = id_start;
            continue;
        };
        let id_close = id_start + id_close_rel;
        let title = content[title_start..title_close].trim();
        if !title.is_empty() && !title.contains('\n') {
            links.push((parse_entry_uri(&content[id_start..id_close]), title.to_string()));
        }
        offset = id_close + 1;
    }

    links
}

fn resolve_relation_payload(
    entry_id: &Uuid,
    draft: &SaveEntryRelationDraft,
) -> Result<(Uuid, Uuid, RelationDirection, String), String> {
    let other_entry_id = draft
        .other_entry_id
        .as_deref()
        .ok_or_else(|| "存在未完成的词条关系，请先选择目标词条。".to_string())
        .and_then(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))?;
    if &other_entry_id == entry_id {
        return Err("存在未完成的词条关系，请先选择目标词条。".to_string());
    }

    let content = normalize_entry_compare_text(draft.content.as_deref().unwrap_or_default());
    match draft.direction.as_str() {
        "incoming" => Ok((other_entry_id, *entry_id, RelationDirection::OneWay, content)),
        "two_way" => Ok((*entry_id, other_entry_id, RelationDirection::TwoWay, content)),
        _ => Ok((*entry_id, other_entry_id, RelationDirection::OneWay, content)),
    }
}

#[tauri::command]
pub async fn db_create_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    project_id: String,
    category_id: Option<String>,
    title: String,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let images = copy_entry_images(paths.inner(), &project_id, images)?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry = db
        .create_entry(CreateEntry {
            project_id,
            category_id,
            title,
            summary,
            content,
            r#type,
            tags,
            images,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    Ok(entry)
}

/// 获取完整词条（含 content、tags、images）
#[tauri::command]
pub async fn db_get_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<Entry, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_entry(&id).await.map_err(|e| e.to_string())
}

/// 分页列出词条简报（不含 content）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_list_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_list_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} offset={}",
        project_id,
        category_id,
        entry_type,
        limit,
        offset
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    let result = db
        .list_entries(
            &project_id,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
            offset,
        )
        .await;

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_list_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_list_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 聚合项目内带时间标签的词条，输出时间线事件数据
#[tauri::command]
pub async fn db_list_timeline_events(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<ProjectTimelineData, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    let tag_schemas = db
        .list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let schema_role_map = tag_schemas
        .iter()
        .filter_map(|schema| {
            timeline_tag_role_from_name(&schema.name).map(|role| (schema.id, role))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let mut entry_briefs = Vec::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: None,
                },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        offset += batch_len;
        entry_briefs.extend(batch);

        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let scanned_entry_count = entry_briefs.len();
    let mut events = Vec::new();

    for brief in entry_briefs {
        let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
        let mut start_time = None;
        let mut end_time = None;
        let mut parent_id = None;
        let mut show_on_timeline = None;

        for tag in &entry.tags.0 {
            let Some(role) = schema_role_map.get(&tag.schema_id).copied() else {
                continue;
            };

            match role {
                TimelineTagRole::Start => {
                    if start_time.is_none() {
                        start_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::End => {
                    if end_time.is_none() {
                        end_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::Parent => {
                    if parent_id.is_none() {
                        parent_id = parse_timeline_parent(&tag.value);
                    }
                }
                TimelineTagRole::Show => {
                    if show_on_timeline.is_none() {
                        show_on_timeline = parse_timeline_bool(&tag.value);
                    }
                }
            }
        }

        let Some(start_time) = start_time else {
            continue;
        };

        if matches!(show_on_timeline, Some(false)) {
            continue;
        }

        let (start_time, end_time) = match end_time {
            Some(end_time) if end_time < start_time => (end_time, Some(start_time)),
            Some(end_time) => (start_time, Some(end_time)),
            None => (start_time, None),
        };

        events.push(ProjectTimelineEvent {
            id: entry.id.to_string(),
            title: entry.title.clone(),
            start_time,
            end_time,
            description: entry.summary.clone(),
            parent_id,
            entry_type: entry.r#type.clone(),
            category_id: entry.category_id.map(|category_id| category_id.to_string()),
        });
    }

    let title_to_id = events
        .iter()
        .map(|event| (normalize_timeline_tag_name(&event.title), event.id.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let valid_ids = events
        .iter()
        .map(|event| event.id.clone())
        .collect::<std::collections::HashSet<_>>();

    for event in &mut events {
        let resolved_parent = event.parent_id.as_ref().and_then(|parent| {
            if valid_ids.contains(parent) {
                Some(parent.clone())
            } else {
                title_to_id
                    .get(&normalize_timeline_tag_name(parent))
                    .cloned()
            }
        });

        event.parent_id = match resolved_parent {
            Some(parent_id) if parent_id != event.id => Some(parent_id),
            _ => None,
        };
    }

    events.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| {
                left.end_time
                    .unwrap_or(left.start_time)
                    .cmp(&right.end_time.unwrap_or(right.start_time))
            })
            .then_with(|| left.title.cmp(&right.title))
    });

    let year_start = events.iter().map(|event| event.start_time).min();
    let year_end = events
        .iter()
        .map(|event| event.end_time.unwrap_or(event.start_time))
        .max();

    Ok(ProjectTimelineData {
        matched_entry_count: events.len(),
        scanned_entry_count,
        year_start,
        year_end,
        events,
    })
}

/// 统计项目图片总数和总字数
#[tauri::command]
pub async fn db_get_project_stats(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
) -> Result<ProjectStats, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    let mut image_count = 0usize;
    let mut word_count = 0usize;
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: None,
                },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        for brief in &batch {
            let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
            image_count += entry.images.0.len();
            word_count += entry.content.chars().count();
        }

        offset += batch_len;
        if batch_len < PAGE_SIZE {
            break;
        }
    }

    Ok(ProjectStats {
        image_count,
        word_count,
    })
}

/// 全文搜索词条（FTS）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_search_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    query: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_search_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} query={:?}",
        project_id,
        category_id,
        entry_type,
        limit,
        query
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    let result = db
        .search_entries(
            &project_id,
            &query,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
        )
        .await;

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_search_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_search_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 统计词条数量；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_count_entries(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
) -> Result<i64, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let category_id_ref = category_id.as_ref();
    db.count_entries(
        &project_id,
        EntryFilter {
            category_id: category_id_ref,
            entry_type: entry_type.as_deref(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条；仅传入需要修改的字段，None 表示不变
#[tauri::command]
pub async fn db_update_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    id: String,
    category_id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    summary_set: Option<bool>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    log::info!(
        "[db_update_entry] 开始保存 entry_id={}, images_count={:?}",
        id,
        images.as_ref().map(|v| v.len())
    );
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let current_entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    let images = copy_entry_images(paths.inner(), &current_entry.project_id, images)?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let entry = db
        .update_entry(
            &id,
            UpdateEntry {
                category_id: Some(category_id),
                title,
                summary: if summary_set.unwrap_or(false) {
                    Some(summary)
                } else {
                    None
                },
                content,
                r#type: Some(r#type),
                tags,
                images,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    log::info!(
        "[db_update_entry] 保存完成 entry_id={}, images_count={}",
        entry.id,
        entry.images.0.len()
    );
    Ok(entry)
}

/// 保存词条主体、正文内链和关系草稿，减少前端多轮 IPC。
#[tauri::command]
pub async fn db_save_entry_bundle(
    state: State<'_, Arc<Mutex<AppState>>>,
    paths: State<'_, PathsState>,
    input: SaveEntryBundleInput,
) -> Result<SaveEntryBundleResponse, String> {
    let project_id = Uuid::parse_str(&input.project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&input.id).map_err(|e| e.to_string())?;
    let category_id = input
        .category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;

    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let current_entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;

    let category_id_ref = category_id.as_ref();
    let same_category_entries = db
        .list_entries(
            &project_id,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: None,
            },
            1000,
            0,
        )
        .await
        .map_err(|e| e.to_string())?;
    let normalized_title = normalize_entry_compare_text(&input.title);
    if same_category_entries.iter().any(|entry| {
        entry.id != entry_id && normalize_entry_compare_text(&entry.title) == normalized_title
    }) {
        return Err("当前分类下已存在同名词条，请更换标题。".to_string());
    }

    for draft in &input.relation_drafts {
        resolve_relation_payload(&entry_id, draft)?;
    }

    let images = copy_entry_images(paths.inner(), &current_entry.project_id, input.images)?;
    let entry = db
        .update_entry(
            &entry_id,
            UpdateEntry {
                category_id: Some(category_id),
                title: Some(normalized_title),
                summary: Some(input.summary),
                content: Some(input.content.clone().unwrap_or_default()),
                r#type: Some(input.r#type),
                tags: input.tags,
                images,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let all_entry_briefs = db
        .list_entries(&project_id, EntryFilter::default(), 1000, 0)
        .await
        .map_err(|e| e.to_string())?;
    let title_to_entry_id = all_entry_briefs
        .iter()
        .map(|entry| (normalize_entry_lookup_title(&entry.title), entry.id))
        .collect::<HashMap<_, _>>();
    let mut target_ids = Vec::<Uuid>::new();
    for (entry_id_from_link, title) in parse_internal_entry_links(input.content.as_deref().unwrap_or_default()) {
        if let Some(id) = entry_id_from_link {
            target_ids.push(id);
            continue;
        }
        if let Some(id) = title_to_entry_id.get(&normalize_entry_lookup_title(&title)) {
            target_ids.push(*id);
        }
    }
    let outgoing_links = db
        .replace_outgoing_links(&project_id, &entry_id, &target_ids)
        .await
        .map_err(|e| e.to_string())?;

    let existing_relations = db
        .list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    let current_relation_map = existing_relations
        .iter()
        .map(|relation| (relation.id, relation))
        .collect::<HashMap<_, _>>();
    let next_relation_ids = input
        .relation_drafts
        .iter()
        .filter_map(|draft| draft.id.as_deref())
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect::<BTreeSet<_>>();

    for draft in &input.relation_drafts {
        let (a_id, b_id, relation, content) = resolve_relation_payload(&entry_id, draft)?;
        let existing = draft
            .id
            .as_deref()
            .and_then(|id| Uuid::parse_str(id).ok())
            .and_then(|id| current_relation_map.get(&id).copied());

        let Some(existing) = existing else {
            db.create_relation(CreateEntryRelation {
                project_id,
                a_id,
                b_id,
                relation,
                content,
            })
                .await
                .map_err(|e| e.to_string())?;
            continue;
        };

        if existing.a_id != a_id || existing.b_id != b_id {
            db.delete_relation(&existing.id)
                .await
                .map_err(|e| e.to_string())?;
            db.create_relation(CreateEntryRelation {
                project_id,
                a_id,
                b_id,
                relation,
                content,
            })
                .await
                .map_err(|e| e.to_string())?;
            continue;
        }

        if existing.relation != relation
            || normalize_entry_compare_text(&existing.content) != content
        {
            db.update_relation(
                &existing.id,
                UpdateEntryRelation {
                    relation: Some(relation),
                    content: Some(content),
                },
            )
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    for existing in &existing_relations {
        if next_relation_ids.contains(&existing.id) {
            continue;
        }
        db.delete_relation(&existing.id)
            .await
            .map_err(|e| e.to_string())?;
    }

    touch_project_updated_at(&db, &project_id).await?;
    let incoming_links = db
        .list_incoming_links(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    let relations = db
        .list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SaveEntryBundleResponse {
        entry,
        outgoing_links,
        incoming_links,
        relations,
    })
}

/// 删除词条
#[tauri::command]
pub async fn db_delete_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    db.delete_entry(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &entry.project_id).await
}

/// 批量创建词条；返回成功插入的条数
#[tauri::command]
pub async fn db_create_entries_bulk(
    state: State<'_, Arc<Mutex<AppState>>>,
    entries: Vec<CreateEntry>,
) -> Result<usize, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let project_ids = entries
        .iter()
        .map(|entry| entry.project_id)
        .collect::<BTreeSet<_>>();

    let count = db
        .create_entries_bulk(entries)
        .await
        .map_err(|e| e.to_string())?;

    for project_id in project_ids {
        touch_project_updated_at(&db, &project_id).await?;
    }

    Ok(count)
}

/// 优化 FTS 索引，消除碎片；建议在 create_entries_bulk 后调用
#[tauri::command]
pub async fn db_optimize_fts(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.optimize_fts().await.map_err(|e| e.to_string())
}

// ============ 标签模式 ============
