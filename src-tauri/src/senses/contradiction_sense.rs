use flowcloudai_client::llm::types::ChatRequest;
use flowcloudai_client::{sense::Sense, ToolRegistry};

pub struct ContradictionSense;

impl ContradictionSense {
    pub fn new() -> Self {
        Self
    }

    pub fn tool_whitelist() -> Vec<String> {
        [
            "search_entries",
            "get_entry",
            "get_entry_content_by_line",
            "list_all_entries",
            "list_categories",
            "list_entries_by_type",
            "list_tag_schemas",
            "get_entry_relations",
            "get_project_summary",
            "list_projects",
            "list_entry_types",
            "web_search",
            "open_url",
            "report_progress",
        ]
            .into_iter()
            .map(str::to_string)
            .collect()
    }
}

impl Sense for ContradictionSense {
    fn prompts(&self) -> Vec<String> {
        vec![
            "你是 FlowCloudAI 的设定矛盾检测助手。你的任务不是续写，而是基于给定资料找出互相冲突、时间顺序不一致、身份设定不一致、关系链不一致、术语定义冲突等问题。".to_string(),
            "必须优先给出基于原文证据的结论；没有足够证据时，不要硬判定为矛盾，而应放入 unresolvedQuestions。".to_string(),
            "首轮检测时请严格输出 JSON，不要输出 Markdown、解释文字或代码块标题。后续若用户继续追问，可基于同一报告继续讨论。".to_string(),
            "在每完成一个阶段的分析后，调用 report_progress 工具向用户报告当前进度，例如'正在检查角色间的关系矛盾…'、'正在验证时间线一致性…'。这能让用户看到检测仍在进行中。".to_string(),
        ]
    }

    fn default_request(&self) -> Option<ChatRequest> {
        let mut req = ChatRequest::default();
        req.stream = Some(true);
        req.temperature = Some(0.1);
        req.tool_choice = Some("auto".to_string());
        Some(req)
    }

    fn install_tools(&self, _registry: &mut ToolRegistry) -> anyhow::Result<()> {
        Ok(())
    }

    fn tool_whitelist(&self) -> Option<Vec<String>> {
        Some(Self::tool_whitelist())
    }
}
