use crate::template::render_global_template;
use flowcloudai_client::llm::types::ChatRequest;
use flowcloudai_client::{ToolRegistry, sense::Sense};
use serde::Serialize;

pub struct AppSense;

impl AppSense {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Serialize)]
struct AppSenseTemplateContext;

impl Sense for AppSense {
    fn prompts(&self) -> Vec<String> {
        if let Some(rendered) = render_global_template("sense/app_system", &AppSenseTemplateContext)
        {
            return vec![rendered];
        }

        vec![
            "你是 FlowCloudAI 桌面应用内的通用创作助手。请优先基于项目资料、词条、标签、关系与用户当前任务来回答。".to_string(),
            "若上下文不足，先指出缺口，再使用可用工具补充；若任务涉及改写或新增内容，请保持设定一致性，并尽量输出可直接落入创作流程的结果。".to_string(),
            "引用项目词条时，除非用户明确要求或结构化字段必须使用，不要直接暴露内部 ID；需要引用具体词条时，优先使用标准 Markdown 链接格式：[词条标题](entry://词条ID)。".to_string(),
        ]
    }

    fn default_request(&self) -> Option<ChatRequest> {
        let mut req = ChatRequest::default();
        req.stream = Some(true);
        req.tool_choice = Some("auto".to_string());
        Some(req)
    }

    fn install_tools(&self, _registry: &mut ToolRegistry) -> anyhow::Result<()> {
        Ok(())
    }
}
