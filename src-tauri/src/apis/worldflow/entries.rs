use super::common::*;
use super::images::copy_entry_images;

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
        .filter_map(|schema| timeline_tag_role_from_name(&schema.name).map(|role| (schema.id, role)))
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
                title_to_id.get(&normalize_timeline_tag_name(parent)).cloned()
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
            .then_with(|| left.end_time.unwrap_or(left.start_time).cmp(&right.end_time.unwrap_or(right.start_time)))
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
                EntryFilter { category_id: None, entry_type: None },
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

    Ok(ProjectStats { image_count, word_count })
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
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    log::info!("[db_update_entry] 开始保存 entry_id={}, images_count={:?}", id, images.as_ref().map(|v| v.len()));
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
                summary,
                content,
                r#type: Some(r#type),
                tags,
                images,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    log::info!("[db_update_entry] 保存完成 entry_id={}, images_count={}", entry.id, entry.images.0.len());
    Ok(entry)
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

// ============ Tag Schemas ============
