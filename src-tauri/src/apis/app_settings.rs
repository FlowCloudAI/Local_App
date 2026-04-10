use crate::{ApiKeyStore, AppSettings, SettingsState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// 返回平台默认的数据根目录。
/// - Windows：可执行文件所在目录
/// - 其他平台：app_data_dir()
pub(crate) fn default_data_root(app: &AppHandle) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| std::env::current_dir().unwrap())
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap())
    }
}

// ── 设置读写 ──────────────────────────────────────────────────────────────────

/// 读取全部设置；若 db_path/plugins_path 为空则自动填充默认值并保存
#[tauri::command]
pub async fn setting_get_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<AppSettings, String> {
    let mut settings = state.settings.lock().await;

    // 检查是否需要填充默认路径
    let data_root = default_data_root(&app);
    let mut need_save = false;

    if settings.db_path.is_none() {
        settings.db_path = Some(data_root.join("db").to_string_lossy().to_string());
        need_save = true;
    }

    if settings.plugins_path.is_none() {
        settings.plugins_path = Some(data_root.join("plugins").to_string_lossy().to_string());
        need_save = true;
    }

    // 如果填充了默认值，立即保存
    if need_save {
        settings.save(&state.path).map_err(|e| e.to_string())?;
    }

    Ok(settings.clone())
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

/// 获取默认的数据库和插件目录路径
#[derive(serde::Serialize)]
pub struct DefaultPaths {
    pub db_path: String,
    pub plugins_path: String,
}

#[tauri::command]
pub fn setting_get_default_paths(app: AppHandle) -> Result<DefaultPaths, String> {
    let data_root = default_data_root(&app);
    Ok(DefaultPaths {
        db_path: data_root.join("db").to_string_lossy().to_string(),
        plugins_path: data_root.join("plugins").to_string_lossy().to_string(),
    })
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
