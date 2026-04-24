use super::common::*;

#[tauri::command]
pub async fn db_create_idea_note(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: Option<String>,
    content: String,
    title: Option<String>,
    pinned: Option<bool>,
) -> Result<IdeaNote, String> {
    let project_id = project_id
        .map(|pid| Uuid::parse_str(&pid).map_err(|e| e.to_string()))
        .transpose()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
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
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<IdeaNote, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_idea_note(&id).await.map_err(|e| e.to_string())
}

/// 查询灵感便签列表
#[tauri::command]
pub async fn db_list_idea_notes(
    state: State<'_, Arc<Mutex<AppState>>>,
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
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

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
    state: State<'_, Arc<Mutex<AppState>>>,
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
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

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
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.delete_idea_note(&id).await.map_err(|e| e.to_string())
}
