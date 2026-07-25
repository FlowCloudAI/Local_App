use serde::de::DeserializeOwned;
use serde_json::Value;

/// 从模型回复中提取可交给 JSON 反序列化器的候选内容。
///
/// 这里只处理本服务明确支持的思考标签与 Markdown 围栏；不尝试猜测或修复损坏的 JSON，
/// 以免把模型的解释文字误当成业务数据。
pub fn extract_json_block(raw: &str) -> &str {
    // 剥离 DeepSeek 等模型的思考内容 <think>...</think>
    let stripped = if let Some(pos) = raw.find("</think>") {
        raw[pos + 8..].trim()
    } else {
        raw.trim()
    };
    if let Some(stripped) = stripped.strip_prefix("```json") {
        return stripped
            .trim()
            .strip_suffix("```")
            .map(str::trim)
            .unwrap_or(stripped.trim());
    }
    if let Some(stripped) = stripped.strip_prefix("```") {
        return stripped
            .trim()
            .strip_suffix("```")
            .map(str::trim)
            .unwrap_or(stripped.trim());
    }
    stripped
}

/// 解析模型产出的结构化工件，并将诊断片段限制在前 200 个字符。
///
/// 限制错误回显长度，避免异常响应把大量模型输出继续扩散到日志或前端错误提示中。
pub fn parse_json_artifact<T>(raw: &str) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let candidate = extract_json_block(raw);
    serde_json::from_str(candidate).map_err(|err| {
        format!(
            "AI 结果不是合法 JSON：{}。原始片段前 200 字符：{}",
            err,
            candidate.chars().take(200).collect::<String>()
        )
    })
}

/// 在调用方尚未确定具体工件类型时，保留原始 JSON 值。
pub fn parse_json_value_artifact(raw: &str) -> Result<Value, String> {
    parse_json_artifact(raw)
}
