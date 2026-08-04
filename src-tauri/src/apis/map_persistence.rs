use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// ── 数据模型 ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEntryCanvas {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEntry {
    pub id: String,
    pub name: String,
    pub draft_json: String,
    pub scene_json: Option<String>,
    pub coastline_params_json: Option<String>,
    pub style: String,
    pub canvas: Option<MapEntryCanvas>,
    /// data: URL 或 null
    pub background_image_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMapStore {
    pub project_id: String,
    pub maps: Vec<MapEntry>,
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

fn safe_project_id(project_id: &str) -> String {
    project_id
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn legacy_store_path(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let safe_id = safe_project_id(project_id);
    let paths = app
        .try_state::<crate::PathsState>()
        .ok_or_else(|| "paths state unavailable".to_string())?;
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    let dir = db_dir.join("maps");
    Ok(dir.join(format!("{safe_id}.json")))
}

fn store_path(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let state = app
        .try_state::<Arc<crate::AppState>>()
        .ok_or_else(|| "app state unavailable".to_string())?;
    Ok(state
        .world_store
        .paths(project_id)
        .root_dir
        .join("maps.json"))
}

fn parse_store_content(content: &str, project_id: &str) -> Result<ProjectMapStore, String> {
    // 优先尝试多地图格式
    if let Ok(store) = serde_json::from_str::<ProjectMapStore>(&content) {
        return Ok(store);
    }

    // 旧版单地图格式：{ projectId, draftJson, sceneJson, style, savedAt }
    if let Ok(legacy) = serde_json::from_str::<serde_json::Value>(&content) {
        if legacy.get("draftJson").is_some() {
            let entry = MapEntry {
                id: Uuid::new_v4().to_string(),
                name: "默认地图".to_string(),
                draft_json: legacy["draftJson"]
                    .as_str()
                    .unwrap_or("{\"shapes\":[],\"keyLocations\":[]}")
                    .to_string(),
                scene_json: legacy["sceneJson"].as_str().map(|s| s.to_string()),
                coastline_params_json: None,
                style: legacy["style"].as_str().unwrap_or("flat").to_string(),
                canvas: None,
                background_image_url: None,
                created_at: legacy["savedAt"].as_str().unwrap_or_else(|| "").to_string(),
                updated_at: legacy["savedAt"].as_str().unwrap_or_else(|| "").to_string(),
            };
            return Ok(ProjectMapStore {
                project_id: project_id.to_string(),
                maps: vec![entry],
            });
        }
    }

    Ok(ProjectMapStore {
        project_id: project_id.to_string(),
        maps: vec![],
    })
}

fn load_store(app: &AppHandle, project_id: &str) -> Result<ProjectMapStore, String> {
    let primary_path = store_path(app, project_id)?;
    let legacy_path = legacy_store_path(app, project_id)?;
    let path = if primary_path.exists() {
        Some(primary_path)
    } else if legacy_path.exists() {
        Some(legacy_path)
    } else {
        None
    };

    let Some(path) = path else {
        return Ok(ProjectMapStore {
            project_id: project_id.to_string(),
            maps: vec![],
        });
    };

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_store_content(&content, project_id)
}

fn save_store(app: &AppHandle, store: &ProjectMapStore) -> Result<(), String> {
    let path = store_path(app, &store.project_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;

    // 原子写：maps.json 是该项目地图的唯一副本（未镜像进 SQLite）。
    // 原地 fs::write 会先截断再写，中途崩溃/断电会留下半截文件 → 整项目地图全丢。
    // 改为先写临时文件并 fsync，再 rename 覆盖目标（rename 在同目录内原子）。
    let tmp_path = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })?;
    Ok(())
}

// ── 命令 ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn map_list_project_maps(app: AppHandle, project_id: String) -> Result<Vec<MapEntry>, String> {
    Ok(load_store(&app, &project_id)?.maps)
}

/// 创建或更新地图条目。返回保存后的条目（含自动生成的 id/时间戳）。
#[tauri::command]
pub fn map_save_map_entry(
    app: AppHandle,
    project_id: String,
    entry: MapEntry,
) -> Result<MapEntry, String> {
    let mut store = load_store(&app, &project_id)?;
    let now = Utc::now().to_rfc3339();

    let final_entry = if let Some(pos) = store.maps.iter().position(|m| m.id == entry.id) {
        let mut updated = entry;
        updated.updated_at = now;
        store.maps[pos] = updated.clone();
        updated
    } else {
        let mut new_entry = entry;
        if new_entry.id.is_empty() {
            new_entry.id = Uuid::new_v4().to_string();
        }
        if new_entry.created_at.is_empty() {
            new_entry.created_at = now.clone();
        }
        new_entry.updated_at = now;
        store.maps.push(new_entry.clone());
        new_entry
    };

    save_store(&app, &store)?;
    Ok(final_entry)
}

#[tauri::command]
pub fn map_delete_map_entry(
    app: AppHandle,
    project_id: String,
    map_id: String,
) -> Result<(), String> {
    let mut store = load_store(&app, &project_id)?;
    store.maps.retain(|m| m.id != map_id);
    save_store(&app, &store)
}
