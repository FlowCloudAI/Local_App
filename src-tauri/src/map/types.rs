use serde::{Deserialize, Deserializer, Serialize, de::Visitor};

pub type DeckColor = [u8; 4];

fn deserialize_u64_from_string_or_number<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    struct U64OrString;

    impl<'de> Visitor<'de> for U64OrString {
        type Value = Option<u64>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer or a string representing an integer")
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
            Ok(Some(value as u64))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
            Ok(Some(value))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if let Some(stripped) = trimmed.strip_prefix("0x") {
                u64::from_str_radix(stripped, 16)
                    .map(Some)
                    .map_err(E::custom)
            } else {
                trimmed.parse::<u64>().map(Some).map_err(E::custom)
            }
        }
    }

    deserializer.deserialize_any(U64OrString)
}

/// 海岸线生成参数覆盖。
/// 前端可通过 request.meta.ext 传入，未提供的字段将使用 constants.rs 中的默认值。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoastlineParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_segments: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_segments: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_length_min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_length_max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_length_factor: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_edge_ratio_factor: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amplitude_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amplitude_min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amplitude_canvas_ratio_max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relax_passes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relax_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_relax_passes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_relax_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deduplicate_distance_squared: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_a_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_a_span: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_b_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_b_span: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_c_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_c_span: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_a_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_a_strength: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_b_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_b_strength: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_c_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wave_c_strength: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub noise_salt_a: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub noise_salt_b: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub noise_salt_c: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub hash_text_offset_basis: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub hash_text_prime: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub hash_unit_multiplier: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_u64_from_string_or_number"
    )]
    pub hash_unit_increment: Option<u64>,
}

/// v2 海岸线（全周长弧长参数化算法）生成参数覆盖。
/// 前端通过 request.meta.ext.coastlineV2Params 传入，并以 meta.ext.coastlineAlgorithm == "v2" 选择 v2 算法；
/// 未提供的字段使用 constants.rs 中的 COASTLINE_V2_* 默认值。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoastlineV2Params {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_points: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail_wavelength_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_a_amplitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_b_amplitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_c_amplitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_a_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_b_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_c_weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amplitude_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spectral_beta: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_rounding_px: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concave_corner_factor: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smooth_passes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taubin_lambda: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taubin_mu: Option<f64>,
}

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
