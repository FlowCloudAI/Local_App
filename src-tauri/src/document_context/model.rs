//! 文档上下文在解析、缓存和提示词构建之间共享的数据模型。
//!
//! 这些类型会持久化为 JSON 并通过 Tauri API 传递，因此字段命名和状态语义须保持兼容。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
/// 附件的异步解析生命周期；只有 `Ready` 项可参与上下文构建。
pub enum DocumentContextStatus {
    Pending,
    Parsing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 已归档附件在索引中的记录。
///
/// 路径均指向按内容哈希复用的本地缓存，不能再假设原始用户路径仍然存在。
pub struct DocumentContextItem {
    pub id: String,
    pub conversation_id: Option<String>,
    pub file_name: String,
    pub source_path: String,
    pub sha256: String,
    pub extension: String,
    pub parser_id: Option<String>,
    pub status: DocumentContextStatus,
    pub markdown_path: Option<String>,
    pub text_path: Option<String>,
    pub chunks_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 可独立排序和截断的文档片段；`char_count` 与上下文字符预算使用相同口径。
pub struct DocumentChunk {
    pub id: String,
    pub heading: Option<String>,
    pub source_ref: Option<String>,
    pub markdown: String,
    pub char_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 单个解析器产出的规范化文本与分块结果。
///
/// 解析器应同时提供 Markdown 和纯文本，存储层才会将项目状态切换为 `Ready`。
pub struct ParsedDocument {
    pub parser_id: String,
    pub format: String,
    pub title: Option<String>,
    pub markdown: String,
    pub plain_text: String,
    pub chunks: Vec<DocumentChunk>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 本轮上下文实际纳入的附件统计，供调用方显示来源和裁剪情况。
pub struct DocumentContextSource {
    pub item_id: String,
    pub file_name: String,
    pub parser_id: Option<String>,
    pub format: Option<String>,
    pub included_chunks: usize,
    pub included_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 可直接嵌入模型请求的附件上下文，以及其来源和预算裁剪状态。
pub struct DocumentContextBuildResult {
    pub markdown: String,
    pub sources: Vec<DocumentContextSource>,
    pub truncated: bool,
}
