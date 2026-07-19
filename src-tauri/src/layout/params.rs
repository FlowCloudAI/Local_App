//! 分量统计与自适应参数生成层。
//!
//! 设计依据：
//! - FR 1991：保留经典 `k` 作为全局理想尺度的语义，但改为“每个分量一个 k_c”。
//! - OGDF FMMM / Graphviz sfdp：借鉴“高层参数映射到底层求解参数”的工程分层，
//!   让统计量、参数生成、求解主循环彼此解耦。
//! - D3 forceCollide：边长下限与碰撞半径语义保持一致，避免参数生成阶段直接要求节点重叠。

use crate::layout::constants::{DEGREE_EDGE_LENGTH_THRESHOLD, MIN_MEAN_DEGREE};
use crate::layout::engine::{LayoutEdge, LayoutNode};
use crate::layout::resolved_params::ResolvedLayoutParams;

#[derive(Debug, Clone)]
pub struct ComponentStats {
    pub component_id: String,
    pub n: usize,
    pub m: usize,
    pub rho: f64,
    #[allow(dead_code)]
    pub degrees: Vec<usize>,
    pub mean_deg: f64,
    pub std_deg: f64,
    pub cv_deg: f64,
    #[allow(dead_code)]
    pub radii: Vec<f64>,
    pub r_mean: f64,
    pub r_max: f64,
    pub eta: f64,
    pub pathish_score: f64,
}

#[derive(Debug, Clone)]
pub struct ComponentLayoutParams {
    pub ideal_edge_length: f64,
    pub fr_scale: f64,
    pub initialization_radius: f64,
    pub initial_temperature: f64,
    pub minimum_temperature: f64,
    pub temperature_decay: f64,
    pub iterations: usize,
    pub estimated_area: f64,
    pub axis_compaction_strength: f64,
    pub radial_pull_strength: f64,
    pub leaf_pull_strength: f64,
    pub branch_smoothing_strength: f64,
}

#[derive(Debug, Clone)]
pub struct EdgeLayoutParams {
    pub source: usize,
    pub target: usize,
    /// 该值是吸引尺度参数，不是严格意义上的平衡边长。
    pub target_length: f64,
    pub attraction_weight: f64,
}

#[derive(Debug, Clone)]
pub struct AdaptiveComponentConfig {
    pub node_indices: Vec<usize>,
    pub stats: ComponentStats,
    pub params: ComponentLayoutParams,
    pub edge_params: Vec<EdgeLayoutParams>,
}

pub fn build_adaptive_component_config(
    component_id: String,
    component_nodes: Vec<usize>,
    component_edges: Vec<LayoutEdge>,
    all_nodes: &[LayoutNode],
    resolved: &ResolvedLayoutParams,
) -> AdaptiveComponentConfig {
    let stats = collect_component_stats(
        component_id.clone(),
        &component_nodes,
        &component_edges,
        all_nodes,
    );
    let params = derive_component_params(&stats, resolved);
    let edge_params = derive_edge_layout_params(&component_edges, all_nodes, &params, resolved);

    log_component_config(&stats, &params);

    AdaptiveComponentConfig {
        node_indices: component_nodes,
        stats,
        params,
        edge_params,
    }
}

pub fn collect_component_stats(
    component_id: String,
    component_nodes: &[usize],
    component_edges: &[LayoutEdge],
    all_nodes: &[LayoutNode],
) -> ComponentStats {
    let n = component_nodes.len();
    let m = component_edges.len();

    let mut node_slot = std::collections::HashMap::new();
    for (slot, &node_index) in component_nodes.iter().enumerate() {
        node_slot.insert(node_index, slot);
    }

    let mut degrees = vec![0usize; n];
    let mut two_way_edges = 0usize;

    for edge in component_edges {
        if let Some(&slot) = node_slot.get(&edge.source) {
            degrees[slot] += 1;
        }
        if let Some(&slot) = node_slot.get(&edge.target) {
            degrees[slot] += 1;
        }
        if edge.is_two_way {
            two_way_edges += 1;
        }
    }

    let radii = component_nodes
        .iter()
        .map(|&node_index| all_nodes[node_index].radius)
        .collect::<Vec<_>>();

    let rho = if n < 2 {
        0.0
    } else {
        (2.0 * m as f64) / ((n * (n - 1)) as f64)
    };
    let mean_deg = mean_usize(&degrees);
    let std_deg = stddev_usize(&degrees, mean_deg);
    let cv_deg = if mean_deg <= MIN_MEAN_DEGREE {
        0.0
    } else {
        std_deg / mean_deg
    };
    let r_mean = mean_f64(&radii);
    let r_max = radii.iter().copied().fold(0.0, f64::max);
    let eta = (two_way_edges as f64) / (m.max(1) as f64);
    let pathish_score = compute_pathish_score(rho, mean_deg, cv_deg, eta);

    ComponentStats {
        component_id,
        n,
        m,
        rho,
        degrees,
        mean_deg,
        std_deg,
        cv_deg,
        radii,
        r_mean,
        r_max,
        eta,
        pathish_score,
    }
}

