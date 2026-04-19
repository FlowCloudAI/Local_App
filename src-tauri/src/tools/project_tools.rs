use crate::tools;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{arg_str, ToolRegistry};

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
            Box::pin(async move {
                let name = arg_str(args, "name")?;
                let description = args
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let guard = app_state.lock().await;
                let project = tools::create_project(&*guard, name.to_string(), description)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                Ok(format::format_project(&project))
            })
        },
    );

    Ok(())
}

use super::state::WorldflowToolState;
