pub(super) use crate::state::PathsState;
pub(super) use crate::{AiState, NetworkState};
pub(super) use flowcloudai_client::plugin::types::PluginMeta;
pub(super) use reqwest::multipart;
pub(super) use semver::Version;
pub(super) use serde::{Deserialize, Serialize};
pub(super) use std::io::Read as _;
pub(super) use std::path::{Path, PathBuf};
pub(super) use tauri::State;
pub(super) use tokio::fs;

// ============ 常量 ============

pub(super) const MARKET_BASE: &str = "https://www.flowcloudai.cn/api/plugins";

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

/// 从 .fcplug（ZIP）中提取 icon.png，复制到 images/plugins/ 目录下，返回本地文件路径。
/// 已存在时直接返回，无 icon.png 时返回 None。
pub(super) fn extract_icon_to_images_dir(
    plugin_id: &str,
    fcplug_path: &Path,
    images_dir: &Path,
) -> Option<String> {
    let plugins_icons_dir = images_dir.join("plugins");
    let icon_path = plugins_icons_dir.join(format!("{}.png", plugin_id));

    if icon_path.exists() {
        return Some(icon_path.to_string_lossy().into_owned());
    }

    let file = std::fs::File::open(fcplug_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name("icon.png").ok()?;

    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;

    std::fs::create_dir_all(&plugins_icons_dir).ok()?;
    std::fs::write(&icon_path, &bytes).ok()?;

    Some(icon_path.to_string_lossy().into_owned())
}

pub(super) fn plugin_meta_to_local_info(
    meta: &PluginMeta,
    ref_count: usize,
    images_dir: &Path,
) -> LocalPluginInfo {
    let kind_str = match meta.kind {
        flowcloudai_client::PluginKind::LLM => "llm",
        flowcloudai_client::PluginKind::Image => "image",
        flowcloudai_client::PluginKind::TTS => "tts",
    };
    let icon_url = extract_icon_to_images_dir(&meta.id, &meta.fcplug_path, images_dir);
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

pub(super) fn parse_semver_like(version: &str) -> Option<Version> {
    let trimmed = version.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(parsed) = Version::parse(trimmed) {
        return Some(parsed);
    }

    let split_at = trimmed.find(['-', '+']).unwrap_or(trimmed.len());
    let (core, suffix) = trimmed.split_at(split_at);
    let mut parts = core.split('.').collect::<Vec<_>>();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    if parts
        .iter()
        .any(|part| part.is_empty() || !part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return None;
    }
    while parts.len() < 3 {
        parts.push("0");
    }

    let normalized = format!("{}{}", parts.join("."), suffix);
    Version::parse(&normalized).ok()
}

pub(super) fn is_remote_version_newer(current: &str, latest: &str) -> bool {
    match (parse_semver_like(current), parse_semver_like(latest)) {
        (Some(current), Some(latest)) => latest > current,
        _ => false,
    }
}

/// 检查当前是否有活跃 AI 会话，有则返回错误（安装/卸载需要独占 plugin_registry）
pub(super) async fn require_no_active_sessions(ai_state: &AiState) -> Result<(), String> {
    let sessions = ai_state.sessions.lock().await;
    if !sessions.is_empty() {
        return Err(format!(
            "请先关闭所有 AI 会话（当前 {} 个）后再操作插件",
            sessions.len()
        ));
    }
    Ok(())
}
