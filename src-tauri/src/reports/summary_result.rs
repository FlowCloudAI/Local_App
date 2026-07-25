//! 项目或词条摘要的轻量结果模型。
//!
//! 摘要正文由上游生成；本文件仅从 Markdown 提取有限的展示要点，不参与事实校验。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 可持久化的摘要正文、来源与展示用要点。
pub struct SummaryResult {
    pub summary_markdown: String,
    pub highlights: Vec<String>,
    pub source_entry_ids: Vec<String>,
    pub warnings: Vec<String>,
}

impl SummaryResult {
    /// 根据 Markdown 摘要生成展示要点。
    ///
    /// 要点只是忽略标题后的前三个非空行，不能将其当作独立生成或结构化解析结果。
    pub fn from_text(
        summary_markdown: String,
        source_entry_ids: Vec<String>,
        warnings: Vec<String>,
    ) -> Self {
        let highlights = summary_markdown
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .filter(|line| !line.starts_with('#'))
            .map(|line| line.trim_start_matches("- ").trim().to_string())
            .take(3)
            .collect();

        Self {
            summary_markdown,
            highlights,
            source_entry_ids,
            warnings,
        }
    }
}
