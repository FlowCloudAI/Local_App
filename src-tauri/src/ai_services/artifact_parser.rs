use serde::de::DeserializeOwned;

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
