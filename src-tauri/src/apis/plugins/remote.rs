use super::common::*;

// ============ Tauri Commands — 通用远程注册表 ============

/// 从自定义注册表 URL 获取插件列表
#[tauri::command]
pub async fn plugin_fetch_remote(
    net: State<'_, NetworkState>,
    registry_url: String,
) -> Result<Vec<RemotePluginInfo>, String> {
    let resp = net
        .client
        .get(&registry_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    resp.json::<Vec<RemotePluginInfo>>()
        .await
        .map_err(|e| e.to_string())
}

/// 检查已安装插件是否有可用更新（对比自定义注册表）
#[tauri::command]
pub async fn plugin_check_updates(
    ai_state: State<'_, AiState>,
    net: State<'_, NetworkState>,
    registry_url: String,
) -> Result<Vec<PluginUpdateInfo>, String> {
    let remote = plugin_fetch_remote(net, registry_url).await?;
    let remote_map: std::collections::HashMap<_, _> =
        remote.into_iter().map(|p| (p.id, p.version)).collect();

    let client = ai_state.client.lock().await;
    let result = client
        .list_all_plugins()
        .into_iter()
        .filter_map(|meta| {
            let latest = remote_map.get(&meta.id)?;
            Some(PluginUpdateInfo {
                has_update: is_remote_version_newer(&meta.version, latest),
                latest_version: latest.clone(),
                plugin_id: meta.id,
                current_version: meta.version,
            })
        })
        .collect();

    Ok(result)
}

