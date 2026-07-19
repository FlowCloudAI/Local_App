use crate::layout::constants::*;
use crate::layout::types::LayoutParamsPayload;

#[derive(Debug, Clone)]
pub struct ResolvedLayoutParams {
    pub collision_padding: f64,
    pub node_gap: f64,
    pub collision_passes_per_iteration: usize,
    pub final_collision_passes: usize,
    pub edge_clearance_margin: f64,
    pub edge_clearance_radius_factor: f64,
    pub edge_clearance_strength: f64,
    pub edge_clearance_passes: usize,
    pub edge_length_alpha_rho: f64,
    pub edge_length_alpha_cv: f64,
    pub edge_length_min: f64,
    pub edge_length_max: f64,
    pub two_way_edge_length_factor: f64,
    pub two_way_attraction_weight: f64,
    pub degree_edge_length_scale: f64,
    pub degree_edge_length_max_factor: f64,
    pub initial_temperature_gamma: f64,
    pub min_temperature_gamma: f64,
    pub min_temperature_ratio: f64,
    pub iteration_base: f64,
    pub iteration_sqrt_scale: f64,
    pub iteration_rho_scale: f64,
    pub iteration_min: usize,
    pub iteration_max: usize,
    pub init_radius_beta_rmax: f64,
    pub estimated_area_beta_rho: f64,
    pub estimated_area_beta_cv: f64,
    pub pathish_edge_length_reduction: f64,
    pub pathish_init_radius_reduction: f64,
    pub pathish_axis_compaction_max: f64,
    pub pathish_radial_pull_max: f64,
    pub pathish_leaf_pull_max: f64,
    pub pathish_branch_smoothing_max: f64,
    pub post_layout_compaction_passes: usize,
    pub aspect_compaction_trigger: f64,
    pub aspect_compaction_max: f64,
    pub early_stop_threshold: f64,
    pub early_stop_streak: usize,
    pub component_gap: f64,
    pub shelf_row_max_width: f64,
    pub isolated_node_horizontal_gap: f64,
    pub cluster_box_gap: f64,
    pub cluster_link_distance_base: f64,
    pub cluster_repulsion_soft: f64,
    pub cluster_center_pull: f64,
    pub cluster_temperature_initial: f64,
    pub cluster_temperature_decay: f64,
    pub cluster_iterations: usize,
    pub cluster_two_way_bonus: f64,
    pub cluster_horizontal_stretch: f64,
    pub fixed_random_seed: u64,
    pub min_distance: f64,
    pub attractive_direction_salt: u64,
    pub final_collision_salt: u64,
    pub collision_direction_salt: u64,
    pub edge_clearance_salt: u64,
    pub temperature_decay_min: f64,
    pub temperature_decay_max: f64,
    pub gravity_strength: f64,
}