pub fn derive_component_params(
    stats: &ComponentStats,
    r: &ResolvedLayoutParams,
) -> ComponentLayoutParams {
    let scale_expansion =
        1.0 + r.edge_length_alpha_rho * stats.rho + r.edge_length_alpha_cv * stats.cv_deg;
    let pathish_compaction = 1.0 - r.pathish_edge_length_reduction * stats.pathish_score;
    let lc_raw = (2.0 * stats.r_mean + r.node_gap) * scale_expansion * pathish_compaction;
    let ideal_edge_length = lc_raw.clamp(r.edge_length_min, r.edge_length_max);
    let fr_scale = ideal_edge_length;

    let initialization_radius = if stats.n <= 1 {
        0.0
    } else {
        let circumference_term = (stats.n as f64) * fr_scale / (std::f64::consts::TAU);
        let node_size_term =
            r.init_radius_beta_rmax * stats.r_max * (stats.n as f64) / std::f64::consts::PI;
        let base_radius = circumference_term.max(node_size_term);
        base_radius * (1.0 - r.pathish_init_radius_reduction * stats.pathish_score)
    };

    let minimum_temperature = (r.min_temperature_gamma * stats.r_mean).max(r.min_distance);
    let initial_temperature = if stats.n <= 1 {
        minimum_temperature
    } else {
        (r.initial_temperature_gamma * initialization_radius)
            .max(minimum_temperature * r.min_temperature_ratio)
    };

    let iterations_raw = r.iteration_base
        + r.iteration_sqrt_scale * (stats.n as f64).sqrt()
        + r.iteration_rho_scale * stats.rho;
    let iterations_lower_bound = if stats.n <= 8 {
        (r.iteration_min as f64 * 0.42).ceil() as usize
    } else if stats.n <= 20 {
        (r.iteration_min as f64 * 0.7).ceil() as usize
    } else {
        r.iteration_min
    };
    let iterations = iterations_raw
        .round()
        .clamp(iterations_lower_bound as f64, r.iteration_max as f64) as usize;

    let temperature_decay = if stats.n <= 1 || initial_temperature <= minimum_temperature {
        r.temperature_decay_max
    } else {
        ((minimum_temperature / initial_temperature).ln() / (iterations as f64))
            .exp()
            .clamp(r.temperature_decay_min, r.temperature_decay_max)
    };

    let estimated_area = (stats.n as f64)
        * (2.0 * stats.r_mean + r.node_gap).powi(2)
        * (1.0 + r.estimated_area_beta_rho * stats.rho + r.estimated_area_beta_cv * stats.cv_deg);
    let axis_compaction_strength = r.pathish_axis_compaction_max * stats.pathish_score;
    let radial_pull_strength = r.pathish_radial_pull_max * stats.pathish_score;
    let leaf_pull_strength = r.pathish_leaf_pull_max * stats.pathish_score;
    let branch_smoothing_strength = r.pathish_branch_smoothing_max * stats.pathish_score;

    ComponentLayoutParams {
        ideal_edge_length,
        fr_scale,
        initialization_radius,
        initial_temperature,
        minimum_temperature,
        temperature_decay,
        iterations,
        estimated_area,
        axis_compaction_strength,
        radial_pull_strength,
        leaf_pull_strength,
        branch_smoothing_strength,
    }
}

