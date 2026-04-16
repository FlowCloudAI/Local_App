use crate::tools;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};
use tauri::Emitter;
use tokio::sync::oneshot;

/// 注册编辑确认工具（需要用户预览和确认）
pub fn register_edit_tools(registry: &mut ToolRegistry) -> Result<()> {
    // ⑬ edit_entry_content_lines - 按行编辑词条正文（需用户确认）
    registry.register_async::<WorldflowToolState, _>(
        "edit_entry_content_lines",
        "按行范围替换词条正文中的指定内容；修改会发送给用户预览，用户确认后才写入",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("start_line", "integer")
                .required(true)
                .desc("起始行号（从 1 开始，含）"),
            ToolFunctionArg::new("end_line", "integer")
                .required(true)
                .desc("结束行号（含）；若与 start_line 相同则替换单行"),
            ToolFunctionArg::new("new_content", "string")
                .required(true)
                .desc("替换后的新内容（可以是多行文本，也可以是空字符串表示删除该区间）"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone().unwrap();
            let pending_edits = _state.pending_edits.clone();
            Box::pin(async move {
                let entry_id = arg_str(args, "entry_id")?;
                let start_line = args
                    .get("start_line")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| anyhow::anyhow!("缺少或非法参数: start_line"))?
                    as usize;
                let end_line = args
                    .get("end_line")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| anyhow::anyhow!("缺少或非法参数: end_line"))?
                    as usize;
                let new_content = arg_str(args, "new_content")?;

                if start_line == 0 {
                    anyhow::bail!("start_line 必须从 1 开始");
                }
                if end_line < start_line {
                    anyhow::bail!("end_line 不能小于 start_line");
                }

                // 1. 读取词条当前内容，然后立即释放锁
                let (entry_title, before_content) = {
                    let guard = app_state.lock().await;
                    let entry = tools::get_entry(&*guard, entry_id)
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;
                    (entry.title.clone(), entry.content.clone())
                };

                // 2. 按行切割，验证范围，拼出 after_content
                let lines: Vec<&str> = before_content.lines().collect();
                let total = lines.len();
                if start_line > total + 1 {
                    anyhow::bail!("start_line ({}) 超出内容行数 ({})", start_line, total);
                }
                let end_clamped = end_line.min(total);

                let mut new_lines: Vec<&str> = Vec::new();
                // 保留 start_line 之前的行（0-indexed: 0..start_line-1）
                new_lines.extend_from_slice(&lines[..start_line - 1]);
                // 插入新内容（按行拆分）
                let replacement_lines: Vec<&str> = if new_content.is_empty() {
                    vec![]
                } else {
                    new_content.lines().collect()
                };
                new_lines.extend_from_slice(&replacement_lines);
                // 保留 end_line 之后的行
                if end_clamped < total {
                    new_lines.extend_from_slice(&lines[end_clamped..]);
                }
                let after_content = new_lines.join("\n");

                // 3. 生成唯一 request_id，注册 oneshot channel
                let request_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel::<bool>();
                pending_edits.lock().await.insert(request_id.clone(), tx);

                // 4. 向前端发送预览事件
                #[derive(serde::Serialize, Clone)]
                struct EntryEditRequestPayload {
                    request_id: String,
                    entry_id: String,
                    entry_title: String,
                    before_content: String,
                    after_content: String,
                }
                app_handle
                    .emit(
                        "entry:edit-request",
                        EntryEditRequestPayload {
                            request_id: request_id.clone(),
                            entry_id: entry_id.to_string(),
                            entry_title: entry_title.clone(),
                            before_content: before_content.clone(),
                            after_content: after_content.clone(),
                        },
                    )
                    .map_err(|e| anyhow::anyhow!("emit 失败: {}", e))?;

                // 5. 等待用户确认（最长 180 秒）
                let confirmed =
                    match tokio::time::timeout(std::time::Duration::from_secs(180), rx).await {
                        Ok(Ok(v)) => v,
                        Ok(Err(_)) => {
                            // sender 已被 drop（不应发生）
                            anyhow::bail!("编辑确认通道异常关闭");
                        }
                        Err(_) => {
                            // 超时：清理 map 中的残留 sender
                            pending_edits.lock().await.remove(&request_id);
                            anyhow::bail!("用户未在规定时间内响应，编辑已自动取消");
                        }
                    };

                if !confirmed {
                    return Ok("用户取消了此次编辑，内容未修改".to_string());
                }

                // 6. 写入数据库
                let guard = app_state.lock().await;
                let entry = tools::update_entry_content(&*guard, entry_id, Some(after_content))
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_entry(&entry))
            })
        },
    );

    Ok(())
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
