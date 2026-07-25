//! 各文件格式到统一 `DocumentParser` 接口的适配器。
//!
//! 纯文本解析器始终可用；Office 与 PDF 适配器受编译特性控制，并由上层注册表决定是否暴露。

#[cfg(feature = "document-office-oxide")]
pub mod office_oxide;

#[cfg(feature = "document-pdf-extract")]
pub mod pdf_extract;

pub mod plain_text;