impl ResolvedLayoutParams {
    pub fn from_payload(payload: Option<LayoutParamsPayload>) -> Self {
        let p = payload;
        Self {
            collision_padding: p
                .as_ref()
                .and_then(|x| x.collision_padding)
                .unwrap_or(COLLISION_PADDING),
            node_gap: p.as_ref().and_then(|x| x.node_gap).unwrap_or(NODE_GAP),
            collision_passes_per_iteration: p
                .as_ref()
                .and_then(|x| x.collision_passes_per_iteration)
                .unwrap_or(COLLISION_PASSES_PER_ITERATION),
            final_collision_passes: p
                .as_ref()
                .and_then(|x| x.final_collision_passes)
                .unwrap_or(FINAL_COLLISION_PASSES),
            edge_clearance_margin: p
                .as_ref()
                .and_then(|x| x.edge_clearance_margin)
                .unwrap_or(EDGE_CLEARANCE_MARGIN),
            edge_clearance_radius_factor: p
                .as_ref()
                .and_then(|x| x.edge_clearance_radius_factor)
                .unwrap_or(EDGE_CLEARANCE_RADIUS_FACTOR),
            edge_clearance_strength: p
                .as_ref()
                .and_then(|x| x.edge_clearance_strength)
                .unwrap_or(EDGE_CLEARANCE_STRENGTH),
            edge_clearance_passes: p
                .as_ref()
                .and_then(|x| x.edge_clearance_passes)
                .unwrap_or(EDGE_CLEARANCE_PASSES),
            edge_length_alpha_rho: p
                .as_ref()
                .and_then(|x| x.edge_length_alpha_rho)
                .unwrap_or(EDGE_LENGTH_ALPHA_RHO),
            edge_length_alpha_cv: p
                .as_ref()
                .and_then(|x| x.edge_length_alpha_cv)
                .unwrap_or(EDGE_LENGTH_ALPHA_CV),
            edge_length_min: p
                .as_ref()
                .and_then(|x| x.edge_length_min)
                .unwrap_or(EDGE_LENGTH_MIN),
            edge_length_max: p
                .as_ref()
                .and_then(|x| x.edge_length_max)
                .unwrap_or(EDGE_LENGTH_MAX),
            two_way_edge_length_factor: p
                .as_ref()
                .and_then(|x| x.two_way_edge_length_factor)
                .unwrap_or(TWO_WAY_EDGE_LENGTH_FACTOR),
            two_way_attraction_weight: p
                .as_ref()
                .and_then(|x| x.two_way_attraction_weight)
                .unwrap_or(TWO_WAY_ATTRACTION_WEIGHT),
            degree_edge_length_scale: p
                .as_ref()
                .and_then(|x| x.degree_edge_length_scale)
                .unwrap_or(DEGREE_EDGE_LENGTH_SCALE),
            degree_edge_length_max_factor: p
                .as_ref()
                .and_then(|x| x.degree_edge_length_max_factor)
                .unwrap_or(DEGREE_EDGE_LENGTH_MAX_FACTOR),
            initial_temperature_gamma: p
                .as_ref()
                .and_then(|x| x.initial_temperature_gamma)
                .unwrap_or(INITIAL_TEMPERATURE_GAMMA),
            min_temperature_gamma: p
                .as_ref()
                .and_then(|x| x.min_temperature_gamma)
                .unwrap_or(MIN_TEMPERATURE_GAMMA),
            min_temperature_ratio: p
                .as_ref()
                .and_then(|x| x.min_temperature_ratio)
                .unwrap_or(MIN_TEMPERATURE_RATIO),
            iteration_base: p
                .as_ref()
                .and_then(|x| x.iteration_base)
                .unwrap_or(ITERATION_BASE),
            iteration_sqrt_scale: p
                .as_ref()
                .and_then(|x| x.iteration_sqrt_scale)
                .unwrap_or(ITERATION_SQRT_SCALE),
            iteration_rho_scale: p
                .as_ref()
                .and_then(|x| x.iteration_rho_scale)
                .unwrap_or(ITERATION_RHO_SCALE),
            iteration_min: p
                .as_ref()
                .and_then(|x| x.iteration_min)
                .unwrap_or(ITERATION_MIN),
            iteration_max: p
                .as_ref()
                .and_then(|x| x.iteration_max)
                .unwrap_or(ITERATION_MAX),
            init_radius_beta_rmax: p
                .as_ref()
                .and_then(|x| x.init_radius_beta_rmax)
                .unwrap_or(INIT_RADIUS_BETA_RMAX),
            estimated_area_beta_rho: p
                .as_ref()
                .and_then(|x| x.estimated_area_beta_rho)
                .unwrap_or(ESTIMATED_AREA_BETA_RHO),
            estimated_area_beta_cv: p
                .as_ref()
                .and_then(|x| x.estimated_area_beta_cv)
                .unwrap_or(ESTIMATED_AREA_BETA_CV),
            pathish_edge_length_reduction: p
                .as_ref()
                .and_then(|x| x.pathish_edge_length_reduction)
                .unwrap_or(PATHISH_EDGE_LENGTH_REDUCTION),
            pathish_init_radius_reduction: p
                .as_ref()
                .and_then(|x| x.pathish_init_radius_reduction)
                .unwrap_or(PATHISH_INIT_RADIUS_REDUCTION),
            pathish_axis_compaction_max: p
                .as_ref()
                .and_then(|x| x.pathish_axis_compaction_max)
                .unwrap_or(PATHISH_AXIS_COMPACTION_MAX),
            pathish_radial_pull_max: p
                .as_ref()
                .and_then(|x| x.pathish_radial_pull_max)
                .unwrap_or(PATHISH_RADIAL_PULL_MAX),
            pathish_leaf_pull_max: p
                .as_ref()
                .and_then(|x| x.pathish_leaf_pull_max)
                .unwrap_or(PATHISH_LEAF_PULL_MAX),
            pathish_branch_smoothing_max: p
                .as_ref()
                .and_then(|x| x.pathish_branch_smoothing_max)
                .unwrap_or(PATHISH_BRANCH_SMOOTHING_MAX),
            post_layout_compaction_passes: p
                .as_ref()
                .and_then(|x| x.post_layout_compaction_passes)
                .unwrap_or(POST_LAYOUT_COMPACTION_PASSES),
            aspect_compaction_trigger: p
                .as_ref()
                .and_then(|x| x.aspect_compaction_trigger)
                .unwrap_or(ASPECT_COMPACTION_TRIGGER),
            aspect_compaction_max: p
                .as_ref()
                .and_then(|x| x.aspect_compaction_max)
                .unwrap_or(ASPECT_COMPACTION_MAX),
            early_stop_threshold: p
                .as_ref()
                .and_then(|x| x.early_stop_threshold)
                .unwrap_or(EARLY_STOP_THRESHOLD),
            early_stop_streak: p
                .as_ref()
                .and_then(|x| x.early_stop_streak)
                .unwrap_or(EARLY_STOP_STREAK),
            component_gap: p
                .as_ref()
                .and_then(|x| x.component_gap)
                .unwrap_or(COMPONENT_GAP),
            shelf_row_max_width: p
                .as_ref()
                .and_then(|x| x.shelf_row_max_width)
                .unwrap_or(SHELF_ROW_MAX_WIDTH),
            isolated_node_horizontal_gap: p
                .as_ref()
                .and_then(|x| x.isolated_node_horizontal_gap)
                .unwrap_or(ISOLATED_NODE_HORIZONTAL_GAP),
            cluster_box_gap: p
                .as_ref()
                .and_then(|x| x.cluster_box_gap)
                .unwrap_or(CLUSTER_BOX_GAP),
            cluster_link_distance_base: p
                .as_ref()
                .and_then(|x| x.cluster_link_distance_base)
                .unwrap_or(CLUSTER_LINK_DISTANCE_BASE),
            cluster_repulsion_soft: p
                .as_ref()
                .and_then(|x| x.cluster_repulsion_soft)
                .unwrap_or(CLUSTER_REPULSION_SOFT),
            cluster_center_pull: p
                .as_ref()
                .and_then(|x| x.cluster_center_pull)
                .unwrap_or(CLUSTER_CENTER_PULL),
            cluster_temperature_initial: p
                .as_ref()
                .and_then(|x| x.cluster_temperature_initial)
                .unwrap_or(CLUSTER_TEMPERATURE_INITIAL),
            cluster_temperature_decay: p
                .as_ref()
                .and_then(|x| x.cluster_temperature_decay)
                .unwrap_or(CLUSTER_TEMPERATURE_DECAY),
            cluster_iterations: p
                .as_ref()
                .and_then(|x| x.cluster_iterations)
                .unwrap_or(CLUSTER_ITERATIONS),
            cluster_two_way_bonus: p
                .as_ref()
                .and_then(|x| x.cluster_two_way_bonus)
                .unwrap_or(CLUSTER_TWO_WAY_BONUS),
            cluster_horizontal_stretch: p
                .as_ref()
                .and_then(|x| x.cluster_horizontal_stretch)
                .unwrap_or(CLUSTER_HORIZONTAL_STRETCH),
            fixed_random_seed: p
                .as_ref()
                .and_then(|x| x.fixed_random_seed)
                .unwrap_or(FIXED_RANDOM_SEED),
            min_distance: p
                .as_ref()
                .and_then(|x| x.min_distance)
                .unwrap_or(MIN_DISTANCE),
            attractive_direction_salt: p
                .as_ref()
                .and_then(|x| x.attractive_direction_salt)
                .unwrap_or(ATTRACTIVE_DIRECTION_SALT),
            final_collision_salt: p
                .as_ref()
                .and_then(|x| x.final_collision_salt)
                .unwrap_or(FINAL_COLLISION_SALT),
            collision_direction_salt: p
                .as_ref()
                .and_then(|x| x.collision_direction_salt)
                .unwrap_or(COLLISION_DIRECTION_SALT),
            edge_clearance_salt: EDGE_CLEARANCE_SALT,
            temperature_decay_min: TEMPERATURE_DECAY_MIN,
            temperature_decay_max: TEMPERATURE_DECAY_MAX,
            gravity_strength: GRAVITY_STRENGTH,
        }
    }
}
