use serde::{Deserialize, Serialize};

pub type DeckColor = [u8; 4];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapEditorCanvas {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeVertex {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeDraft {
    pub id: String,
    pub name: String,
    pub vertices: Vec<MapShapeVertex>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biz_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MapShapeKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapKeyLocationDraft {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biz_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapSaveMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<MapProtocolVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario: Option<MapScenario>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persisted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeSaveRequest {
    pub canvas: MapEditorCanvas,
    pub shapes: Vec<MapShapeDraft>,
    pub key_locations: Vec<MapKeyLocationDraft>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<MapSaveMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MapShapeKind {
    Coastline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MapProtocolVersion {
    #[serde(rename = "map_shape_mvp_v1")]
    MapShapeMvpV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MapScenario {
    #[serde(rename = "coastline_mvp")]
    CoastlineMvp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapPreviewShape {
    pub id: String,
    pub name: String,
    pub polygon: Vec<[f64; 2]>,
    pub fill_color: DeckColor,
    pub line_color: DeckColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biz_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MapShapeKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapPreviewKeyLocation {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub position: [f64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<String>,
    pub color: DeckColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biz_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapPreviewScene {
    pub canvas: MapEditorCanvas,
    pub shapes: Vec<MapPreviewShape>,
    pub key_locations: Vec<MapPreviewKeyLocation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeSaveResponse {
    pub scene: MapPreviewScene,
    pub saved_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<MapSaveMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeFieldError {
    pub field: String,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapShapeSaveErrorResponse {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<Vec<MapShapeFieldError>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<serde_json::Value>,
}