pub fn derive_edge_layout_params(
    component_edges: &[LayoutEdge],
    all_nodes: &[LayoutNode],
    params: &ComponentLayoutParams,
    r: &ResolvedLayoutParams,
) -> Vec<EdgeLayoutParams> {
    let mut degree_by_node = std::collections::HashMap::<usize, f64>::new();
    for edge in component_edges {
        *degree_by_node.entry(edge.source).or_insert(0.0) += 1.0;
        *degree_by_node.entry(edge.target).or_insert(0.0) += 1.0;
    }

    component_edges
        .iter()
        .map(|edge| {
            let left_radius = all_nodes[edge.source].radius;
            let right_radius = all_nodes[edge.target].radius;
            let collision_floor = left_radius + right_radius + r.node_gap;
            let length_factor = if edge.is_two_way {
                r.two_way_edge_length_factor
            } else {
                1.0
            };
            // 端点度数越高的边越长：给枢纽周围留出角度展开空间，
            // 缓解多条边挤在同一方向导致的箭头/标签堆叠。
            let hub_degree = degree_by_node
                .get(&edge.source)
                .copied()
                .unwrap_or(0.0)
                .max(degree_by_node.get(&edge.target).copied().unwrap_or(0.0));
            let degree_factor = (1.0
                + r.degree_edge_length_scale
                    * (hub_degree - DEGREE_EDGE_LENGTH_THRESHOLD).max(0.0))
            .min(r.degree_edge_length_max_factor);
            let target_length = collision_floor.max(params.fr_scale * length_factor * degree_factor);
            let attraction_weight = if edge.is_two_way {
                r.two_way_attraction_weight
            } else {
                1.0
            };

            EdgeLayoutParams {
                source: edge.source,
                target: edge.target,
                target_length,
                attraction_weight,
            }
        })
        .collect()
}

fn log_component_config(stats: &ComponentStats, params: &ComponentLayoutParams) {
    if log::log_enabled!(log::Level::Debug) {
        log::debug!(
            "layout component={} n={} m={} rho={:.4} mean_deg={:.4} std_deg={:.4} cv_deg={:.4} r_mean={:.4} r_max={:.4} eta={:.4} pathish={:.4} L_c={:.4} k_c={:.4} R0={:.4} T0={:.4} T_min={:.4} decay={:.6} iters={} A_c={:.4} axis_compact={:.4} radial_pull={:.4} leaf_pull={:.4} branch_smooth={:.4}",
            stats.component_id,
            stats.n,
            stats.m,
            stats.rho,
            stats.mean_deg,
            stats.std_deg,
            stats.cv_deg,
            stats.r_mean,
            stats.r_max,
            stats.eta,
            stats.pathish_score,
            params.ideal_edge_length,
            params.fr_scale,
            params.initialization_radius,
            params.initial_temperature,
            params.minimum_temperature,
            params.temperature_decay,
            params.iterations,
            params.estimated_area,
            params.axis_compaction_strength,
            params.radial_pull_strength,
            params.leaf_pull_strength,
            params.branch_smoothing_strength,
        );
    }
}

fn compute_pathish_score(rho: f64, mean_deg: f64, cv_deg: f64, eta: f64) -> f64 {
    let sparse_factor = (1.0 - rho).clamp(0.0, 1.0);
    let uniformity_factor = 1.0 / (1.0 + cv_deg.max(0.0));
    let tree_like_mean_factor = 1.0 / (1.0 + (mean_deg - 2.0).abs());
    let reciprocity_damping = 1.0 - 0.35 * eta.clamp(0.0, 1.0);

    (sparse_factor * uniformity_factor * tree_like_mean_factor * reciprocity_damping)
        .clamp(0.0, 1.0)
}

fn mean_usize(values: &[usize]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().map(|value| *value as f64).sum::<f64>() / values.len() as f64
}

fn stddev_usize(values: &[usize], mean: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let variance = values
        .iter()
        .map(|value| {
            let delta = (*value as f64) - mean;
            delta * delta
        })
        .sum::<f64>()
        / values.len() as f64;
    variance.sqrt()
}

