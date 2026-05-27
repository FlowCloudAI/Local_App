use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::document_context::{
    DocumentContextBuildResult, DocumentContextItem, ParseInput, build_context_markdown,
    create_pending_items, default_parser_registry, get_item, list_items, mark_item_parsing,
    reassign_conversation, remove_item, save_parse_failure, save_parse_success,
};
use crate::{ApiError, PathsState};

const DOCUMENT_CONTEXT_UPDATED: &str = "docctx:updated";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContextUpdatedEvent {
    pub item: DocumentContextItem,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDocumentContextRequest {
    pub conversation_id: String,
    #[serde(default)]
    pub item_ids: Vec<String>,
    pub max_chars: Option<usize>,
}

#[tauri::command]
pub fn docctx_supported_extensions() -> Vec<String> {
    default_parser_registry()
        .supported_extensions()
        .into_iter()
        .map(str::to_string)
        .collect()
}

#[tauri::command]
pub fn docctx_add_files(
    app: AppHandle,
    paths: State<'_, PathsState>,
    conversation_id: Option<String>,
    file_paths: Vec<String>,
) -> Result<Vec<DocumentContextItem>, ApiError> {
    let items = create_pending_items(paths.inner(), conversation_id, file_paths)?;
    for item in items.clone() {
        spawn_parse_item(app.clone(), clone_paths(paths.inner()), item);
    }
    Ok(items)
}

#[tauri::command]
pub fn docctx_list_items(
    paths: State<'_, PathsState>,
    conversation_id: Option<String>,
) -> Result<Vec<DocumentContextItem>, ApiError> {
    list_items(paths.inner(), conversation_id.as_deref()).map_err(ApiError::from)
}

#[tauri::command]
pub fn docctx_remove_item(paths: State<'_, PathsState>, item_id: String) -> Result<(), ApiError> {
    remove_item(paths.inner(), &item_id).map_err(ApiError::from)
}

#[tauri::command]
pub fn docctx_reassign_conversation(
    paths: State<'_, PathsState>,
    from_conversation_id: String,
    to_conversation_id: String,
) -> Result<Vec<DocumentContextItem>, ApiError> {
    reassign_conversation(paths.inner(), &from_conversation_id, &to_conversation_id)
        .map_err(ApiError::from)
}

#[tauri::command]
pub fn docctx_retry_item(
    app: AppHandle,
    paths: State<'_, PathsState>,
    item_id: String,
) -> Result<DocumentContextItem, ApiError> {
    let item = get_item(paths.inner(), &item_id)?;
    spawn_parse_item(app, clone_paths(paths.inner()), item.clone());
    Ok(item)
}

#[tauri::command]
pub fn docctx_build_context(
    paths: State<'_, PathsState>,
    request: BuildDocumentContextRequest,
) -> Result<DocumentContextBuildResult, ApiError> {
    build_context_markdown(
        paths.inner(),
        &request.conversation_id,
        &request.item_ids,
        request.max_chars,
    )
    .map_err(ApiError::from)
}

fn clone_paths(paths: &PathsState) -> PathsState {
    PathsState {
        db_path: paths.db_path.clone(),
        plugins_path: paths.plugins_path.clone(),
    }
}

fn spawn_parse_item(app: AppHandle, paths: PathsState, item: DocumentContextItem) {
    tauri::async_runtime::spawn(async move {
        match mark_item_parsing(&paths, &item.id) {
            Ok(updated) => emit_update(&app, updated),
            Err(error) => {
                log::warn!(
                    "[docctx] 标记解析中失败 item_id={} error={}",
                    item.id,
                    error
                );
            }
        }

        let parse_input = ParseInput {
            source_path: item.source_path.clone().into(),
            file_name: item.file_name.clone(),
            extension: item.extension.clone(),
            max_chars_hint: None,
        };
        let item_id = item.id.clone();
        let parse_result = tauri::async_runtime::spawn_blocking(move || {
            let registry = default_parser_registry();
            registry.parse(parse_input)
        })
        .await;

        let updated = match parse_result {
            Ok(Ok(parsed)) => save_parse_success(&paths, &item_id, &parsed),
            Ok(Err(error)) => save_parse_failure(&paths, &item_id, error),
            Err(error) => {
                save_parse_failure(&paths, &item_id, format!("解析任务异常退出：{}", error))
            }
        };

        match updated {
            Ok(item) => emit_update(&app, item),
            Err(error) => log::warn!(
                "[docctx] 写入解析结果失败 item_id={} error={}",
                item_id,
                error
            ),
        }
    });
}

fn emit_update(app: &AppHandle, item: DocumentContextItem) {
    let _ = app.emit(
        DOCUMENT_CONTEXT_UPDATED,
        DocumentContextUpdatedEvent { item },
    );
}
