use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentContextStatus {
    Pending,
    Parsing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub struct DocumentChunk {
    pub id: String,
    pub heading: Option<String>,
    pub source_ref: Option<String>,
    pub markdown: String,
    pub char_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub struct DocumentContextBuildResult {
    pub markdown: String,
    pub sources: Vec<DocumentContextSource>,
    pub truncated: bool,
}
