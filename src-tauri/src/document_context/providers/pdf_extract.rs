use anyhow::{Context, Result};

use crate::document_context::chunking::split_markdown_into_chunks;

use super::super::model::ParsedDocument;
use super::super::parser::{DocumentParser, ParseInput};

pub struct PdfExtractParser;

impl DocumentParser for PdfExtractParser {
    fn id(&self) -> &'static str {
        "pdf-extract"
    }

    fn supports(&self, extension: &str) -> bool {
        extension.eq_ignore_ascii_case("pdf")
    }

    fn parse(&self, input: ParseInput) -> Result<ParsedDocument> {
        let _ = input.max_chars_hint;
        let text = pdf_extract::extract_text(&input.source_path)
            .with_context(|| format!("PDF 文本提取失败：{}", input.source_path.display()))?;
        let plain_text = text.trim().to_string();
        let markdown = format!("# {}\n\n{}", input.file_name, plain_text);
        let chunks = split_markdown_into_chunks(&markdown);

        Ok(ParsedDocument {
            parser_id: self.id().to_string(),
            format: "pdf".to_string(),
            title: Some(input.file_name),
            markdown,
            plain_text,
            chunks,
            warnings: Vec::new(),
        })
    }
}
