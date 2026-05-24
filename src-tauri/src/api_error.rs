//! Tauri command 边界使用的结构化错误类型。
//!
//! 字段与 `flowcloudai_client::ClientError` 完全对齐：
//! - `code`：稳定错误码（SCREAMING_SNAKE_CASE 字符串），供前端分支与 i18n
//! - `message`：默认中文展示文案
//! - `detail`：可选附加字段，便于排查
//!
//! 设计目标：
//! 1. Tauri command 返回 `Result<T, ApiError>`，前端 invoke 报错时得到结构化 JSON 对象。
//! 2. 与核心库 [`ClientError`] 无缝互转：内部库错误透传；其它错误用兜底码包装。

use flowcloudai_client::{ClientError, ErrorCode};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub detail: Value,
}

impl ApiError {
    /// 显式构造。`code` 直接使用核心 ErrorCode。
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: code.as_str().to_string(),
            message: message.into(),
            detail: Value::Null,
        }
    }

    /// 兜底构造：归类为 `CORE_CLIENT_INTERNAL_ERROR`。
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::CoreClientInternalError, message)
    }

    /// 附加键值（detail 非对象时自动重建）。
    pub fn with_kv(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        if !self.detail.is_object() {
            self.detail = Value::Object(serde_json::Map::new());
        }
        if let Value::Object(map) = &mut self.detail {
            map.insert(key.into(), value.into());
        }
        self
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // 与 ClientError 一致输出 JSON，便于日志直接 parse。
        let payload = serde_json::json!({
            "code": self.code,
            "message": self.message,
            "detail": self.detail,
        });
        f.write_str(&payload.to_string())
    }
}

impl std::error::Error for ApiError {}

impl From<ClientError> for ApiError {
    fn from(err: ClientError) -> Self {
        Self {
            code: err.code.as_str().to_string(),
            message: err.message,
            detail: err.detail,
        }
    }
}

impl From<&ClientError> for ApiError {
    fn from(err: &ClientError) -> Self {
        Self {
            code: err.code.as_str().to_string(),
            message: err.message.clone(),
            detail: err.detail.clone(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        if let Some(ce) = err.downcast_ref::<ClientError>() {
            return ce.into();
        }
        Self::internal(err.to_string())
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        let code = match err.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::FsOpenFailed,
            std::io::ErrorKind::PermissionDenied => ErrorCode::FsPermissionDenied,
            _ => ErrorCode::FsWriteFailed,
        };
        Self::new(code, err.to_string()).with_kv("io_kind", format!("{:?}", err.kind()))
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(ErrorCode::ValidationFormatError, err.to_string())
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for ApiError {
    fn from(message: &str) -> Self {
        Self::internal(message.to_string())
    }
}
