use super::common::*;

#[tauri::command]
pub fn log_message(level: &str, message: &str) {
    match level {
        "info" => log::info!("{}", message),
        "error" => log::error!("{}", message),
        "debug" => log::debug!("{}", message),
        "warn" => log::warn!("{}", message),
        _ => log::debug!("{}", message),
    }
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
