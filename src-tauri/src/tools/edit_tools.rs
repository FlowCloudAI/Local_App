use crate::tools;
use crate::tools::confirm::request_confirmation;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{arg_str, ToolRegistry};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

// ── 编辑操作分派枚举 ─────────────────────────────────────────────────────────

enum EditOp {
    EditContentLines {
        entry_id: String,
        start_line: usize,
        end_line: usize,
        new_content: String,
    },
    ReplaceContent {
        entry_id: String,
        new_content: String,
    },
    DeleteEntry {
        entry_id: String,
    },
}

async fn dispatch_edit_op(
    app_state: Arc<Mutex<crate::AppState>>,
    app_handle: AppHandle,
    pending_edits: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    op: EditOp,
) -> anyhow::Result<String> {
    match op {
        EditOp::EditContentLines { entry_id, start_line, end_line, new_content } => {
            if start_line == 0 {
                anyhow::bail!("start_line 必须从 1 开始");
            }
            if end_line + 1 < start_line {
                anyhow::bail!(
                    "end_line ({}) 无效：最小可为 start_line - 1 ({})（纯插入模式）",
                    end_line,
                    start_line - 1
                );
            }

            let (entry_title, before_content) = {
                let guard = app_state.lock().await;
                let entry = tools::get_entry(&*guard, &entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                (entry.title.clone(), entry.content.clone())
            };

            let lines: Vec<&str> = before_content.lines().collect();
            let total = lines.len();
            if start_line > total + 1 {
                anyhow::bail!("start_line ({}) 超出内容行数 ({})", start_line, total);
            }
            let end_clamped = end_line.min(total);

            let mut new_lines: Vec<&str> = Vec::new();
            new_lines.extend_from_slice(&lines[..start_line - 1]);
            if !new_content.is_empty() {
                new_lines.extend(new_content.lines());
            }
            if end_clamped < total {
                new_lines.extend_from_slice(&lines[end_clamped..]);
            }
            let after_content = new_lines.join("\n");

            #[derive(serde::Serialize, Clone)]
            struct Payload {
                request_id: String,
                entry_id: String,
                entry_title: String,
                before_content: String,
                after_content: String,
            }

            let confirmed = request_confirmation(
                &app_handle, &pending_edits, "entry:edit-request",
                |request_id| Payload {
                    request_id,
                    entry_id: entry_id.clone(),
                    entry_title: entry_title.clone(),
                    before_content: before_content.clone(),
                    after_content: after_content.clone(),
                }, 180,
            ).await?;

            if !confirmed {
                return Ok("用户取消了此次编辑，内容未修改".to_string());
            }

            let guard = app_state.lock().await;
            let entry = tools::update_entry_content(&*guard, &entry_id, Some(after_content))
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            #[derive(serde::Serialize, Clone)]
            struct Evt {
                entry_id: String,
            }
            app_handle.emit("entry:updated", Evt { entry_id: entry.id.to_string() })
                .map_err(|e| anyhow::anyhow!("emit 失败: {}", e))?;

            Ok(format::format_entry(&entry))
        }

        EditOp::ReplaceContent { entry_id, new_content } => {
            let (entry_title, before_content) = {
                let guard = app_state.lock().await;
                let entry = tools::get_entry(&*guard, &entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                (entry.title.clone(), entry.content.clone())
            };

            #[derive(serde::Serialize, Clone)]
            struct Payload {
                request_id: String,
                entry_id: String,
                entry_title: String,
                before_content: String,
                after_content: String,
            }

            let after = new_content.clone();
            let confirmed = request_confirmation(
                &app_handle, &pending_edits, "entry:edit-request",
                |request_id| Payload {
                    request_id,
                    entry_id: entry_id.clone(),
                    entry_title: entry_title.clone(),
                    before_content: before_content.clone(),
                    after_content: after.clone(),
                }, 180,
            ).await?;

            if !confirmed {
                return Ok("用户取消了此次编辑，内容未修改".to_string());
            }

            let guard = app_state.lock().await;
            let entry = tools::update_entry_content(&*guard, &entry_id, Some(new_content))
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            #[derive(serde::Serialize, Clone)]
            struct Evt {
                entry_id: String,
            }
            app_handle.emit("entry:updated", Evt { entry_id: entry.id.to_string() })
                .map_err(|e| anyhow::anyhow!("emit 失败: {}", e))?;

            Ok(format::format_entry(&entry))
        }

        EditOp::DeleteEntry { entry_id } => {
            let (entry_title, entry_summary) = {
                let guard = app_state.lock().await;
                let entry = tools::get_entry(&*guard, &entry_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                (entry.title.clone(), entry.summary.clone())
            };

            #[derive(serde::Serialize, Clone)]
            struct Payload {
                request_id: String,
                entry_id: String,
                entry_title: String,
                entry_summary: Option<String>,
            }

            let confirmed = request_confirmation(
                &app_handle, &pending_edits, "entry:delete-request",
                |request_id| Payload {
                    request_id,
                    entry_id: entry_id.clone(),
                    entry_title: entry_title.clone(),
                    entry_summary: entry_summary.clone(),
                }, 180,
            ).await?;

            if !confirmed {
                return Ok("用户取消了删除操作".to_string());
            }

            let guard = app_state.lock().await;
            tools::delete_entry(&*guard, &entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            #[derive(serde::Serialize, Clone)]
            struct Evt {
                entry_id: String,
            }
            app_handle.emit("entry:deleted", Evt { entry_id: entry_id.clone() })
                .map_err(|e| anyhow::anyhow!("emit 失败: {}", e))?;

            Ok(format!("词条「{}」已删除", entry_title))
        }
    }
}

// ── 注册入口 ─────────────────────────────────────────────────────────────────

/// 注册所有需要用户确认的编辑工具
pub fn register_edit_tools(registry: &mut ToolRegistry) -> Result<()> {
    registry.register_async::<WorldflowToolState, _>(
        "edit_entry_content_lines",
        "对词条正文按行进行替换、删除或插入；修改会发送给用户预览，用户确认后才写入。\
         替换：start_line ≤ end_line，new_content 为新内容；\
         删除：start_line ≤ end_line，new_content 为空字符串；\
         在第 N 行前插入：end_line = start_line - 1，new_content 为要插入的内容",
        vec![
            ToolFunctionArg::new("entry_id", "string").required(true).desc("词条ID"),
            ToolFunctionArg::new("start_line", "integer").required(true).desc("起始行号（从 1 开始，含）；插入时表示在该行前插入"),
            ToolFunctionArg::new("end_line", "integer").required(true).desc("结束行号（含）；设为 start_line - 1 表示纯插入（不替换任何行）"),
            ToolFunctionArg::new("new_content", "string").required(true).desc("新内容（支持多行）；空字符串表示删除 start_line 到 end_line 的区间"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone().unwrap();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EditOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let start_line = args.get("start_line").and_then(|v| v.as_u64()).ok_or_else(|| anyhow::anyhow!("缺少或非法参数: start_line"))? as usize;
                let end_line = args.get("end_line").and_then(|v| v.as_u64()).ok_or_else(|| anyhow::anyhow!("缺少或非法参数: end_line"))? as usize;
                let new_content = arg_str(args, "new_content")?.to_string();
                Ok(EditOp::EditContentLines { entry_id, start_line, end_line, new_content })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_edit_op(app_state, app_handle, pending_edits, op))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "replace_entry_content",
        "将词条正文全量替换为新内容；修改会发送给用户预览，用户确认后才写入。\
         适合 AI 生成初稿或大范围重写场景，对比 edit_entry_content_lines 粒度更粗",
        vec![
            ToolFunctionArg::new("entry_id", "string").required(true).desc("词条ID"),
            ToolFunctionArg::new("new_content", "string").required(true).desc("新的完整正文内容，支持 Markdown"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone().unwrap();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EditOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let new_content = arg_str(args, "new_content")?.to_string();
                Ok(EditOp::ReplaceContent { entry_id, new_content })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_edit_op(app_state, app_handle, pending_edits, op))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "delete_entry",
        "删除指定词条；操作不可逆，会发送给用户确认后才执行",
        vec![
            ToolFunctionArg::new("entry_id", "string").required(true).desc("词条ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone().unwrap();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EditOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                Ok(EditOp::DeleteEntry { entry_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_edit_op(app_state, app_handle, pending_edits, op))
        },
    );

    Ok(())
}

use super::state::WorldflowToolState;