fn mean_f64(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

#[cfg(test)]
mod tests {
    use super::{collect_component_stats, derive_component_params, derive_edge_layout_params};
    use crate::layout::constants::{COLLISION_PADDING, TWO_WAY_ATTRACTION_WEIGHT};
    use crate::layout::engine::{LayoutEdge, LayoutNode};
    use crate::layout::resolved_params::ResolvedLayoutParams;

    fn test_node(id: &str, width: f64, height: f64) -> LayoutNode {
        LayoutNode {
            id: id.to_string(),
            width,
            height,
            radius: width.max(height) * 0.5 + COLLISION_PADDING,
        }
    }

    #[test]
    fn collects_component_stats_from_graph_shape() {
        let nodes = vec![
            test_node("a", 100.0, 60.0),
            test_node("b", 120.0, 60.0),
            test_node("c", 80.0, 80.0),
        ];
        let component_nodes = vec![0usize, 1, 2];
        let edges = vec![
            LayoutEdge {
                source: 0,
                target: 1,
                is_two_way: true,
            },
            LayoutEdge {
                source: 1,
                target: 2,
                is_two_way: false,
            },
        ];

        let stats = collect_component_stats("c0".to_string(), &component_nodes, &edges, &nodes);

        assert_eq!(stats.n, 3);
        assert_eq!(stats.m, 2);
        assert!((stats.rho - (4.0 / 6.0)).abs() < 1e-9);
        assert_eq!(stats.degrees, vec![1, 2, 1]);
        assert_eq!(stats.radii.len(), 3);
        assert!(stats.r_mean > 0.0);
        assert!(stats.r_max >= stats.r_mean);
        assert!((stats.eta - 0.5).abs() < 1e-9);
        assert!((0.0..=1.0).contains(&stats.pathish_score));
    }

    #[test]
    fn derives_larger_scale_for_denser_graphs() {
        let sparse = super::ComponentStats {
            component_id: "sparse".to_string(),
            n: 8,
            m: 7,
            rho: 0.25,
            degrees: vec![1; 8],
            mean_deg: 1.0,
            std_deg: 0.0,
            cv_deg: 0.0,
            radii: vec![40.0; 8],
            r_mean: 40.0,
            r_max: 40.0,
            eta: 0.0,
            pathish_score: 0.0,
        };
        let dense = super::ComponentStats {
            component_id: "dense".to_string(),
            rho: 0.75,
            cv_deg: 0.8,
            ..sparse.clone()
        };

        let resolved = ResolvedLayoutParams::from_payload(None);
        let sparse_params = derive_component_params(&sparse, &resolved);
        let dense_params = derive_component_params(&dense, &resolved);

        assert!(dense_params.ideal_edge_length > sparse_params.ideal_edge_length);
        assert!(dense_params.initialization_radius >= sparse_params.initialization_radius);
        assert!(dense_params.iterations >= sparse_params.iterations);
        assert!(dense_params.estimated_area > sparse_params.estimated_area);
    }

    #[test]
    fn derives_edge_level_lengths_and_weights() {
        let nodes = vec![test_node("a", 120.0, 60.0), test_node("b", 120.0, 60.0)];
        let params = super::ComponentLayoutParams {
            ideal_edge_length: 160.0,
            fr_scale: 160.0,
            initialization_radius: 60.0,
            initial_temperature: 24.0,
            minimum_temperature: 4.0,
            temperature_decay: 0.95,
            iterations: 80,
            estimated_area: 1000.0,
            axis_compaction_strength: 0.1,
            radial_pull_strength: 0.08,
            leaf_pull_strength: 0.12,
            branch_smoothing_strength: 0.1,
        };
        let edges = vec![
            LayoutEdge {
                source: 0,
                target: 1,
                is_two_way: false,
            },
            LayoutEdge {
                source: 0,
                target: 1,
                is_two_way: true,
            },
        ];

        let resolved = ResolvedLayoutParams::from_payload(None);
        let edge_params = derive_edge_layout_params(&edges, &nodes, &params, &resolved);

        assert_eq!(edge_params[0].attraction_weight, 1.0);
        assert_eq!(edge_params[1].attraction_weight, TWO_WAY_ATTRACTION_WEIGHT);
        assert!(edge_params[1].target_length <= edge_params[0].target_length);
        assert!(edge_params[1].target_length >= nodes[0].radius + nodes[1].radius);
    }

    #[test]
    fn hub_edges_get_longer_target_length() {
        // 小节点保证碰撞下限低于 fr_scale，让度数因子可观察
        let nodes = vec![
            test_node("hub", 40.0, 40.0),
            test_node("n1", 40.0, 40.0),
            test_node("n2", 40.0, 40.0),
            test_node("n3", 40.0, 40.0),
            test_node("n4", 40.0, 40.0),
        ];
        let params = super::ComponentLayoutParams {
            ideal_edge_length: 160.0,
            fr_scale: 160.0,
            initialization_radius: 60.0,
            initial_temperature: 24.0,
            minimum_temperature: 4.0,
            temperature_decay: 0.95,
            iterations: 80,
            estimated_area: 1000.0,
            axis_compaction_strength: 0.1,
            radial_pull_strength: 0.08,
            leaf_pull_strength: 0.12,
            branch_smoothing_strength: 0.1,
        };
        // 星形：hub 度数 4
        let star_edges = (1..=4)
            .map(|target| LayoutEdge {
                source: 0,
                target,
                is_two_way: false,
            })
            .collect::<Vec<_>>();
        // 对照：两节点一条边，度数 1
        let pair_edges = vec![LayoutEdge {
            source: 1,
            target: 2,
            is_two_way: false,
        }];

        let resolved = ResolvedLayoutParams::from_payload(None);
        let star_params = derive_edge_layout_params(&star_edges, &nodes, &params, &resolved);
        let pair_params = derive_edge_layout_params(&pair_edges, &nodes, &params, &resolved);

        // 度数 4 超出阈值 2 → 因子 1 + 0.12×2 = 1.24
        assert!(star_params[0].target_length > pair_params[0].target_length);
        assert!((star_params[0].target_length - 160.0 * 1.24).abs() < 1e-9);
        assert!((pair_params[0].target_length - 160.0).abs() < 1e-9);

        // 超级枢纽被乘数上限约束
        let mega_edges = (1..=20)
            .map(|index| LayoutEdge {
                source: 0,
                target: 1 + (index % 4),
                is_two_way: false,
            })
            .collect::<Vec<_>>();
        let mega_params = derive_edge_layout_params(&mega_edges, &nodes, &params, &resolved);
        assert!((mega_params[0].target_length - 160.0 * 1.7).abs() < 1e-9);
    }

    #[test]
    fn derives_higher_pathish_score_for_sparse_uniform_components() {
        let sparse_path = super::compute_pathish_score(0.12, 1.9, 0.2, 0.0);
        let dense_cluster = super::compute_pathish_score(0.72, 4.8, 0.9, 0.4);

        assert!(sparse_path > dense_cluster);
        assert!(sparse_path > 0.3);
    }

    #[test]
    fn pathish_components_get_more_compaction_params() {
        let compact = super::ComponentStats {
            component_id: "pathish".to_string(),
            n: 10,
            m: 9,
            rho: 0.2,
            degrees: vec![1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
            mean_deg: 1.8,
            std_deg: 0.4,
            cv_deg: 0.22,
            radii: vec![36.0; 10],
            r_mean: 36.0,
            r_max: 36.0,
            eta: 0.0,
            pathish_score: 0.85,
        };
        let clustered = super::ComponentStats {
            component_id: "cluster".to_string(),
            rho: 0.75,
            mean_deg: 4.5,
            std_deg: 2.0,
            cv_deg: 0.45,
            eta: 0.3,
            pathish_score: 0.1,
            ..compact.clone()
        };

        let resolved = ResolvedLayoutParams::from_payload(None);
        let compact_params = derive_component_params(&compact, &resolved);
        let clustered_params = derive_component_params(&clustered, &resolved);

        assert!(compact_params.ideal_edge_length < clustered_params.ideal_edge_length);
        assert!(
            compact_params.axis_compaction_strength > clustered_params.axis_compaction_strength
        );
        assert!(compact_params.radial_pull_strength > clustered_params.radial_pull_strength);
        assert!(compact_params.leaf_pull_strength > clustered_params.leaf_pull_strength);
        assert!(
            compact_params.branch_smoothing_strength > clustered_params.branch_smoothing_strength
        );
    }
}
