//! 矛盾检测报告的 JSON 模型与可信度校验。
//!
//! 本文件是模型输出进入持久化和 UI 前的边界：字段必须符合固定契约，且每条证据引用都必须
//! 能在本轮资料或工具返回中回查。

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;

/// 兼容早期模型把概览输出为非字符串 JSON 值的情况。
///
/// 仅 `overview` 保留此兼容入口；其余结构仍由严格形状校验约束。
fn deserialize_overview_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Value::deserialize(deserializer)?;
    match v {
        Value::String(s) => Ok(s),
        other => Ok(other.to_string()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 一段可定位到原始词条的矛盾证据。
pub struct ContradictionEvidence {
    pub entry_id: String,
    pub entry_title: String,
    pub quote: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 单个已确认的世界观矛盾及其支撑证据。
pub struct ContradictionIssue {
    pub issue_id: String,
    pub severity: String,
    pub category: Option<String>,
    pub title: String,
    pub description: String,
    pub related_entry_ids: Vec<String>,
    pub evidence: Vec<ContradictionEvidence>,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 矛盾检测的固定输出契约。
///
/// `issues` 只收录证据充分的问题；信息不足的情况应保留在 `unresolved_questions`，而非伪造结论。
pub struct ContradictionReport {
    #[serde(deserialize_with = "deserialize_overview_string")]
    pub overview: String,
    pub issues: Vec<ContradictionIssue>,
    pub unresolved_questions: Vec<String>,
    pub suggestions: Vec<String>,
}

impl ContradictionReport {
    /// 先拒绝未知字段，再反序列化并验证所有证据引用。
    ///
    /// 严格字段校验避免模型的额外 JSON 被静默丢弃，导致调用方误以为报告完整。
    pub fn from_value_and_validate(value: Value, quote_sources: &[String]) -> Result<Self, String> {
        validate_report_value_shape(&value)?;
        let report: Self = serde_json::from_value(value)
            .map_err(|err| format!("矛盾检测报告字段类型异常：{}", err))?;
        report.validate(quote_sources)?;
        Ok(report)
    }

    /// 验证业务字段、枚举值和证据是否可在本轮输入中回查。
    pub fn validate(&self, quote_sources: &[String]) -> Result<(), String> {
        if self.overview.trim().is_empty() {
            return Err("矛盾检测报告 overview 不能为空".to_string());
        }
        for (index, issue) in self.issues.iter().enumerate() {
            let path = format!("issues[{}]", index);
            validate_non_empty(&issue.issue_id, &format!("{}.issueId", path))?;
            validate_severity(&issue.severity, &format!("{}.severity", path))?;
            validate_category(
                issue.category.as_deref(),
                &[
                    "timeline",
                    "relationship",
                    "geography",
                    "ability",
                    "faction",
                    "other",
                ],
                &format!("{}.category", path),
            )?;
            validate_non_empty(&issue.title, &format!("{}.title", path))?;
            validate_non_empty(&issue.description, &format!("{}.description", path))?;
            if issue.evidence.is_empty() {
                return Err(format!("{}.evidence 至少需要 1 条证据", path));
            }
            for (evidence_index, evidence) in issue.evidence.iter().enumerate() {
                let evidence_path = format!("{}.evidence[{}]", path, evidence_index);
                validate_non_empty(&evidence.entry_id, &format!("{}.entryId", evidence_path))?;
                validate_non_empty(
                    &evidence.entry_title,
                    &format!("{}.entryTitle", evidence_path),
                )?;
                validate_quote(
                    &evidence.quote,
                    quote_sources,
                    &format!("{}.quote", evidence_path),
                )?;
            }
        }
        Ok(())
    }
}

fn validate_report_value_shape(value: &Value) -> Result<(), String> {
    validate_object_keys(
        value,
        "$",
        &["overview", "issues", "unresolvedQuestions", "suggestions"],
    )?;
    let Some(issues) = value.get("issues").and_then(Value::as_array) else {
        return Err("矛盾检测报告 issues 必须是数组".to_string());
    };
    for (index, issue) in issues.iter().enumerate() {
        let path = format!("issues[{}]", index);
        validate_object_keys(
            issue,
            &path,
            &[
                "issueId",
                "severity",
                "category",
                "title",
                "description",
                "relatedEntryIds",
                "evidence",
                "recommendation",
            ],
        )?;
        let Some(evidence_items) = issue.get("evidence").and_then(Value::as_array) else {
            return Err(format!("{}.evidence 必须是数组", path));
        };
        for (evidence_index, evidence) in evidence_items.iter().enumerate() {
            validate_object_keys(
                evidence,
                &format!("{}.evidence[{}]", path, evidence_index),
                &["entryId", "entryTitle", "quote", "note"],
            )?;
        }
    }
    Ok(())
}

fn validate_object_keys(value: &Value, path: &str, allowed: &[&str]) -> Result<(), String> {
    let Some(object) = value.as_object() else {
        return Err(format!("{} 必须是 JSON 对象", path));
    };
    let allowed = allowed.iter().copied().collect::<HashSet<_>>();
    for key in object.keys() {
        if !allowed.contains(key.as_str()) {
            return Err(format!("{} 包含未知字段：{}", path, key));
        }
    }
    Ok(())
}

fn validate_non_empty(value: &str, path: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{} 不能为空", path));
    }
    Ok(())
}

fn validate_severity(value: &str, path: &str) -> Result<(), String> {
    if matches!(value, "low" | "medium" | "high" | "critical") {
        Ok(())
    } else {
        Err(format!(
            "{} 必须是 low、medium、high、critical 之一，实际为 {}",
            path, value
        ))
    }
}

fn validate_category(value: Option<&str>, allowed: &[&str], path: &str) -> Result<(), String> {
    let Some(value) = value else {
        return Err(format!("{} 不能为空", path));
    };
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{} 不在允许范围内：{}", path, value))
    }
}

fn validate_quote(value: &str, sources: &[String], path: &str) -> Result<(), String> {
    let quote = value.trim();
    if quote.is_empty() {
        return Err(format!("{} 不能为空", path));
    }
    let escaped = escape_xml_like_text(quote);
    if sources
        .iter()
        .any(|source| source.contains(quote) || source.contains(&escaped))
    {
        Ok(())
    } else {
        Err(format!(
            "{} 无法在输入资料或工具返回中回查：{}",
            path, quote
        ))
    }
}

fn escape_xml_like_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(ch),
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_contradiction_report_and_quote_source() {
        let value = json!({
            "overview": "发现 1 个问题。",
            "issues": [{
                "issueId": "c-1",
                "severity": "high",
                "category": "timeline",
                "title": "时间冲突",
                "description": "出生年份和事件年份冲突。",
                "relatedEntryIds": ["entry-1"],
                "evidence": [{
                    "entryId": "entry-1",
                    "entryTitle": "角色A",
                    "quote": "出生于 1200 年",
                    "note": null
                }],
                "recommendation": null
            }],
            "unresolvedQuestions": [],
            "suggestions": []
        });

        let sources = vec!["<正文>出生于 1200 年</正文>".to_string()];
        let report = ContradictionReport::from_value_and_validate(value, &sources)
            .expect("合法报告应通过校验");
        assert_eq!(report.issues.len(), 1);
    }

    #[test]
    fn rejects_contradiction_report_with_bad_quote_or_unknown_field() {
        let bad_quote = json!({
            "overview": "发现问题。",
            "issues": [{
                "issueId": "c-1",
                "severity": "high",
                "category": "timeline",
                "title": "时间冲突",
                "description": "描述",
                "relatedEntryIds": ["entry-1"],
                "evidence": [{
                    "entryId": "entry-1",
                    "entryTitle": "角色A",
                    "quote": "资料中不存在",
                    "note": null
                }],
                "recommendation": null
            }],
            "unresolvedQuestions": [],
            "suggestions": []
        });
        let sources = vec!["<正文>出生于 1200 年</正文>".to_string()];
        assert!(ContradictionReport::from_value_and_validate(bad_quote, &sources).is_err());

        let unknown_field = json!({
            "overview": "发现问题。",
            "issues": [],
            "unresolvedQuestions": [],
            "suggestions": [],
            "extra": true
        });
        assert!(ContradictionReport::from_value_and_validate(unknown_field, &sources).is_err());
    }
}
