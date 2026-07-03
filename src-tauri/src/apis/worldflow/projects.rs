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
    let world_db = open_project_db(state.inner(), &id).await?;
    world_db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    let db = state.inner().sqlite_db.lock().await.clone();
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    let mut world_projects = Vec::with_capacity(projects.len());
    for project in &projects {
        ensure_project_world(state.inner(), &db, project).await?;
        let world_db = open_project_db(state.inner(), &project.id).await?;
        world_projects.push(
            world_db
                .get_project(&project.id)
                .await
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(world_projects)
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
    let description = if description_set.unwrap_or(false) {
        Some(description)
    } else {
        None
    };
    let db = state.inner().sqlite_db.lock().await.clone();
    db.update_project(
        &id,
        UpdateProject {
            name: name.clone(),
            description: description.clone(),
            cover_image: cover_image.clone(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let world_db = open_project_db(state.inner(), &id).await?;
    let project = world_db
        .update_project(
            &id,
            UpdateProject {
                name,
                description,
                cover_image,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    if let Err(error) = state
        .inner()
        .world_store
        .rename_world(project.id, project.name.clone())
        .await
    {
        log::warn!("更新项目对应世界观名称失败: {}", error);
    }
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
