use super::common::*;

#[tauri::command]
pub async fn db_create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    description: Option<String>,
    cover_image: Option<String>,
    create_default_template: Option<bool>,
) -> Result<Project, String> {
    let db = state.inner().sqlite_db.lock().await;
    let input = CreateProject {
        name,
        description,
        cover_image,
    };
    if create_default_template.unwrap_or(true) {
        db.create_project_with_default_timeline_tags(input).await
    } else {
        db.create_project(input).await
    }
    .map_err(|e| e.to_string())
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    let db = state.inner().sqlite_db.lock().await;
    db.list_projects().await.map_err(|e| e.to_string())
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
    let db = state.inner().sqlite_db.lock().await;
    db.update_project(
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
    .map_err(|e| e.to_string())
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    db.delete_project(&id).await.map_err(|e| e.to_string())
}

// ============ 分类 ============
