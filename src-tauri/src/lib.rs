mod apis;

use apis::*;

use anyhow::Result;
use std::default::Default;
use std::path::{Path, PathBuf};
use std::process::exit;
use tauri::{AppHandle, Manager, Runtime, WindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log;
use tokio::sync::Mutex;
use worldflow_core::SqliteDb;

pub struct AppState {
    pub sqlite_db: Mutex<SqliteDb>,
}

async fn init_db(db_path: &Path) -> Result<SqliteDb> {
    // sqlx 默认不创建文件，需提前确保文件存在
    if !db_path.exists() {
        std::fs::File::create(db_path)
            .map_err(|e| anyhow::anyhow!("无法创建数据库文件: {}", e))?;
    }
    let path_str = db_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("数据库路径包含非法 UTF-8 字符: {:?}", db_path))?
        .replace('\\', "/");
    log::info!("Connecting to database: {}", path_str);
    SqliteDb::new(&path_str).await.map_err(Into::into)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            log::info!("Single instance detected, quitting.");
            exit(0);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let db_path = prepare_db_path(&app_handle)
                .unwrap_or_else(|e| fatal(&app_handle, &e.to_string()));

            tauri::async_runtime::spawn(async move {
                match init_db(&db_path).await {
                    Ok(db) => {
                        let app = app_handle.clone();

                        if let Err(e) = app_handle.run_on_main_thread(move || {
                            app.manage(AppState {
                                sqlite_db: Mutex::new(db),
                            });
                        }) {
                            log::error!("run_on_main_thread failed: {}", e);
                            fatal(&app_handle, &format!("run_on_main_thread failed: {}", e));
                        }
                    }
                    Err(e) => {
                        fatal(&app_handle, &format!("数据库初始化失败: {}", e));
                    }
                }
            });

            Ok(())
        })
        // 注册api接口
        .invoke_handler(tauri::generate_handler![
            log_message,
            show_main_window,
            // Projects
            api_create_project,
            api_get_project,
            api_list_projects,
            api_update_project,
            api_delete_project,
            // Categories
            api_create_category,
            api_list_categories,
            api_update_category,
            // Entries
            api_create_entry,
            api_get_entry,
            api_list_entries,
            api_search_entries,
            api_count_entries,
            api_create_entries_bulk,
            // Tag Schemas
            api_create_tag_schema,
            api_get_tag_schema,
            api_list_tag_schemas,
            api_update_tag_schema,
            api_delete_tag_schema,
        ])
        // 运行
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("Tauri App Started");
}

fn prepare_db_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    let db_path = dir.join("db").join("main.db");
    log::info!("Database path: {:?}", db_path);

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
        // 测试写入权限
        let test_file = parent.join(".write_test");
        if let Err(e) = std::fs::write(&test_file, b"test") {
            log::error!("Write test failed: {}", e);
            return Err(anyhow::anyhow!("目录不可写: {}", e));
        }
        let _ = std::fs::remove_file(test_file);
    }

    Ok(db_path)
}

fn fatal<R: Runtime, M: Manager<R>>(manager: &M, msg: &str) -> ! {
    if let Some(w) = manager.get_window("main") {
        let _ = w.dialog().message(msg).blocking_show();
    } else {
        let _ = WindowBuilder::new(manager, "error_dialog")
            .build()
            .map(|w| w.dialog().message(msg).blocking_show());
    }

    exit(1);
}