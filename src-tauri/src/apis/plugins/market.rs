use super::common::*;
use super::market_client::*;

// ============ Tauri Commands — 官方市场 ============

/// 获取官方市场插件列表
#[tauri::command]
pub async fn plugin_market_list(net: State<'_, NetworkState>) -> Result<serde_json::Value, String> {
    market_list(&net.client).await.map_err(|e| e.to_string())
}

/// 从官方市场下载并安装插件
#[tauri::command]
pub async fn plugin_market_install(
    paths: State<'_, PathsState>,
    ai_state: State<'_, AiState>,
    net: State<'_, NetworkState>,
    plugin_id: String,
) -> Result<LocalPluginInfo, String> {
    require_no_active_sessions(&ai_state).await?;

    let images_dir = paths.db_path.parent()
        .map(|p| p.join("images"))
        .unwrap_or_else(|| std::env::temp_dir().join("flowcloudai_images"));

    // 先下载到系统临时目录，再由 install_plugin_from_path 复制到 plugins_dir。
    // 直接下载到 plugins_dir 会导致 Windows 上 src==dst 时 std::fs::copy 报 os error 32。
    let tmp = std::env::temp_dir().join(format!("{}.fcplug", plugin_id));
    market_download(&net.client, &plugin_id, &tmp)
        .await
        .map_err(|e| e.to_string())?;

    let mut client = ai_state.client.lock().await;
    let meta = client
        .install_plugin_from_path(&tmp)
        .map_err(|e| e.to_string())?;

    // 清理临时文件（忽略失败）
    let _ = std::fs::remove_file(&tmp);

    let rc = client.get_plugin_ref_count(&meta.id);
    Ok(plugin_meta_to_local_info(&meta, rc, &images_dir))
}

/// 向官方市场发布新插件（开发者用）
#[tauri::command]
pub async fn plugin_market_upload(
    net: State<'_, NetworkState>,
    file_path: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&file_path);
    market_upload(&net.client, &path, &password)
        .await
        .map_err(|e| e.to_string())
}

/// 更新官方市场上的插件（开发者用）
#[tauri::command]
pub async fn plugin_market_update(
    net: State<'_, NetworkState>,
    plugin_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&file_path);
    market_update(&net.client, &plugin_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// 从官方市场删除插件（开发者用）
#[tauri::command]
pub async fn plugin_market_delete(
    net: State<'_, NetworkState>,
    plugin_id: String,
) -> Result<(), String> {
    market_delete(&net.client, &plugin_id)
        .await
        .map_err(|e| e.to_string())
}
