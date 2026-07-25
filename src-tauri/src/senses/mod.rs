//! 面向不同 AI 会话目的的系统提示词、默认请求与工具白名单。
//!
//! 业务 API 选择相应 Sense 并负责会话生命周期；本模块不执行工具，仅声明模型可见的行为和
//! 能力边界。

pub mod app_sense;
pub mod character_sense;
pub mod contradiction_sense;
pub mod world_check_sense;
