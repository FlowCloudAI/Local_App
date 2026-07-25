//! 对话附件的解析、缓存与提示词上下文构建。
//!
//! API 层负责异步任务和事件通知；本模块负责文件格式分发、内容分块及本地缓存，并只向
//! 上层暴露已就绪的附件上下文。

pub mod chunking;
pub mod model;
pub mod parser;
pub mod storage;

pub mod providers;

pub use chunking::split_markdown_into_chunks;
pub use model::{
    DocumentContextBuildResult, DocumentContextItem, DocumentContextStatus, ParsedDocument,
};
pub use parser::{DocumentParser, ParseInput, default_parser_registry};
pub use storage::{
    build_context_markdown, create_pending_items, get_item, list_items, mark_item_parsing,
    reassign_conversation, remove_item, remove_items_for_conversation, save_parse_failure,
    save_parse_success,
};
