use super::common::*;

fn sort_idea_notes(notes: &mut [IdeaNote]) {
    notes.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
}

async fn open_idea_db(state: &AppState, id: &Uuid) -> Result<SqliteDb, String> {
    for world in state
        .world_store
        .list_worlds()
        .await
        .map_err(|e| e.to_string())?
    {
        let Ok(db) = state.world_store.open_world(world.id).await else {
            continue;
        };
        if db.get_idea_note(id).await.is_ok() {
            return Ok(db);
        }
    }

    Ok(state.sqlite_db.lock().await.clone())
}

async fn list_all_idea_notes(
    state: &AppState,
    status: Option<IdeaNoteStatus>,
    pinned: Option<bool>,
    limit: usize,
    offset: usize,
) -> Result<Vec<IdeaNote>, String> {
    let fetch_limit = limit.saturating_add(offset);
    let source_db = state.sqlite_db.lock().await.clone();
    let mut notes = source_db
        .list_idea_notes(
            IdeaNoteFilter {
                project_id: None,
                only_global: true,
                status: status.as_ref(),
                pinned,
            },
            fetch_limit,
            0,
        )
        .await
        .map_err(|e| e.to_string())?;

    for world in state
        .world_store
        .list_worlds()
        .await
        .map_err(|e| e.to_string())?
    {
        let Ok(db) = state.world_store.open_world(world.id).await else {
            continue;
        };
        let mut world_notes = db
            .list_idea_notes(
                IdeaNoteFilter {
                    project_id: Some(&world.id),
                    only_global: false,
                    status: status.as_ref(),
                    pinned,
                },
                fetch_limit,
                0,
            )
            .await
            .map_err(|e| e.to_string())?;
        notes.append(&mut world_notes);
    }

    sort_idea_notes(&mut notes);
    Ok(notes.into_iter().skip(offset).take(limit).collect())
}

#[tauri::command]
pub async fn db_create_idea_note(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    content: String,
    title: Option<String>,
    pinned: Option<bool>,
) -> Result<IdeaNote, String> {
    let project_id = project_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    let db = match project_id.as_ref() {
        Some(project_id) => open_project_db(state.inner(), project_id).await?,
        None => state.inner().sqlite_db.lock().await.clone(),
    };
    db.create_idea_note(CreateIdeaNote {
        project_id,
        content,
        title,
        pinned,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 获取单条灵感便签
#[tauri::command]
pub async fn db_get_idea_note(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<IdeaNote, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = open_idea_db(state.inner(), &id).await?;
    db.get_idea_note(&id).await.map_err(|e| e.to_string())
}

/// 查询灵感便签列表
#[tauri::command]
pub async fn db_list_idea_notes(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    only_global: Option<bool>,
    status: Option<IdeaNoteStatus>,
    pinned: Option<bool>,
    limit: usize,
    offset: usize,
) -> Result<Vec<IdeaNote>, String> {
    if project_id.is_some() && only_global.unwrap_or(false) {
        return Err("project_id 与 only_global 不能同时设置".to_string());
    }

    let project_id = project_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    if project_id.is_none() && !only_global.unwrap_or(false) {
        return list_all_idea_notes(state.inner(), status, pinned, limit, offset).await;
    }

    let db = match project_id.as_ref() {
        Some(project_id) => open_project_db(state.inner(), project_id).await?,
        None => state.inner().sqlite_db.lock().await.clone(),
    };
    db.list_idea_notes(
        IdeaNoteFilter {
            project_id: project_id.as_ref(),
            only_global: only_global.unwrap_or(false),
            status: status.as_ref(),
            pinned,
        },
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新灵感便签
#[tauri::command]
pub async fn db_update_idea_note(
    state: State<'_, Arc<AppState>>,
    id: String,
    project_id: Option<Option<String>>,
    title: Option<Option<String>>,
    content: Option<String>,
    status: Option<IdeaNoteStatus>,
    pinned: Option<bool>,
    last_reviewed_at: Option<Option<String>>,
    converted_entry_id: Option<Option<String>>,
) -> Result<IdeaNote, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = project_id
        .map(|value| {
            value
                .map(|project_id| Uuid::parse_str(&project_id).map_err(|e| e.to_string()))
                .transpose()
        })
        .transpose()?;
    let converted_entry_id = converted_entry_id
        .map(|value| {
            value
                .map(|entry_id| Uuid::parse_str(&entry_id).map_err(|e| e.to_string()))
                .transpose()
        })
        .transpose()?;
    let db = open_idea_db(state.inner(), &id).await?;
    let current = db.get_idea_note(&id).await.map_err(|e| e.to_string())?;
    if let Some(next_project_id) = &project_id {
        if current.project_id != *next_project_id {
            return Err("暂不支持跨世界观移动灵感便签，请新建对应项目便签后再转换".to_string());
        }
    }

    db.update_idea_note(
        &id,
        UpdateIdeaNote {
            project_id,
            title,
            content,
            status,
            pinned,
            last_reviewed_at,
            converted_entry_id,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 删除灵感便签
#[tauri::command]
pub async fn db_delete_idea_note(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = open_idea_db(state.inner(), &id).await?;
    db.delete_idea_note(&id).await.map_err(|e| e.to_string())
}
