use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct LayoutNodeInput {
    pub id: String,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LayoutEdgeKind {
    OneWay,
    TwoWay,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct LayoutEdgeInput {
    pub id: Option<String>,
    pub source: String,
    pub target: String,
    #[serde(rename = "sourceHandle")]
    pub source_handle: Option<String>,
    #[serde(rename = "targetHandle")]
    pub target_handle: Option<String>,
    pub kind: Option<LayoutEdgeKind>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct LayoutRequest {
    #[serde(rename = "nodeOrigin")]
    pub node_origin: Option<[f64; 2]>,
    pub nodes: Vec<LayoutNodeInput>,
    pub edges: Vec<LayoutEdgeInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutResponse {
    pub positions: BTreeMap<String, LayoutPosition>,
    pub bounds: Option<LayoutBounds>,
    #[serde(rename = "layoutHash")]
    pub layout_hash: Option<String>,
}
