use crate::reports::contradiction_report::{
    ContradictionEvidence, ContradictionIssue, ContradictionReport,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
