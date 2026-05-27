use anyhow::{Context, Result, anyhow, bail};
use encoding_rs::{GB18030, UTF_16BE, UTF_16LE};

use crate::document_context::{
    DocumentParser, ParseInput, ParsedDocument, split_markdown_into_chunks,
};

const MAX_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;

const PLAIN_TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "toml", "ini",
    "log", "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs", "php",
    "rb", "swift", "kt", "sql", "html", "htm", "css", "scss", "less", "sh", "bat", "ps1", "env",
];

pub struct PlainTextParser;

impl DocumentParser for PlainTextParser {
    fn id(&self) -> &'static str {
        "plain_text"
    }

    fn supports(&self, extension: &str) -> bool {
        PLAIN_TEXT_EXTENSIONS
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(extension))
    }

    fn parse(&self, input: ParseInput) -> Result<ParsedDocument> {
        let metadata = std::fs::metadata(&input.source_path)
            .with_context(|| format!("读取文件信息失败：{}", input.source_path.display()))?;
        if metadata.len() > MAX_TEXT_FILE_BYTES {
            bail!(
                "文本文件超过大小限制：{} MB",
                MAX_TEXT_FILE_BYTES / 1024 / 1024
            );
        }

        let bytes = std::fs::read(&input.source_path)
            .with_context(|| format!("读取文本文件失败：{}", input.source_path.display()))?;
        ensure_probably_text(&bytes)?;

        let plain_text = decode_text_bytes(&bytes)?;
        let markdown = build_markdown(&input.file_name, &input.extension, &plain_text);
        let chunks = split_markdown_into_chunks(&markdown);

        Ok(ParsedDocument {
            parser_id: self.id().to_string(),
            format: input.extension.to_ascii_lowercase(),
            title: Some(input.file_name),
            markdown,
            plain_text,
            chunks,
            warnings: Vec::new(),
        })
    }
}

fn ensure_probably_text(bytes: &[u8]) -> Result<()> {
    if bytes.is_empty() || has_unicode_bom(bytes) || looks_like_utf16_without_bom(bytes) {
        return Ok(());
    }

    let sample_len = bytes.len().min(4096);
    let sample = &bytes[..sample_len];
    let suspicious = sample
        .iter()
        .filter(|byte| matches!(**byte, 0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F))
        .count();

    if suspicious > sample_len / 100 {
        bail!("文件内容看起来不是纯文本");
    }

    Ok(())
}

fn decode_text_bytes(bytes: &[u8]) -> Result<String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec())
            .map_err(|_| anyhow!("UTF-8 BOM 文本解码失败"));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_without_errors(UTF_16LE, &bytes[2..], "UTF-16LE");
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_without_errors(UTF_16BE, &bytes[2..], "UTF-16BE");
    }

    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return Ok(text);
    }

    if looks_like_utf16_without_bom(bytes) {
        if mostly_even_zero(bytes) {
            return decode_without_errors(UTF_16BE, bytes, "UTF-16BE");
        }
        return decode_without_errors(UTF_16LE, bytes, "UTF-16LE");
    }

    let (decoded_gb18030, _, gb18030_errors) = GB18030.decode(bytes);
    if !gb18030_errors {
        return Ok(decoded_gb18030.into_owned());
    }

    Err(anyhow!("文本编码不受支持，请转换为 UTF-8 后重试"))
}

fn decode_without_errors(
    encoding: &'static encoding_rs::Encoding,
    bytes: &[u8],
    label: &str,
) -> Result<String> {
    let (decoded, _, had_errors) = encoding.decode(bytes);
    if had_errors {
        bail!("{} 文本解码失败", label);
    }
    Ok(decoded.into_owned())
}

fn build_markdown(file_name: &str, extension: &str, plain_text: &str) -> String {
    let normalized_extension = extension.trim_start_matches('.').to_ascii_lowercase();
    let content = plain_text.trim();
    if matches!(normalized_extension.as_str(), "md" | "markdown") {
        return format!("# 文件：{}\n\n{}", file_name, content);
    }

    let fence = markdown_fence(content);
    format!(
        "# 文件：{}\n\n{}{}\n{}\n{}\n",
        file_name,
        fence,
        code_fence_language(&normalized_extension),
        content,
        fence,
    )
}

fn markdown_fence(content: &str) -> &'static str {
    if content.contains("```") {
        "````"
    } else {
        "```"
    }
}

fn code_fence_language(extension: &str) -> &str {
    match extension {
        "md" | "markdown" => "markdown",
        "txt" | "log" | "env" => "text",
        "yml" => "yaml",
        "htm" => "html",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "sh" => "bash",
        "ps1" => "powershell",
        "bat" => "bat",
        other => match other {
            "csv" | "tsv" | "json" | "jsonl" | "xml" | "yaml" | "toml" | "ini" | "py" | "rs"
            | "go" | "java" | "c" | "cpp" | "h" | "hpp" | "cs" | "php" | "rb" | "swift" | "kt"
            | "sql" | "html" | "css" | "scss" | "less" => other,
            _ => "text",
        },
    }
}

fn has_unicode_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
        || bytes.starts_with(&[0xFF, 0xFE])
        || bytes.starts_with(&[0xFE, 0xFF])
}

fn looks_like_utf16_without_bom(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    let sample_len = bytes.len().min(4096);
    let sample = &bytes[..sample_len];
    let even_zero = sample.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd_zero = sample
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    let half = sample_len / 2;
    even_zero > half / 3 || odd_zero > half / 3
}

fn mostly_even_zero(bytes: &[u8]) -> bool {
    let sample_len = bytes.len().min(4096);
    let sample = &bytes[..sample_len];
    let even_zero = sample.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd_zero = sample
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    even_zero > odd_zero
}
