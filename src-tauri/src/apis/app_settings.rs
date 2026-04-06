use crate::{ApiKeyStore, AppSettings, SettingsState};
use tauri::{AppHandle, Manager, State};

// ── 设置读写 ──────────────────────────────────────────────────────────────────

/// 读取全部设置
#[tauri::command]
pub async fn setting_get_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    Ok(state.settings.lock().await.clone())
}

/// 覆盖全部设置并持久化到 settings.json
#[tauri::command]
pub async fn setting_update_settings(
    state: State<'_, SettingsState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    let mut s = state.settings.lock().await;
    *s = new_settings;
    s.save(&state.path).map_err(|e| e.to_string())
}

/// 返回当前生效的媒体根目录（有自定义路径则用它，否则 fallback 到 Documents/FlowCloudAI）
#[tauri::command]
pub async fn setting_get_media_dir(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<String, String> {
    let settings = state.settings.lock().await;

    if let Some(ref dir) = settings.media_dir {
        return Ok(dir.clone());
    }

    // fallback：Documents/FlowCloudAI
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("FlowCloudAI");

    Ok(dir.to_string_lossy().to_string())
}

// ── API Key 管理 ──────────────────────────────────────────────────────────────

/// 将 API Key 存入系统密钥链（不经过任何文件）
#[tauri::command]
pub fn setting_set_api_key(plugin_id: String, api_key: String) -> Result<(), String> {
    ApiKeyStore::set(&plugin_id, &api_key).map_err(|e| e.to_string())
}

/// 检查某插件是否已配置 API Key（不返回明文）
#[tauri::command]
pub fn setting_has_api_key(plugin_id: String) -> bool {
    ApiKeyStore::get(&plugin_id).is_some()
}

/// 从系统密钥链删除 API Key
#[tauri::command]
pub fn setting_delete_api_key(plugin_id: String) -> Result<(), String> {
    ApiKeyStore::delete(&plugin_id).map_err(|e| e.to_string())
}
