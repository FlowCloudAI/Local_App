use std::path::PathBuf;

use anyhow::{Result, anyhow};

use super::model::ParsedDocument;

pub struct ParseInput {
    pub source_path: PathBuf,
    pub file_name: String,
    pub extension: String,
    pub max_chars_hint: Option<usize>,
}

pub trait DocumentParser: Send + Sync {
    fn id(&self) -> &'static str;
    fn supports(&self, extension: &str) -> bool;
    fn parse(&self, input: ParseInput) -> Result<ParsedDocument>;
}

pub struct ParserRegistry {
    parsers: Vec<Box<dyn DocumentParser>>,
}

impl ParserRegistry {
    pub fn new() -> Self {
        Self {
            parsers: Vec::new(),
        }
    }

    pub fn register(&mut self, parser: Box<dyn DocumentParser>) {
        self.parsers.push(parser);
    }

    pub fn parse(&self, input: ParseInput) -> Result<ParsedDocument> {
        let extension = input.extension.to_ascii_lowercase();
        let Some(parser) = self
            .parsers
            .iter()
            .find(|parser| parser.supports(&extension))
        else {
            return Err(anyhow!("当前不支持解析 .{} 文件", extension));
        };

        parser.parse(input)
    }

    pub fn supported_extensions(&self) -> Vec<&'static str> {
        let candidates = [
            "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "toml",
            "ini", "log", "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h",
            "hpp", "cs", "php", "rb", "swift", "kt", "sql", "html", "htm", "css", "scss", "less",
            "sh", "bat", "ps1", "env", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf",
        ];
        candidates
            .into_iter()
            .filter(|extension| self.parsers.iter().any(|parser| parser.supports(extension)))
            .collect()
    }
}

pub fn default_parser_registry() -> ParserRegistry {
    let mut registry = ParserRegistry::new();

    registry.register(Box::new(super::providers::plain_text::PlainTextParser));

    #[cfg(feature = "document-office-oxide")]
    registry.register(Box::new(super::providers::office_oxide::OfficeOxideParser));

    #[cfg(feature = "document-pdf-extract")]
    registry.register(Box::new(super::providers::pdf_extract::PdfExtractParser));

    registry
}
