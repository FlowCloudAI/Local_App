mod apis;
mod settings;
mod state;

pub use settings::*;
pub use state::*;

use apis::ai_client::*;
use apis::app_settings::*;
use apis::worldflow::*;

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::exit;
use tauri::{AppHandle, Manager, Runtime, WindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log;
use tokio::sync::Mutex;
use worldflow_core::SqliteDb;

/// 运行时设置状态：持有设置值 + 配置文件路径（供保存时使用）
pub struct SettingsState {
    pub settings: Mutex<AppSettings>,
    pub path: PathBuf,
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

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

            // 加载设置
            let settings_path = app_handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap())
                .join("settings.json");

            let settings = AppSettings::load(&settings_path);
            app.manage(SettingsState {
                settings: Mutex::new(settings),
                path: settings_path,
            });

            // 初始化 AI 客户端
            let plugins_path = app_handle
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap())
                .join("plugins");

            match AiState::new(plugins_path) {
                Ok(ai_state) => {
                    app.manage(ai_state);
                }
                Err(e) => log::warn!("AI 客户端初始化失败（无插件）: {}", e),
            }

            // 异步初始化数据库
            let db_path =
                prepare_db_path(&app_handle).unwrap_or_else(|e| fatal(&app_handle, &e.to_string()));

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
                    Err(e) => fatal(&app_handle, &format!("数据库初始化失败: {}", e)),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_message,
            show_main_window,
            // Projects
            db_create_project,
            db_get_project,
            db_list_projects,
            db_update_project,
            db_delete_project,
            // Categories
            db_create_category,
            db_get_category,
            db_list_categories,
            db_update_category,
            db_delete_category,
            // Entries
            db_create_entry,
            db_get_entry,
            db_list_entries,
            db_search_entries,
            db_count_entries,
            db_update_entry,
            db_delete_entry,
            db_create_entries_bulk,
            db_optimize_fts,
            // Tag Schemas
            db_create_tag_schema,
            db_get_tag_schema,
            db_list_tag_schemas,
            db_update_tag_schema,
            db_delete_tag_schema,
            // Entry Relations
            db_create_relation,
            db_get_relation,
            db_list_relations_for_entry,
            db_list_relations_for_project,
            db_update_relation,
            db_delete_relation,
            db_delete_relations_between,
            // AI Client
            ai_list_plugins,
            ai_create_llm_session,
            ai_send_message,
            ai_close_session,
            ai_text_to_image,
            ai_edit_image,
            ai_merge_images,
            ai_speak,
            ai_play_tts,
            // App Settings
            setting_get_settings,
            setting_update_settings,
            setting_get_media_dir,
            setting_set_api_key,
            setting_has_api_key,
            setting_delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── 初始化辅助 ────────────────────────────────────────────────────────────────

async fn init_db(db_path: &Path) -> Result<SqliteDb> {
    if !db_path.exists() {
        std::fs::File::create(db_path).map_err(|e| anyhow::anyhow!("无法创建数据库文件: {}", e))?;
    }
    let path_str = db_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("数据库路径包含非法 UTF-8 字符: {:?}", db_path))?
        .replace('\\', "/");
    log::info!("Connecting to database: {}", path_str);
    SqliteDb::new(&path_str).await.map_err(Into::into)
}

fn prepare_db_path(app: &AppHandle) -> Result<PathBuf> {
    let db_path = app.path().app_data_dir()?.join("db").join("main.db");
    log::info!("Database path: {:?}", db_path);

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
        let test_file = parent.join(".write_test");
        std::fs::write(&test_file, b"test").map_err(|e| anyhow::anyhow!("目录不可写: {}", e))?;
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
