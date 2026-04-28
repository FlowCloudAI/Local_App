use super::common::*;

// ============ Tauri Commands — 本地插件管理 ============

/// 扫描本地已安装的插件
#[tauri::command]
pub async fn plugin_list_local(
    paths: State<'_, PathsState>,
    ai_state: State<'_, AiState>,
) -> Result<Vec<LocalPluginInfo>, String> {
    let images_dir = paths.db_path.parent()
        .map(|p| p.join("images"))
        .unwrap_or_else(|| std::env::temp_dir().join("flowcloudai_images"));
    let client = ai_state.client.lock().await;
    let plugins = client.list_all_plugins();
    let result = plugins
        .iter()
        .map(|meta| {
            let rc = client.get_plugin_ref_count(&meta.id);
            plugin_meta_to_local_info(meta, rc, &images_dir)
        })
        .collect();
    Ok(result)
}

/// 从本地 .fcplug 文件安装插件
#[tauri::command]
pub async fn plugin_install_from_file(
    paths: State<'_, PathsState>,
    ai_state: State<'_, AiState>,
    file_path: String,
) -> Result<LocalPluginInfo, String> {
    require_no_active_sessions(&ai_state).await?;
    let images_dir = paths.db_path.parent()
        .map(|p| p.join("images"))
        .unwrap_or_else(|| std::env::temp_dir().join("flowcloudai_images"));
    let path = PathBuf::from(&file_path);
    let mut client = ai_state.client.lock().await;
    let meta = client
        .install_plugin_from_path(&path)
        .map_err(|e| e.to_string())?;
    let rc = client.get_plugin_ref_count(&meta.id);
    Ok(plugin_meta_to_local_info(&meta, rc, &images_dir))
}

/// 卸载本地插件（同时删除 .fcplug 文件）
#[tauri::command]
pub async fn plugin_uninstall(
    ai_state: State<'_, AiState>,
    plugin_id: String,
) -> Result<(), String> {
    require_no_active_sessions(&ai_state).await?;
    let mut client = ai_state.client.lock().await;
    client
        .uninstall_plugin(&plugin_id)
        .map_err(|e| e.to_string())
}

