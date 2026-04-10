use crate::state::PathsState;
use crate::{AiState, NetworkState};
use flowcloudai_client::plugin::types::PluginMeta;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::path::{Path, PathBuf};
use tauri::State;
use tokio::fs;

// ============ 常量 ============

const MARKET_BASE: &str = "https://www.flowcloudai.cn/api/plugins";

// ============ 数据结构 ============

#[derive(Serialize, Clone)]
pub struct LocalPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub kind: String,
    pub path: String,
    pub ref_count: usize,
    /// 本地文件路径，从 .fcplug 内 icon.png 提取并缓存到临时目录，无则 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

/// 与 `GET /api/plugins` 响应字段一一对应
#[derive(Serialize, Deserialize, Clone)]
pub struct RemotePluginInfo {
    pub id: String,
    pub name: String,
    /// "kind/llm" | "kind/image" | "kind/tts"
    pub kind: String,
    pub version: String,
    pub author: String,
    pub abi_version: u32,
    /// 插件对应的 AI 服务 API 端点
    pub url: String,
    pub uploaded_at: String,
    pub updated_at: String,
    /// 插件类型相关的扩展字段（models / voices / supported-sizes 等）
    pub extra: serde_json::Value,
    /// 图标 URL（服务端检测到 icon.png 时填充），无则不出现在 JSON 中
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PluginUpdateInfo {
    pub plugin_id: String,
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
}

// ============ 辅助函数 ============

/// 从 .fcplug（ZIP）中提取 icon.png 到系统临时目录缓存，返回本地文件路径。
/// 已缓存时直接返回，无 icon.png 时返回 None。
fn extract_icon_to_cache(plugin_id: &str, fcplug_path: &Path) -> Option<String> {
    let cache_dir = std::env::temp_dir().join("flowcloudai_icons");
    let icon_path = cache_dir.join(format!("{}.png", plugin_id));

    if icon_path.exists() {
        return Some(icon_path.to_string_lossy().into_owned());
    }

    let file = std::fs::File::open(fcplug_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name("icon.png").ok()?;

    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;

    std::fs::create_dir_all(&cache_dir).ok()?;
    std::fs::write(&icon_path, &bytes).ok()?;

    Some(icon_path.to_string_lossy().into_owned())
}

fn plugin_meta_to_local_info(meta: &PluginMeta, ref_count: usize) -> LocalPluginInfo {
    let kind_str = match meta.kind {
        flowcloudai_client::PluginKind::LLM => "llm",
        flowcloudai_client::PluginKind::Image => "image",
        flowcloudai_client::PluginKind::TTS => "tts",
    };
    let icon_url = extract_icon_to_cache(&meta.id, &meta.fcplug_path);
    LocalPluginInfo {
        id: meta.id.clone(),
        name: meta.name.clone(),
        version: meta.version.clone(),
        description: meta.description.clone(),
        author: meta.author.clone(),
        kind: kind_str.to_string(),
        path: meta.fcplug_path.to_string_lossy().to_string(),
        ref_count,
        icon_url,
    }
}

/// 检查当前是否有活跃 AI 会话，有则返回错误（安装/卸载需要独占 plugin_registry）
async fn require_no_active_sessions(ai_state: &AiState) -> Result<(), String> {
    let sessions = ai_state.sessions.lock().await;
    if !sessions.is_empty() {
        return Err(format!(
            "请先关闭所有 AI 会话（当前 {} 个）后再操作插件",
            sessions.len()
        ));
    }
    Ok(())
}

// ============ 官方市场 HTTP 客户端函数 ============

async fn market_list(client: &reqwest::Client) -> anyhow::Result<serde_json::Value> {
    let res = client.get(MARKET_BASE).send().await?.json().await?;
    Ok(res)
}

async fn market_upload(
    client: &reqwest::Client,
    path: &Path,
    password: &str,
) -> anyhow::Result<serde_json::Value> {
    let bytes = fs::read(path).await?;
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("无效文件名"))?
        .to_string_lossy()
        .to_string();
    let part = multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str("application/octet-stream")?;
    let form = multipart::Form::new()
        .text("password", password.to_string())
        .part("file", part);
    let res = client.post(MARKET_BASE).multipart(form).send().await?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        let msg = if body.trim().is_empty() {
            format!("HTTP {}", status)
        } else {
            format!("HTTP {}: {}", status, body)
        };
        return Err(anyhow::anyhow!(msg));
    }

    Ok(res.json().await?)
}

async fn market_update(
    client: &reqwest::Client,
    id: &str,
    path: &Path,
) -> anyhow::Result<serde_json::Value> {
    let bytes = fs::read(path).await?;
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("无效文件名"))?
        .to_string_lossy()
        .to_string();
    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
    let form = reqwest::multipart::Form::new().part("file", part);
    let res = client
        .put(format!("{}/{}", MARKET_BASE, id))
        .multipart(form)
        .send()
        .await?
        .json()
        .await?;
    Ok(res)
}

async fn market_delete(client: &reqwest::Client, id: &str) -> anyhow::Result<()> {
    client
        .delete(format!("{}/{}", MARKET_BASE, id))
        .send()
        .await?;
    Ok(())
}

async fn market_download(client: &reqwest::Client, id: &str, dest: &Path) -> anyhow::Result<()> {
    let bytes = client
        .get(format!("{}/{}/download", MARKET_BASE, id))
        .send()
        .await?
        .bytes()
        .await?;
    fs::write(dest, bytes).await?;
    Ok(())
}

// ============ Tauri Commands — 本地插件管理 ============

/// 扫描本地已安装的插件
#[tauri::command]
pub async fn plugin_list_local(
    ai_state: State<'_, AiState>,
) -> Result<Vec<LocalPluginInfo>, String> {
    let client = ai_state.client.lock().await;
    let plugins = client.list_all_plugins();
    let result = plugins
        .iter()
        .map(|meta| {
            let rc = client.get_plugin_ref_count(&meta.id);
            plugin_meta_to_local_info(meta, rc)
        })
        .collect();
    Ok(result)
}

/// 从本地 .fcplug 文件安装插件
#[tauri::command]
pub async fn plugin_install_from_file(
    ai_state: State<'_, AiState>,
    file_path: String,
) -> Result<LocalPluginInfo, String> {
    require_no_active_sessions(&ai_state).await?;
    let path = PathBuf::from(&file_path);
    let mut client = ai_state.client.lock().await;
    let meta = client
        .install_plugin_from_path(&path)
        .map_err(|e| e.to_string())?;
    let rc = client.get_plugin_ref_count(&meta.id);
    Ok(plugin_meta_to_local_info(&meta, rc))
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
                has_update: latest != &meta.version,
                latest_version: latest.clone(),
                plugin_id: meta.id,
                current_version: meta.version,
            })
        })
        .collect();

    Ok(result)
}

// ============ Tauri Commands — 官方市场 ============

/// 获取官方市场插件列表
#[tauri::command]
pub async fn plugin_market_list(net: State<'_, NetworkState>) -> Result<serde_json::Value, String> {
    market_list(&net.client).await.map_err(|e| e.to_string())
}

/// 从官方市场下载并安装插件
#[tauri::command]
pub async fn plugin_market_install(
    _paths: State<'_, PathsState>,
    ai_state: State<'_, AiState>,
    net: State<'_, NetworkState>,
    plugin_id: String,
) -> Result<LocalPluginInfo, String> {
    require_no_active_sessions(&ai_state).await?;

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
    Ok(plugin_meta_to_local_info(&meta, rc))
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
