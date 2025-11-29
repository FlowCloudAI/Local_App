use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            test_command, // 把你的函数名放这里
            show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn test_command() -> Result<String, String> {
    // 模拟业务逻辑
    Ok("Hello from Rust backend!".to_string())
}

#[tauri::command]
fn show_main_window(window: tauri::Window) -> Result<String, String> {
    window.show().unwrap();
    Ok("open the window".to_string())
}
