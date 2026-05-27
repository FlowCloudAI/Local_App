pub mod chunking;
pub mod model;
pub mod parser;
pub mod storage;

pub mod providers;

pub use chunking::split_markdown_into_chunks;
pub use model::{
    DocumentContextBuildResult, DocumentContextItem, DocumentContextSource, DocumentContextStatus,
    DocumentChunk, ParsedDocument,
};
pub use parser::{DocumentParser, ParseInput, ParserRegistry, default_parser_registry};
pub use storage::{
    build_context_markdown, context_root_dir, create_pending_items, get_item, list_items,
    remove_item, save_parse_failure, save_parse_success,
};
