use anyhow::Result;

use crate::document_context::{
    DocumentParser, ParseInput, ParsedDocument, split_markdown_into_chunks,
};

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
