use crate::tools;
use crate::tools::confirm::request_confirmation;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{arg_str, ToolRegistry};

/// 注册分类管理工具
pub fn register_category_tools(registry: &mut ToolRegistry) -> Result<()> {
    // ① create_category — 新建分类
    registry.register_async::<WorldflowToolState, _>(
        "create_category",
        "在项目中新建一个分类；可指定上级分类。\
         当 parent_id 不传、传 null、传空字符串，或只包含空白字符时，都会创建为项目根分类。\
         只有在需要挂到某个已有分类下面时，才传入有效的分类 ID。",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("name", "string")
                .required(true)
                .desc("分类名称"),
            ToolFunctionArg::new("parent_id", "string")
                .desc("可选：上级分类ID；不传、传 null、传空字符串都表示创建为项目根分类"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            Box::pin(async move {
                let project_id = arg_str(args, "project_id")?;
                let name = arg_str(args, "name")?;
                let parent_id = args
                    .get("parent_id")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|id| !id.is_empty());

                let guard = app_state.lock().await;
                let category =
                    tools::create_category(&*guard, project_id, name.to_string(), parent_id)
                        .await
                        .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_category(&category))
            })
        },
    );

    // ② delete_category — 删除分类（两种模式）
    registry.register_async::<WorldflowToolState, _>(
        "delete_category",
        "删除指定分类，支持两种模式：\
         move_to_parent（将子分类和词条上移到父分类，安全，单次确认）；\
         cascade（递归删除该分类下所有子分类和词条，不可逆，需二次确认）",
        vec![
            ToolFunctionArg::new("category_id", "string")
                .required(true)
                .desc("要删除的分类ID"),
            ToolFunctionArg::new("mode", "string")
                .required(true)
                .desc("删除模式：move_to_parent（上移内容）或 cascade（联级删除）"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone().unwrap();
            let pending_edits = _state.pending_edits.clone();
            Box::pin(async move {
                let category_id = arg_str(args, "category_id")?;
                let mode = arg_str(args, "mode")?;

                match mode {
                    "move_to_parent" => {
                        // 获取分类信息用于确认展示
                        let cat = {
                            let guard = app_state.lock().await;
                            tools::get_category(&*guard, category_id)
                                .await
                                .map_err(|e| anyhow::anyhow!("{}", e))?
                        };

                        #[derive(serde::Serialize, Clone)]
                        struct CategoryDeleteMovePayload {
                            request_id: String,
                            category_id: String,
                            category_name: String,
                            mode: String,
                        }

                        let cat_id_str = category_id.to_string();
                        let cat_name = cat.name.clone();
                        let confirmed = request_confirmation(
                            &app_handle,
                            &pending_edits,
                            "category:delete-request",
                            |request_id| CategoryDeleteMovePayload {
                                request_id,
                                category_id: cat_id_str.clone(),
                                category_name: cat_name.clone(),
                                mode: "move_to_parent".to_string(),
                            },
                            180,
                        )
                            .await?;

                        if !confirmed {
                            return Ok("用户取消了删除操作".to_string());
                        }

                        let guard = app_state.lock().await;
                        tools::delete_category_move_to_parent(&*guard, category_id)
                            .await
                            .map_err(|e| anyhow::anyhow!("{}", e))?;

                        Ok(format!("分类「{}」已删除，其子内容已上移到父分类", cat.name))
                    }

                    "cascade" => {
                        // 预览阶段：收集将被删除的数量
                        let (entry_count, subcategory_count, cat_name) = {
                            let guard = app_state.lock().await;
                            let cat = tools::get_category(&*guard, category_id)
                                .await
                                .map_err(|e| anyhow::anyhow!("{}", e))?;
                            let (ec, sc) = tools::preview_cascade_delete(&*guard, category_id)
                                .await
                                .map_err(|e| anyhow::anyhow!("{}", e))?;
                            (ec, sc, cat.name.clone())
                        };

                        // 第一次确认：展示影响范围
                        #[derive(serde::Serialize, Clone)]
                        struct CascadePreviewPayload {
                            request_id: String,
                            category_id: String,
                            category_name: String,
                            entry_count: usize,
                            subcategory_count: usize,
                            step: u8,
                        }

                        let cat_id_str = category_id.to_string();
                        let confirmed_preview = request_confirmation(
                            &app_handle,
                            &pending_edits,
                            "category:cascade-delete-request",
                            |request_id| CascadePreviewPayload {
                                request_id,
                                category_id: cat_id_str.clone(),
                                category_name: cat_name.clone(),
                                entry_count,
                                subcategory_count,
                                step: 1,
                            },
                            180,
                        )
                            .await?;

                        if !confirmed_preview {
                            return Ok("用户取消了联级删除操作".to_string());
                        }

                        // 第二次确认：最终确认
                        let confirmed_final = request_confirmation(
                            &app_handle,
                            &pending_edits,
                            "category:cascade-delete-request",
                            |request_id| CascadePreviewPayload {
                                request_id,
                                category_id: cat_id_str.clone(),
                                category_name: cat_name.clone(),
                                entry_count,
                                subcategory_count,
                                step: 2,
                            },
                            180,
                        )
                            .await?;

                        if !confirmed_final {
                            return Ok("用户在二次确认时取消了联级删除操作".to_string());
                        }

                        let guard = app_state.lock().await;
                        let (deleted_entries, deleted_cats) =
                            tools::cascade_delete_category(&*guard, category_id)
                                .await
                                .map_err(|e| anyhow::anyhow!("{}", e))?;

                        Ok(format!(
                            "联级删除完成：已删除分类「{}」及其 {} 个子分类，共 {} 个词条",
                            cat_name, deleted_cats.saturating_sub(1), deleted_entries
                        ))
                    }

                    other => anyhow::bail!(
                        "未知 mode 值: {}，应为 move_to_parent 或 cascade",
                        other
                    ),
                }
            })
        },
    );

    Ok(())
}

use super::state::WorldflowToolState;
