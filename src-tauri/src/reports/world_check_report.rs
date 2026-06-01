use crate::reports::contradiction_report::{
    ContradictionEvidence, ContradictionIssue, ContradictionReport,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorldCheckKind {
    Contradiction,
    EntryAlignment,
    PublicationRisk,
}

impl WorldCheckKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Contradiction => "contradiction",
            Self::EntryAlignment => "entry_alignment",
            Self::PublicationRisk => "publication_risk",
        }
    }

    fn allowed_categories(self) -> &'static [&'static str] {
        match self {
            Self::Contradiction => &[
                "timeline",
                "relationship",
                "geography",
                "ability",
                "faction",
                "other",
            ],
            Self::EntryAlignment => &[
                "rule_mismatch",
                "timeline_fit",
                "relationship_context",
                "geography_fit",
                "terminology",
                "tone_style",
                "missing_context",
                "other",
            ],
            Self::PublicationRisk => &[
                "copyright_similarity",
                "trademark_brand",
                "real_person_org",
                "defamation_privacy",
                "sensitive_content",
                "age_rating",
                "legal_compliance",
                "platform_policy",
                "other",
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckEvidence {
    pub entry_id: String,
    pub entry_title: String,
    pub quote: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckFinding {
    pub finding_id: String,
    pub severity: String,
    pub category: Option<String>,
    pub title: String,
    pub description: String,
    pub related_entry_ids: Vec<String>,
    pub evidence: Vec<WorldCheckEvidence>,
    pub recommendation: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckReport {
    pub check_kind: WorldCheckKind,
    pub overview: String,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub findings: Vec<WorldCheckFinding>,
    #[serde(default)]
    pub unresolved_questions: Vec<String>,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl WorldCheckReport {
    pub fn from_value_and_validate(
        value: Value,
        expected_kind: WorldCheckKind,
        quote_sources: &[String],
    ) -> Result<Self, String> {
        validate_report_value_shape(&value)?;
        let report: Self = serde_json::from_value(value)
            .map_err(|err| format!("检测报告字段类型异常：{}", err))?;
        report.validate(expected_kind, quote_sources)?;
        Ok(report)
    }

    pub fn validate(
        &self,
        expected_kind: WorldCheckKind,
        quote_sources: &[String],
    ) -> Result<(), String> {
        if self.check_kind != expected_kind {
            return Err(format!(
                "checkKind 应为 {}，实际为 {}",
                expected_kind.as_str(),
                self.check_kind.as_str()
            ));
        }
        if self.overview.trim().is_empty() {
            return Err("检测报告 overview 不能为空".to_string());
        }
        if let Some(score) = self.score
            && !(0.0..=100.0).contains(&score)
        {
            return Err(format!("score 必须在 0-100 之间，实际为 {}", score));
        }
        for (index, finding) in self.findings.iter().enumerate() {
            let path = format!("findings[{}]", index);
            validate_non_empty(&finding.finding_id, &format!("{}.findingId", path))?;
            validate_severity(&finding.severity, &format!("{}.severity", path))?;
            validate_category(
                finding.category.as_deref(),
                self.check_kind.allowed_categories(),
                &format!("{}.category", path),
            )?;
            validate_non_empty(&finding.title, &format!("{}.title", path))?;
            validate_non_empty(&finding.description, &format!("{}.description", path))?;
            if finding.evidence.is_empty() {
                return Err(format!("{}.evidence 至少需要 1 条证据", path));
            }
            for (evidence_index, evidence) in finding.evidence.iter().enumerate() {
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

impl From<ContradictionEvidence> for WorldCheckEvidence {
    fn from(value: ContradictionEvidence) -> Self {
        Self {
            entry_id: value.entry_id,
            entry_title: value.entry_title,
            quote: value.quote,
            note: value.note,
        }
    }
}

impl From<ContradictionIssue> for WorldCheckFinding {
    fn from(value: ContradictionIssue) -> Self {
        Self {
            finding_id: value.issue_id,
            severity: value.severity,
            category: value.category,
            title: value.title,
            description: value.description,
            related_entry_ids: value.related_entry_ids,
            evidence: value.evidence.into_iter().map(Into::into).collect(),
            recommendation: value.recommendation,
            metadata: None,
        }
    }
}

impl From<ContradictionReport> for WorldCheckReport {
    fn from(value: ContradictionReport) -> Self {
        Self {
            check_kind: WorldCheckKind::Contradiction,
            overview: value.overview,
            score: None,
            findings: value.issues.into_iter().map(Into::into).collect(),
            unresolved_questions: value.unresolved_questions,
            suggestions: value.suggestions,
            metadata: None,
        }
    }
}

impl From<&ContradictionReport> for WorldCheckReport {
    fn from(value: &ContradictionReport) -> Self {
        value.clone().into()
    }
}

fn validate_report_value_shape(value: &Value) -> Result<(), String> {
    validate_object_keys(
        value,
        "$",
        &[
            "checkKind",
            "overview",
            "score",
            "findings",
            "unresolvedQuestions",
            "suggestions",
            "metadata",
        ],
    )?;
    let Some(findings) = value.get("findings").and_then(Value::as_array) else {
        return Err("检测报告 findings 必须是数组".to_string());
    };
    for (index, finding) in findings.iter().enumerate() {
        let path = format!("findings[{}]", index);
        validate_object_keys(
            finding,
            &path,
            &[
                "findingId",
                "severity",
                "category",
                "title",
                "description",
                "relatedEntryIds",
                "evidence",
                "recommendation",
                "metadata",
            ],
        )?;
        let Some(evidence_items) = finding.get("evidence").and_then(Value::as_array) else {
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
    fn validates_world_check_report_and_escaped_quote_source() {
        let value = json!({
            "checkKind": "entry_alignment",
            "overview": "目标词条整体契合。",
            "score": 82.0,
            "findings": [{
                "findingId": "a-1",
                "severity": "medium",
                "category": "terminology",
                "title": "术语不一致",
                "description": "目标词条使用了未登记术语。",
                "relatedEntryIds": ["entry-1"],
                "evidence": [{
                    "entryId": "entry-1",
                    "entryTitle": "目标词条",
                    "quote": "A < B",
                    "note": "目标词条原文"
                }],
                "recommendation": "统一术语。",
                "metadata": null
            }],
            "unresolvedQuestions": [],
            "suggestions": [],
            "metadata": null
        });

        let sources = vec!["<正文>A &lt; B</正文>".to_string()];
        let report = WorldCheckReport::from_value_and_validate(
            value,
            WorldCheckKind::EntryAlignment,
            &sources,
        )
        .expect("合法报告应通过校验");
        assert_eq!(report.findings.len(), 1);
    }

    #[test]
    fn rejects_world_check_report_with_wrong_kind_or_category() {
        let value = json!({
            "checkKind": "publication_risk",
            "overview": "存在风险。",
            "score": 10.0,
            "findings": [{
                "findingId": "p-1",
                "severity": "medium",
                "category": "timeline",
                "title": "分类错误",
                "description": "风险报告不应使用 timeline 分类。",
                "relatedEntryIds": ["entry-1"],
                "evidence": [{
                    "entryId": "entry-1",
                    "entryTitle": "词条",
                    "quote": "品牌名",
                    "note": null
                }],
                "recommendation": null,
                "metadata": null
            }],
            "unresolvedQuestions": [],
            "suggestions": [],
            "metadata": null
        });
        let sources = vec!["品牌名".to_string()];

        assert!(
            WorldCheckReport::from_value_and_validate(
                value.clone(),
                WorldCheckKind::EntryAlignment,
                &sources,
            )
            .is_err()
        );
        assert!(
            WorldCheckReport::from_value_and_validate(
                value,
                WorldCheckKind::PublicationRisk,
                &sources,
            )
            .is_err()
        );
    }
}
