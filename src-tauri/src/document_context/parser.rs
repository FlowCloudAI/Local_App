//! 文档解析器的统一接口与按扩展名分发的注册表。
//!
//! 具体格式实现位于 `providers`；可用解析器取决于编译特性，调用方必须通过注册表查询
//! 当前运行时实际支持的扩展名。

use std::path::PathBuf;

use anyhow::{Result, anyhow};

use super::model::ParsedDocument;

/// 交给解析器的文件来源和显示信息。
///
/// `max_chars_hint` 仅是解析器可选的优化提示，不替代后续上下文构建时的硬性字符预算。
pub struct ParseInput {
    pub source_path: PathBuf,
    pub file_name: String,
    pub extension: String,
    pub max_chars_hint: Option<usize>,
}

/// 将一种文件格式规范化为 `ParsedDocument` 的同步解析器。
///
/// 解析在阻塞任务中运行；实现不得依赖调用线程的 Tauri 状态。
pub trait DocumentParser: Send + Sync {
    fn id(&self) -> &'static str;
    fn supports(&self, extension: &str) -> bool;
    fn parse(&self, input: ParseInput) -> Result<ParsedDocument>;
}

/// 按注册顺序选择首个支持目标扩展名的解析器。
pub struct ParserRegistry {
    parsers: Vec<Box<dyn DocumentParser>>,
}

impl ParserRegistry {
    pub fn new() -> Self {
        Self {
            parsers: Vec::new(),
        }
    }

    /// 注册解析器；同一扩展名冲突时先注册的实现优先。
    pub fn register(&mut self, parser: Box<dyn DocumentParser>) {
        self.parsers.push(parser);
    }

    /// 选择匹配扩展名的解析器，不支持的格式在读取文件前失败。
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

    /// 返回当前编译特性下真正可解析的扩展名，而非静态候选清单。
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

/// 构建默认注册表；Office 和 PDF 解析器受可选编译特性控制。
pub fn default_parser_registry() -> ParserRegistry {
    let mut registry = ParserRegistry::new();

    registry.register(Box::new(super::providers::plain_text::PlainTextParser));

    #[cfg(feature = "document-office-oxide")]
    registry.register(Box::new(super::providers::office_oxide::OfficeOxideParser));

    #[cfg(feature = "document-pdf-extract")]
    registry.register(Box::new(super::providers::pdf_extract::PdfExtractParser));

    registry
}
