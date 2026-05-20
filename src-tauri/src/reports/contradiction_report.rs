use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

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
