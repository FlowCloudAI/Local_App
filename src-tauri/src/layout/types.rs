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
#[serde(rename_all = "camelCase")]
pub struct LayoutParamsPayload {
    pub collision_padding: Option<f64>,
    pub node_gap: Option<f64>,
    pub collision_passes_per_iteration: Option<usize>,
    pub final_collision_passes: Option<usize>,
    pub edge_clearance_margin: Option<f64>,
    pub edge_clearance_radius_factor: Option<f64>,
    pub edge_clearance_strength: Option<f64>,
    pub edge_clearance_passes: Option<usize>,
    pub edge_length_alpha_rho: Option<f64>,
    pub edge_length_alpha_cv: Option<f64>,
    pub edge_length_min: Option<f64>,
    pub edge_length_max: Option<f64>,
    pub two_way_edge_length_factor: Option<f64>,
    pub two_way_attraction_weight: Option<f64>,
    pub degree_edge_length_scale: Option<f64>,
    pub degree_edge_length_max_factor: Option<f64>,
    pub initial_temperature_gamma: Option<f64>,
    pub min_temperature_gamma: Option<f64>,
    pub min_temperature_ratio: Option<f64>,
    pub iteration_base: Option<f64>,
    pub iteration_sqrt_scale: Option<f64>,
    pub iteration_rho_scale: Option<f64>,
    pub iteration_min: Option<usize>,
    pub iteration_max: Option<usize>,
    pub init_radius_beta_rmax: Option<f64>,
    pub estimated_area_beta_rho: Option<f64>,
    pub estimated_area_beta_cv: Option<f64>,
    pub pathish_edge_length_reduction: Option<f64>,
    pub pathish_init_radius_reduction: Option<f64>,
    pub pathish_axis_compaction_max: Option<f64>,
    pub pathish_radial_pull_max: Option<f64>,
    pub pathish_leaf_pull_max: Option<f64>,
    pub pathish_branch_smoothing_max: Option<f64>,
    pub post_layout_compaction_passes: Option<usize>,
    pub aspect_compaction_trigger: Option<f64>,
    pub aspect_compaction_max: Option<f64>,
    pub early_stop_threshold: Option<f64>,
    pub early_stop_streak: Option<usize>,
    pub component_gap: Option<f64>,
    pub shelf_row_max_width: Option<f64>,
    pub isolated_node_horizontal_gap: Option<f64>,
    pub cluster_box_gap: Option<f64>,
    pub cluster_link_distance_base: Option<f64>,
    pub cluster_repulsion_soft: Option<f64>,
    pub cluster_center_pull: Option<f64>,
    pub cluster_temperature_initial: Option<f64>,
    pub cluster_temperature_decay: Option<f64>,
    pub cluster_iterations: Option<usize>,
    pub cluster_two_way_bonus: Option<f64>,
    pub cluster_horizontal_stretch: Option<f64>,
    pub fixed_random_seed: Option<u64>,
    pub min_distance: Option<f64>,
    pub attractive_direction_salt: Option<u64>,
    pub final_collision_salt: Option<u64>,
    pub collision_direction_salt: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct LayoutRequest {
    #[serde(rename = "nodeOrigin")]
    pub node_origin: Option<[f64; 2]>,
    pub nodes: Vec<LayoutNodeInput>,
    pub edges: Vec<LayoutEdgeInput>,
    pub params: Option<LayoutParamsPayload>,
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
