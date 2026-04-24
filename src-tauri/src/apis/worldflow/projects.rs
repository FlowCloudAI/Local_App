use super::common::*;

#[tauri::command]
pub async fn db_create_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    name: String,
    description: Option<String>,
    cover_image: Option<String>,
) -> Result<Project, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    let project = db.create_project(CreateProject {
        name,
        description,
        cover_image,
    })
        .await
        .map_err(|e| e.to_string())?;

    if let Err(error) = initialize_default_timeline_tags(&db, &project.id).await {
        if let Err(cleanup_error) = db.delete_project(&project.id).await {
            log::error!(
                "[worldflow] 创建项目默认时间线标签失败，且回滚项目失败: project_id={} error={} cleanup_error={}",
                project.id,
                error,
                cleanup_error
            );
            return Err(format!(
                "{}；同时回滚项目失败，请手动检查该项目是否已创建。",
                error
            ));
        }

        return Err(error);
    }

    Ok(project)
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<Project>, String> {
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
}

/// 更新项目信息
#[tauri::command]
pub async fn db_update_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    cover_image: Option<Option<String>>,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.update_project(
        &id,
        UpdateProject {
            name,
            description,
            cover_image,
        },
    )
        .await
        .map_err(|e| e.to_string())
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(
    state: State<'_, Arc<Mutex<AppState>>>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;
    db.delete_project(&id).await.map_err(|e| e.to_string())
}

// ============ Categories ============
