use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

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
pub struct ContradictionEvidence {
    pub entry_id: String,
    pub entry_title: String,
    pub quote: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub struct ContradictionReport {
    #[serde(deserialize_with = "deserialize_overview_string")]
    pub overview: String,
    pub issues: Vec<ContradictionIssue>,
    pub unresolved_questions: Vec<String>,
    pub suggestions: Vec<String>,
}

impl ContradictionReport {
    pub fn from_value_and_validate(value: Value, quote_sources: &[String]) -> Result<Self, String> {
        validate_report_value_shape(&value)?;
        let report: Self = serde_json::from_value(value)
            .map_err(|err| format!("矛盾检测报告字段类型异常：{}", err))?;
        report.validate(quote_sources)?;
        Ok(report)
    }

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

    pub fn response_format_json_schema() -> Value {
        json!({
            "type": "json_schema",
            "json_schema": {
                "name": "contradiction_report",
                "strict": true,
                "schema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["overview", "issues", "unresolvedQuestions", "suggestions"],
                    "properties": {
                        "overview": { "type": "string" },
                        "issues": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                    "issueId",
                                    "severity",
                                    "category",
                                    "title",
                                    "description",
                                    "relatedEntryIds",
                                    "evidence"
                                ],
                                "properties": {
                                    "issueId": { "type": "string" },
                                    "severity": {
                                        "type": "string",
                                        "enum": ["low", "medium", "high", "critical"]
                                    },
                                    "category": {
                                        "type": ["string", "null"],
                                        "enum": ["timeline", "relationship", "geography", "ability", "faction", "other", null]
                                    },
                                    "title": { "type": "string" },
                                    "description": { "type": "string" },
                                    "relatedEntryIds": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    },
                                    "evidence": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": ["entryId", "entryTitle", "quote"],
                                            "properties": {
                                                "entryId": { "type": "string" },
                                                "entryTitle": { "type": "string" },
                                                "quote": { "type": "string" },
                                                "note": { "type": ["string", "null"] }
                                            }
                                        }
                                    },
                                    "recommendation": { "type": ["string", "null"] }
                                }
                            }
                        },
                        "unresolvedQuestions": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "suggestions": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    }
                }
            }
        })
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
