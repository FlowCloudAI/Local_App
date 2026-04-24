use super::common::*;

#[tauri::command]
pub async fn db_create_entry_link(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    a_id: String,
    b_id: String,
) -> Result<EntryLink, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let a_id = Uuid::parse_str(&a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(&b_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let link = db
        .create_link(CreateEntryLink {
            project_id,
            a_id,
            b_id,
        })
        .await
        .map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &link.project_id).await?;
    Ok(link)
}

/// 获取词条的出链列表
#[tauri::command]
pub async fn db_list_outgoing_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<Vec<EntryLink>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_outgoing_links(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取词条的入链列表（反向链接）
#[tauri::command]
pub async fn db_list_incoming_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<Vec<EntryLink>, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_incoming_links(&entry_id)
        .await
        .map_err(|e| e.to_string())
}

/// 删除词条的所有出链
#[tauri::command]
pub async fn db_delete_links_from_entry(
    state: State<'_, Arc<Mutex<AppState>>>,
    entry_id: String,
) -> Result<u64, String> {
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let current_entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;
    let deleted = db
        .delete_links_from_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    if deleted > 0 {
        touch_project_updated_at(&db, &current_entry.project_id).await?;
    }
    Ok(deleted)
}

/// 替换词条的所有出链（先删除旧链接，再批量创建新链接）
#[tauri::command]
pub async fn db_replace_outgoing_links(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    entry_id: String,
    linked_entry_ids: Vec<String>,
) -> Result<Vec<EntryLink>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let linked_entry_ids = linked_entry_ids
        .into_iter()
        .map(|id| Uuid::parse_str(&id).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, String>>()?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let links = db
        .replace_outgoing_links(&project_id, &entry_id, &linked_entry_ids)
        .await
        .map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &project_id).await?;
    Ok(links)
}

// ============ Idea Notes ============
