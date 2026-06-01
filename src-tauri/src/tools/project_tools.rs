use crate::tools;
use crate::tools::confirm::request_write_confirmation;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};

/// 注册项目管理工具
pub fn register_project_tools(registry: &mut ToolRegistry) -> Result<()> {
    // ① create_project — 新建项目
    registry.register_async::<WorldflowToolState, _>(
        "create_project",
        "新建一个项目，返回项目ID和基本信息。\
         注意：通过此工具创建的项目不包含默认标签定义，如有需要请通过界面创建或另行调用标签接口",
        vec![
            ToolFunctionArg::new("name", "string")
                .required(true)
                .desc("项目名称"),
            ToolFunctionArg::new("description", "string").desc("项目描述（可选）"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            Box::pin(async move {
                let name = arg_str(args, "name")?;
                let description = args
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let confirmed = request_write_confirmation(
                    app_handle.as_ref(),
                    &pending_edits,
                    "create_project",
                    format!("新建项目：{}", name),
                    description.clone(),
                    vec!["将创建一个新的项目。".to_string()],
                    None,
                )
                .await?;
                if !confirmed {
                    return Ok("用户审核未通过，请停止任务并向用户确认需求".to_string());
                }
                let _project =
                    tools::create_project(app_state.as_ref(), name.to_string(), description)
                        .await
                        .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;

                Ok("修改已完成".to_string())
            })
        },
    );

    Ok(())
}

use super::state::WorldflowToolState;
