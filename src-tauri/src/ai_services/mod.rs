//! AI 服务层：在 API 层与客户端之间收口结构化输出、提示词上下文和检测语料。
//!
//! API 层负责请求生命周期，客户端负责模型会话；本模块不持有会话状态，只提供两者共享的
//! 纯解析、上下文构造与语料加载能力。

pub mod artifact_parser;
pub mod context_builders;
pub mod contradiction_loader;
pub mod world_check;
