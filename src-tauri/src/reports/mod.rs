//! AI 生成结果在进入 API、持久化和界面前共享的报告模型。
//!
//! 摘要结果保持轻量展示信息；矛盾与通用世界观检测报告则负责约束模型 JSON 和证据可回查性。

pub mod contradiction_report;
pub mod summary_result;
pub mod world_check_report;
