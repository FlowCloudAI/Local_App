use super::common::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::Manager;

const MAX_APP_LOG_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: &'static str,
    pub form_factor: &'static str,
    pub window_controls: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogSnapshot {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[tauri::command]
pub fn log_message(level: &str, message: &str, source: Option<String>) {
    let message = match source.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(source) => format!("[{source}] {message}"),
        None => message.to_string(),
    };

    match level {
        "info" => log::info!("{message}"),
        "error" => log::error!("{message}"),
        "debug" => log::debug!("{message}"),
        "warn" => log::warn!("{message}"),
        _ => log::debug!("{message}"),
    }
}

/// 读取应用日志末尾内容，移动端用于页面内查看，避免打开私有目录失败。
#[tauri::command]
pub fn read_app_log(app: AppHandle) -> Result<AppLogSnapshot, String> {
    let log_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("app.log");
    let path = log_path.display().to_string();

    if !log_path.exists() {
        return Ok(AppLogSnapshot {
            path,
            content: String::new(),
            truncated: false,
        });
    }

    let mut file = File::open(&log_path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let truncated = len > MAX_APP_LOG_BYTES;

    if truncated {
        file.seek(SeekFrom::Start(len.saturating_sub(MAX_APP_LOG_BYTES)))
            .map_err(|e| e.to_string())?;
    }

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    Ok(AppLogSnapshot {
        path,
        content: String::from_utf8_lossy(&bytes).to_string(),
        truncated,
    })
}

/// 在系统文件管理器中打开指定路径。
/// 走 Rust 端的 OpenerExt，绕过插件 JS-tier 的 scope 校验，
/// 避免 "Not allowed to open path" —— 这些路径全部来自后端配置查询，可信。
#[tauri::command]
pub fn open_in_file_manager(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// 显示主窗口（前端加载完成后调用）
#[tauri::command]
pub fn show_main_window(window: Window) -> Result<&'static str, &'static str> {
    #[cfg(desktop)]
    {
        match window.show() {
            Ok(_) => {}
            Err(_) => return Err("failed to show the window"),
        };
    }
    unsafe {
        env::set_var("TAURI_DEBUG", "1");
    }
    Ok("open the window")
}

/// 退出应用。
/// 移动端不暴露前端 Window API，因此统一走后端 AppHandle 退出。
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// 返回当前运行平台与首轮壳层分流所需的基础能力信息。
#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    };

    let form_factor = if cfg!(target_os = "android") || cfg!(target_os = "ios") {
        "mobile"
    } else {
        "desktop"
    };

    PlatformInfo {
        os,
        form_factor,
        window_controls: form_factor == "desktop",
    }
}
