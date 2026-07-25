//! 基于 `office_oxide` 的 Office 文档解析适配器。
//!
//! 该实现只在启用对应特性时注册，负责转换格式；通用分块仍由 `document_context` 完成。

use anyhow::Result;

use crate::document_context::{
    DocumentParser, ParseInput, ParsedDocument, split_markdown_into_chunks,
};

/// 解析 Word、Excel 和 PowerPoint 的统一适配器。
pub struct OfficeOxideParser;

impl DocumentParser for OfficeOxideParser {
    fn id(&self) -> &'static str {
        "office_oxide"
    }

    fn supports(&self, extension: &str) -> bool {
        matches!(extension, "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx")
    }

    fn parse(&self, input: ParseInput) -> Result<ParsedDocument> {
        let _ = input.max_chars_hint;
        let doc = office_oxide::Document::open(&input.source_path)?;
        let markdown = doc.to_markdown();
        let plain_text = doc.plain_text();
        let chunks = split_markdown_into_chunks(&markdown);

        Ok(ParsedDocument {
            parser_id: self.id().to_string(),
            format: format!("{:?}", doc.format()),
            title: Some(input.file_name),
            markdown,
            plain_text,
            chunks,
            warnings: Vec::new(),
        })
    }
}
