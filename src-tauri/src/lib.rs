mod apis;
mod layout;
mod map;
mod prompt;
mod settings;
mod state;
mod tools;

pub use settings::*;
pub use state::*;

use apis::ai_client::*;
use apis::app_settings::*;
use apis::layout::*;
use apis::map::*;
use apis::plugins::*;
use apis::worldflow::*;
use layout::cache::LayoutCacheState;

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::exit;
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, UriSchemeContext, WindowBuilder,
    http::{Response, StatusCode, header::CONTENT_TYPE},
};
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
        .register_uri_scheme_protocol("fcimg", |ctx, request| handle_fcimg_request(ctx, request))
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
            // 禁用 release 模式下的 WebView 右键菜单
            #[cfg(not(debug_assertions))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.disable_context_menu();
            }

            let app_handle = app.handle().clone();

            // HTTP 客户端（连接池在进程生命周期内共享）
            app.manage(NetworkState::new());
            app.manage(LayoutCacheState::new());

            // 加载设置
            let settings_path = app_handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap())
                .join("settings.json");

            let settings = AppSettings::load(&settings_path);

            // 解析用户自定义路径（在 settings 移入 manage 之前读取）
            let data_root = default_data_root(&app_handle);
            let resolved_db_path = settings
                .db_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_root.join("db"));
            let resolved_plugins_path = settings
                .plugins_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_root.join("plugins"));

            // 搜索引擎状态（供 AI 工具实时读取，随设置更新）
            let search_engine_arc = std::sync::Arc::new(Mutex::new(settings.search_engine.clone()));
            app.manage(SearchEngineState {
                engine: search_engine_arc.clone(),
            });

            app.manage(SettingsState {
                settings: Mutex::new(settings),
                path: settings_path,
            });

            // 异步初始化数据库
            let db_path = prepare_db_path(&app_handle, &resolved_db_path)
                .unwrap_or_else(|e| fatal(&app_handle, &e.to_string()));

            tauri::async_runtime::spawn(async move {
                match init_db(&db_path).await {
                    Ok(db) => {
                        let app_state = Arc::new(Mutex::new(AppState {
                            sqlite_db: Mutex::new(db),
                        }));

                        let app = app_handle.clone();
                        if let Err(e) = app_handle.run_on_main_thread(move || {
                            // 先管理 AppState
                            app.manage(app_state.clone());

                            // 管理路径状态
                            app.manage(PathsState {
                                db_path: db_path.clone(),
                                plugins_path: resolved_plugins_path.clone(),
                            });

                            // 创建待确认编辑请求状态（AI 工具和 confirm command 共享同一个 Arc）
                            let pending_edits = std::sync::Arc::new(tokio::sync::Mutex::new(
                                std::collections::HashMap::<
                                    String,
                                    tokio::sync::oneshot::Sender<bool>,
                                >::new(),
                            ));
                            app.manage(PendingEditsState {
                                pending: pending_edits.clone(),
                            });

                            // 再初始化 AI 客户端（需要 AppState）
                            std::fs::create_dir_all(&resolved_plugins_path).ok();
                            let chats_path = db_path.parent().map(|p| p.join("chats"));
                            match AiState::new(
                                resolved_plugins_path,
                                chats_path,
                                app_state,
                                search_engine_arc,
                                app.clone(),
                                pending_edits,
                            ) {
                                Ok(ai_state) => {
                                    app.manage(ai_state);
                                }
                                Err(e) => log::warn!("AI 客户端初始化失败（无插件）: {}", e),
                            }
                            app.emit("backend-ready", ()).ok();
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
            import_entry_images,
            open_entry_image_path,
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
            // Entry Types
            db_list_all_entry_types,
            db_list_custom_entry_types,
            db_create_entry_type,
            db_get_entry_type,
            db_update_entry_type,
            db_delete_entry_type,
            // Entry Links
            db_create_entry_link,
            db_list_outgoing_links,
            db_list_incoming_links,
            db_delete_links_from_entry,
            db_replace_outgoing_links,
            // AI Client
            ai_list_plugins,
            ai_create_llm_session,
            ai_send_message,
            ai_close_session,
            ai_checkout,
            ai_switch_plugin,
            ai_update_session,
            ai_text_to_image,
            ai_edit_image,
            ai_merge_images,
            ai_speak,
            ai_play_tts,
            ai_enable_tool,
            ai_disable_tool,
            ai_is_enabled,
            ai_list_tools,
            ai_list_conversations,
            ai_get_conversation,
            ai_delete_conversation,
            ai_rename_conversation,
            confirm_entry_edit,
            // App Settings
            setting_get_settings,
            setting_update_settings,
            setting_get_media_dir,
            setting_get_default_paths,
            setting_set_api_key,
            setting_has_api_key,
            setting_delete_api_key,
            // Plugin Management — 本地
            plugin_list_local,
            plugin_install_from_file,
            plugin_uninstall,
            // Plugin Management — 通用注册表
            plugin_fetch_remote,
            plugin_check_updates,
            // Plugin Management — 官方市场
            plugin_market_list,
            plugin_market_install,
            plugin_market_upload,
            plugin_market_update,
            plugin_market_delete,
            map_save_scene,
            compute_layout,
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

fn prepare_db_path(_app: &AppHandle, db_dir: &Path) -> Result<PathBuf> {
    let db_path = db_dir.join("main.db");
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

fn build_fcimg_response(
    status: StatusCode,
    body: Vec<u8>,
    content_type: Option<&str>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder().status(status);
    if let Some(content_type) = content_type {
        builder = builder.header(CONTENT_TYPE, content_type);
    }
    builder.body(body).expect("failed to build fcimg response")
}

fn handle_fcimg_request<R: Runtime>(
    ctx: UriSchemeContext<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(paths) = ctx.app_handle().try_state::<PathsState>() else {
        return build_fcimg_response(
            StatusCode::SERVICE_UNAVAILABLE,
            b"paths state unavailable".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    };

    let raw_uri = request.uri().to_string();
    let encoded_path = request.uri().path().trim_start_matches('/');
    if encoded_path.is_empty() {
        return build_fcimg_response(
            StatusCode::BAD_REQUEST,
            b"missing image path".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    }

    let decoded_path = match urlencoding::decode(encoded_path) {
        Ok(value) => value.into_owned(),
        Err(_) => {
            return build_fcimg_response(
                StatusCode::BAD_REQUEST,
                format!("invalid image path: {}", raw_uri).into_bytes(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let requested_path = PathBuf::from(decoded_path);
    let canonical_requested = match std::fs::canonicalize(&requested_path) {
        Ok(path) => path,
        Err(_) => {
            return build_fcimg_response(
                StatusCode::NOT_FOUND,
                b"image not found".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let Some(db_dir) = paths.db_path.parent() else {
        return build_fcimg_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            b"invalid db path".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    };
    let images_root = db_dir.join("images");
    let canonical_images_root = match std::fs::canonicalize(&images_root) {
        Ok(path) => path,
        Err(_) => {
            return build_fcimg_response(
                StatusCode::NOT_FOUND,
                b"images root not found".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    if !canonical_requested.starts_with(&canonical_images_root) {
        return build_fcimg_response(
            StatusCode::FORBIDDEN,
            b"forbidden".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    }

    let bytes = match std::fs::read(&canonical_requested) {
        Ok(bytes) => bytes,
        Err(_) => {
            return build_fcimg_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                b"failed to read image".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };
    let mime = mime_guess::from_path(&canonical_requested)
        .first_or_octet_stream()
        .to_string();

    build_fcimg_response(StatusCode::OK, bytes, Some(&mime))
}
