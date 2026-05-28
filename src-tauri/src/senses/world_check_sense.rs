use crate::ai_services::world_check::{WorldCheckDefinition, world_check_tool_whitelist};
use crate::template::render_global_template;
use flowcloudai_client::llm::types::ChatRequest;
use flowcloudai_client::{ToolRegistry, sense::Sense};
use serde::Serialize;

pub struct WorldCheckSense {
    definition: WorldCheckDefinition,
}

impl WorldCheckSense {
    pub fn new(definition: WorldCheckDefinition) -> Self {
        Self { definition }
    }
}

#[derive(Serialize)]
struct WorldCheckSenseTemplateContext<'a> {
    check_kind: &'a str,
    title: &'a str,
    purpose: &'a str,
}

impl Sense for WorldCheckSense {
    fn prompts(&self) -> Vec<String> {
        let context = WorldCheckSenseTemplateContext {
            check_kind: self.definition.kind.as_str(),
            title: self.definition.title,
            purpose: self.definition.purpose,
        };

        if let Some(rendered) = render_global_template(self.definition.system_template, &context) {
            return vec![rendered];
        }

        vec![
            format!("你是 FlowCloudAI 的{}助手。", self.definition.title),
            self.definition.purpose.to_string(),
            "必须优先给出基于原文证据的结论；没有足够证据时，不要硬判定。".to_string(),
            "首轮检测时请严格输出 JSON，不要输出 Markdown、解释文字或代码块标题。".to_string(),
            "在每完成一个阶段的分析后，调用 report_progress 工具向用户报告当前进度。进度汇报应简短，不要替代最终 JSON 输出。".to_string(),
        ]
    }

    fn default_request(&self) -> Option<ChatRequest> {
        let mut req = ChatRequest::default();
        req.stream = Some(true);
        req.temperature = Some(self.definition.default_temperature);
        req.tool_choice = Some("auto".to_string());
        Some(req)
    }

    fn install_tools(&self, _registry: &mut ToolRegistry) -> anyhow::Result<()> {
        Ok(())
    }

    fn tool_whitelist(&self) -> Option<Vec<String>> {
        Some(world_check_tool_whitelist())
    }
}
