//! 通用世界观检测的参数化 Sense。
//!
//! `WorldCheckDefinition` 提供检测种类、模板和采样参数；本模块将其转为客户端请求，同时
//! 始终复用通用检测工具白名单。

use crate::ai_services::world_check::{WorldCheckDefinition, world_check_tool_whitelist};
use crate::template::render_global_template;
use flowcloudai_client::llm::types::ChatRequest;
use flowcloudai_client::{ToolRegistry, sense::Sense};
use serde::Serialize;

/// 由稳定检测定义驱动的世界观检测会话规则。
pub struct WorldCheckSense {
    definition: WorldCheckDefinition,
}

impl WorldCheckSense {
    /// 绑定本次会话的检测定义；调用方不可在创建后覆盖其模板或默认温度。
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
