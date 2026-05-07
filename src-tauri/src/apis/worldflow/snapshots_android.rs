use super::common::*;

const SNAPSHOT_UNSUPPORTED_MESSAGE: &str = "Android 端暂不支持快照功能";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfoDto {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBranchInfoDto {
    pub name: String,
    pub head: Option<String>,
    pub is_current: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResultDto {
    pub projects: usize,
    pub categories: usize,
    pub entries: usize,
    pub tag_schemas: usize,
    pub relations: usize,
    pub links: usize,
    pub entry_types: usize,
    pub idea_notes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphBranchDto {
    pub name: String,
    pub target: Option<String>,
    pub is_current: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphNodeDto {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub branch_names: Vec<String>,
    pub is_current_head: bool,
    pub is_active_tip: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphDto {
    pub active_branch: String,
    pub branches: Vec<SnapshotGraphBranchDto>,
    pub nodes: Vec<SnapshotGraphNodeDto>,
}

fn snapshot_unsupported<T>() -> Result<T, String> {
    Err(SNAPSHOT_UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub async fn db_snapshot(_state: State<'_, Arc<Mutex<AppState>>>) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_snapshot_with_message(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _message: String,
) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_get_active_branch(
    _state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_branches(
    _state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SnapshotBranchInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_create_branch(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _branch_name: String,
    _from_ref: Option<String>,
) -> Result<(), String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_switch_branch(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _branch_name: String,
) -> Result<(), String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_snapshots(
    _state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_snapshots_in_branch(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _branch_name: String,
) -> Result<Vec<SnapshotInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_get_snapshot_graph(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _paths: State<'_, PathsState>,
) -> Result<SnapshotGraphDto, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_snapshot_to_branch(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _branch_name: String,
    _message: String,
) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_rollback_to(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _snapshot_id: String,
) -> Result<(), String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_append_from(
    _state: State<'_, Arc<Mutex<AppState>>>,
    _snapshot_id: String,
) -> Result<AppendResultDto, String> {
    snapshot_unsupported()
}
