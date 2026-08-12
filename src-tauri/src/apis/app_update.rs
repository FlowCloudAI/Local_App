//! 应用更新查询。
//!
//! 桌面端继续使用 Tauri Updater；移动端安装交给 Android 系统，两端共用官网更新日志。

use crate::NetworkState;
use serde::{Deserialize, Serialize};
use tauri::State;

const UPDATE_ENDPOINT: &str = "https://www.flowcloudai.cn/api/v1/app-updates";

#[derive(Debug, Deserialize)]
struct AppUpdateResponse {
    version: String,
    url: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppUpdateChangelogItem {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MobileAppUpdate {
    version: String,
    current_version: String,
    url: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[tauri::command]
pub async fn check_mobile_app_update(
    network: State<'_, NetworkState>,
    current_version: String,
) -> Result<Option<MobileAppUpdate>, String> {
    if !cfg!(target_os = "android") {
        return Ok(None);
    }
    let current_version = current_version.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(current_version).map_err(|_| "当前应用版本无效".to_string())?;
    let response = network
        .client
        .get(format!(
            "{UPDATE_ENDPOINT}/android/universal/{current_version}"
        ))
        .send()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;

    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    let status = response.status();
    if !status.is_success() {
        return Err(format!("检查更新失败：HTTP {status}"));
    }
    let update = response
        .json::<AppUpdateResponse>()
        .await
        .map_err(|error| format!("更新响应格式异常：{error}"))?;

    Ok(Some(MobileAppUpdate {
        version: update.version,
        current_version: current_version.to_string(),
        url: update.url,
        notes: update.notes,
        pub_date: update.pub_date,
    }))
}

#[tauri::command]
pub async fn get_app_update_changelog(
    network: State<'_, NetworkState>,
    target: String,
    arch: String,
    limit: Option<usize>,
) -> Result<Vec<AppUpdateChangelogItem>, String> {
    if !matches!(
        (target.as_str(), arch.as_str()),
        ("windows", "x86_64") | ("android", "universal")
    ) {
        return Err("更新平台参数无效".into());
    }
    let response = network
        .client
        .get(format!(
            "{UPDATE_ENDPOINT}/changelog?target={target}&arch={arch}&limit={}",
            limit.unwrap_or(20).clamp(1, 50)
        ))
        .send()
        .await
        .map_err(|error| format!("获取更新日志失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("获取更新日志失败：HTTP {status}"));
    }
    response
        .json::<Vec<AppUpdateChangelogItem>>()
        .await
        .map_err(|error| format!("更新日志响应格式异常：{error}"))
}
