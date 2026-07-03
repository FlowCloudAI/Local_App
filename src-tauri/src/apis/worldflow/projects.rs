use super::common::*;

#[tauri::command]
pub async fn db_create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    description: Option<String>,
    cover_image: Option<String>,
    create_default_template: Option<bool>,
) -> Result<Project, String> {
    let db = state.inner().sqlite_db.lock().await.clone();
    let input = CreateProject {
        name,
        description,
        cover_image,
    };
    let project = if create_default_template.unwrap_or(true) {
        db.create_project_with_default_timeline_tags(input).await
    } else {
        db.create_project(input).await
    }
    .map_err(|e| e.to_string())?;
    sync_project_to_world(state.inner(), &db, &project).await?;
    Ok(project)
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await.clone();
    let project = db.get_project(&id).await.map_err(|e| e.to_string())?;
    ensure_project_world(state.inner(), &db, &project).await?;
    Ok(project)
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    let db = state.inner().sqlite_db.lock().await.clone();
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    for project in &projects {
        ensure_project_world(state.inner(), &db, project).await?;
    }
    Ok(projects)
}

/// 更新项目信息
#[tauri::command]
pub async fn db_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    description_set: Option<bool>,
    cover_image: Option<Option<String>>,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await.clone();
    let project = db
        .update_project(
            &id,
            UpdateProject {
                name,
                description: if description_set.unwrap_or(false) {
                    Some(description)
                } else {
                    None
                },
                cover_image,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    sync_project_to_world(state.inner(), &db, &project).await?;
    Ok(project)
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await.clone();
    db.delete_project(&id).await.map_err(|e| e.to_string())?;
    if let Err(error) = state.inner().world_store.delete_world(id).await {
        log::warn!("删除项目对应世界观失败: {}", error);
    }
    Ok(())
}

// ============ 分类 ============

async fn ensure_project_world(
    state: &AppState,
    source_db: &SqliteDb,
    project: &Project,
) -> Result<(), String> {
    if let Ok(world_db) = state.world_store.open_world(project.id).await {
        if world_db.get_project(&project.id).await.is_ok() {
            return Ok(());
        }
    }
    sync_project_to_world(state, source_db, project).await
}

async fn ensure_world_record(state: &AppState, project: &Project) -> Result<(), String> {
    if state.world_store.get_world(project.id).await.is_ok() {
        state
            .world_store
            .rename_world(project.id, project.name.clone())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    state
        .world_store
        .create_world_with_id(project.id, project.name.clone())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn sync_project_to_world(
    state: &AppState,
    source_db: &SqliteDb,
    project: &Project,
) -> Result<(), String> {
    ensure_world_record(state, project).await?;
    let world_db = state
        .world_store
        .open_world(project.id)
        .await
        .map_err(|e| e.to_string())?;
    let export = source_db
        .export_project_csvs(project.id)
        .await
        .map_err(|e| e.to_string())?;
    world_db
        .import_csvs(
            CsvImportBundle::from_export_items(export.items),
            CsvImportMode::Replace,
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
