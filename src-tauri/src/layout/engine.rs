//! 确定性布局求解层。
//!
//! 设计依据：
//! - Fruchterman-Reingold (1991)：主循环严格使用经典吸引/斥力形式，
//!   `fa(d) = d^2 / k` 与 `fr(d) = k^2 / d`，温度负责位移截断与收敛。
//! - Graphviz overlap / pack：将“主布局”和“去重叠/分量摆放”分成独立层次处理。
//! - petgraph connected_components 文档：只把 petgraph 用于建图，不误用该 API 来收集成员，
//!   连通分量成员由本模块自行稳定遍历收集。

use crate::layout::cluster::{
    ClusterBox, ClusterPlacement, ConnectedComponentSpec, decompose_component, layout_cluster_graph,
};
use crate::layout::component_graph::{
    component_key_from_node_indices, component_seed, split_connected_components,
};
use crate::layout::math::{Vec2, deterministic_unit, safe_direction, unit_angle};
use crate::layout::params::{AdaptiveComponentConfig, build_adaptive_component_config};
pub(crate) use crate::layout::prepare::{LayoutEdge, LayoutNode};
pub use crate::layout::prepare::{PreparedLayoutRequest, cache_key, prepare_request};
use crate::layout::topology::{UndirectedTopology, build_undirected_topology};
use crate::layout::types::{LayoutBounds, LayoutPosition, LayoutResponse};
use std::collections::{BTreeMap, HashMap};
use std::f64::consts::TAU;

#[derive(Debug, Clone)]
struct ComponentLayout {
    node_indices: Vec<usize>,
    positions: Vec<Vec2>,
    bounds: ComponentBounds,
    estimated_area: f64,
    is_isolated: bool,
}

#[derive(Debug, Clone, Copy)]
struct ComponentBounds {
    width: f64,
    height: f64,
}

#[derive(Debug, Clone)]
struct LocalEdgeLayout {
    source: usize,
    target: usize,
    target_length: f64,
    attraction_weight: f64,
}

#[derive(Debug, Clone)]
struct LocalComponentTopology {
    neighbors: Vec<Vec<usize>>,
    degrees: Vec<usize>,
}

pub fn compute_layout(prepared: &PreparedLayoutRequest) -> LayoutResponse {
    if prepared.nodes.is_empty() {
        return LayoutResponse {
            positions: BTreeMap::new(),
            bounds: None,
            layout_hash: Some(prepared.layout_hash.clone()),
        };
    }

    let connected_components = split_connected_components(prepared);
    let component_layouts = connected_components
        .iter()
        .map(|component| layout_connected_component(prepared, component))
        .collect::<Vec<_>>();
    let placed = place_components(prepared, component_layouts);
    let bounds = overall_bounds(prepared, &placed);
    if let Some(bounds) = bounds.as_ref() {
        if log::log_enabled!(log::Level::Debug) {
            log::debug!(
                "layout final-bounds x={:.2} y={:.2} width={:.2} height={:.2}",
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
            );
        }
    }

    let positions = placed
        .iter()
        .map(|(node_id, center)| {
            let node = prepared
                .nodes
                .iter()
                .find(|candidate| candidate.id == *node_id)
                .expect("node id should exist");

            let x = center.x + (prepared.node_origin[0] - 0.5) * node.width;
            let y = center.y + (prepared.node_origin[1] - 0.5) * node.height;

            (node_id.clone(), LayoutPosition { x, y })
        })
        .collect::<BTreeMap<_, _>>();

    LayoutResponse {
        positions,
        bounds,
        layout_hash: Some(prepared.layout_hash.clone()),
    }
}

fn layout_connected_component(
    prepared: &PreparedLayoutRequest,
    component: &ConnectedComponentSpec,
) -> ComponentLayout {
    let node_ids = prepared
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();
    let decomposition = decompose_component(component, &node_ids, &prepared.resolved_params);

    let mut cluster_layouts = decomposition
        .clusters
        .iter()
        .map(|cluster| {
            let config = build_adaptive_component_config(
                cluster.cluster_id.clone(),
                cluster.node_indices.clone(),
                cluster
                    .internal_edges
                    .iter()
                    .map(|edge| LayoutEdge {
                        source: edge.source,
                        target: edge.target,
                        is_two_way: edge.is_two_way,
                    })
                    .collect(),
                &prepared.nodes,
                &prepared.resolved_params,
            );
            layout_component(prepared, &config)
        })
        .collect::<Vec<_>>();

    for cluster_layout in &mut cluster_layouts {
        normalize_cluster_orientation(prepared, cluster_layout);
    }

    let mut layout = if cluster_layouts.len() == 1 {
        cluster_layouts
            .pop()
            .expect("single-cluster component should yield one layout")
    } else {
        let external_connection_counts =
            cluster_external_connection_counts(cluster_layouts.len(), &decomposition.links);
        let cluster_boxes = cluster_layouts
            .iter()
            .enumerate()
            .map(|(index, layout)| ClusterBox {
                width: layout.bounds.width,
                height: layout.bounds.height,
                area: (layout.bounds.width * layout.bounds.height).max(layout.estimated_area),
                center_before: [layout.bounds.width * 0.5, layout.bounds.height * 0.5],
                external_connection_count: external_connection_counts[index],
                node_count: layout.node_indices.len(),
            })
            .collect::<Vec<_>>();
        let cluster_ids = decomposition
            .clusters
            .iter()
            .map(|cluster| cluster.cluster_id.clone())
            .collect::<Vec<_>>();
        let placement = layout_cluster_graph(
            &component.component_id,
            &cluster_boxes,
            &decomposition.links,
            &cluster_ids,
            &prepared.resolved_params,
        );

        log_cluster_stage(component, &decomposition, &cluster_boxes, &placement);
        assemble_cluster_component(prepared, component, cluster_layouts, &placement)
    };

    apply_component_edge_clearance(prepared, component, &mut layout);
    layout
}

/// 细长簇朝向归一化：linearity 达阈值的簇绕质心做刚体旋转，把 PCA 主轴
/// 转到水平——细长形状躺平后高度最小、包围盒最小，横向空间利用最大化。
/// 圆形碰撞模型下旋转严格保持簇内节点距离与无重叠状态；接近圆形的簇
/// （linearity 低）主轴方向不稳定，用阈值挡掉。
/// 阈值 >1 可整体关闭。单簇分量（簇即分量）同样适用；与已撤回的
/// "整组件旋转"不同，这里只转单个力导向结果，不会扰动多簇组装关系。
fn normalize_cluster_orientation(prepared: &PreparedLayoutRequest, cluster: &mut ComponentLayout) {
    if cluster.positions.len() < 2 {
        return;
    }

    let r = &prepared.resolved_params;
    let Some((centroid, major_axis, linearity)) =
        principal_axis_signature(&cluster.positions, r.min_distance)
    else {
        return;
    };
    if linearity < r.orientation_linearity_threshold {
        return;
    }

    // principal_axis_signature 给出的主轴角在 (-90°, 90°] 内，
    // 旋转 -angle 即最小角度转到水平；已经水平就不动。
    let angle = major_axis.y.atan2(major_axis.x);
    let (sin, cos) = (-angle).sin_cos();
    if sin.abs() <= r.min_distance {
        return;
    }

    for position in &mut cluster.positions {
        let relative = *position - centroid;
        *position = centroid
            + Vec2::new(
                relative.x * cos - relative.y * sin,
                relative.x * sin + relative.y * cos,
            );
    }
    cluster.bounds =
        normalize_component_bounds(prepared, &cluster.node_indices, &mut cluster.positions);
}

fn apply_component_edge_clearance(
    prepared: &PreparedLayoutRequest,
    component: &ConnectedComponentSpec,
    layout: &mut ComponentLayout,
) {
    let passes = prepared.resolved_params.edge_clearance_passes;
    if passes == 0 || component.edges.is_empty() || layout.positions.len() < 3 {
        return;
    }

    let node_slot = layout
        .node_indices
        .iter()
        .enumerate()
        .map(|(slot, node_index)| (*node_index, slot))
        .collect::<HashMap<_, _>>();
    let local_edges = component
        .edges
        .iter()
        .map(|edge| {
            (
                *node_slot
                    .get(&edge.source)
                    .expect("component edge source should exist in assembled layout"),
                *node_slot
                    .get(&edge.target)
                    .expect("component edge target should exist in assembled layout"),
            )
        })
        .collect::<Vec<_>>();
    let seed = component_seed(prepared, &layout.node_indices);

    if resolve_edge_clearance(
        prepared,
        &layout.node_indices,
        &local_edges,
        &mut layout.positions,
        seed,
        passes,
    ) {
        layout.bounds =
            normalize_component_bounds(prepared, &layout.node_indices, &mut layout.positions);
    }
}

fn layout_component(
    prepared: &PreparedLayoutRequest,
    config: &AdaptiveComponentConfig,
) -> ComponentLayout {
    let component_nodes = &config.node_indices;
    let is_isolated = component_nodes.len() == 1 && config.stats.m == 0;
    if component_nodes.len() == 1 {
        let mut positions = vec![Vec2::default()];
        let bounds = normalize_component_bounds(prepared, component_nodes, &mut positions);
        return ComponentLayout {
            node_indices: component_nodes.clone(),
            positions,
            bounds,
            estimated_area: config.params.estimated_area,
            is_isolated,
        };
    }

    let r = &prepared.resolved_params;
    let component_seed = component_seed(prepared, component_nodes);
    let node_count = component_nodes.len();
    let mut positions =
        initial_circle_positions(&config.params, component_nodes.len(), component_seed);
    let mut node_slot = HashMap::new();

    for (slot, &node_index) in component_nodes.iter().enumerate() {
        node_slot.insert(node_index, slot);
    }

    let local_edges = config
        .edge_params
        .iter()
        .map(|edge| LocalEdgeLayout {
            source: *node_slot
                .get(&edge.source)
                .expect("component edge source should exist in node slot map"),
            target: *node_slot
                .get(&edge.target)
                .expect("component edge target should exist in node slot map"),
            target_length: edge.target_length,
            attraction_weight: edge.attraction_weight,
        })
        .collect::<Vec<_>>();
    let topology = build_local_topology(node_count, &local_edges);

    let iteration_limit = config.params.iterations;
    let mut temperature = config.params.initial_temperature;
    let mut early_stop_streak = 0usize;

    for current_iter in 0..iteration_limit {
        let mut displacements = vec![Vec2::default(); node_count];

        for left in 0..node_count {
            for right in (left + 1)..node_count {
                let delta = positions[left] - positions[right];
                let distance = delta.length();
                let direction = safe_direction(
                    delta,
                    deterministic_unit(component_seed ^ ((left as u64) << 32) ^ right as u64),
                );
                let force =
                    config.params.fr_scale * config.params.fr_scale / distance.max(r.min_distance);
                let movement = direction * force;
                displacements[left] += movement;
                displacements[right] -= movement;
            }
        }

        for edge in &local_edges {
            let delta = positions[edge.source] - positions[edge.target];
            let distance = delta.length();
            let direction = safe_direction(
                delta,
                deterministic_unit(
                    component_seed
                        ^ r.attractive_direction_salt
                        ^ ((edge.source as u64) << 32)
                        ^ edge.target as u64,
                ),
            );
            let capped_d = distance.min(config.params.ideal_edge_length * 10.0);
            let force = edge.attraction_weight * capped_d.max(r.min_distance).powi(2)
                / edge.target_length.max(r.min_distance);
            let movement = direction * force;
            displacements[edge.source] -= movement;
            displacements[edge.target] += movement;
        }

        let centroid = positions
            .iter()
            .copied()
            .fold(Vec2::default(), |acc, p| acc + p)
            * (1.0 / node_count as f64);
        let gravity_scale =
            r.gravity_strength * (node_count as f64).sqrt() / config.params.fr_scale;
        for (slot, position) in positions.iter().enumerate() {
            let to_centroid = centroid - *position;
            if to_centroid.length() > r.min_distance {
                displacements[slot] += to_centroid * gravity_scale;
            }
        }

        let mut max_movement = 0.0_f64;

        for (slot, displacement) in displacements.iter().enumerate() {
            let magnitude = displacement.length();
            if magnitude <= r.min_distance {
                continue;
            }

            let limited =
                *displacement * (temperature.min(magnitude) / magnitude.max(r.min_distance));
            positions[slot] += limited;
            max_movement = max_movement.max(limited.length());
        }

        let _ = resolve_collisions(
            prepared,
            component_nodes,
            &mut positions,
            component_seed,
            r.collision_passes_per_iteration,
        );

        if temperature <= config.params.minimum_temperature * 1.4
            && max_movement < r.early_stop_threshold
        {
            early_stop_streak += 1;
            if early_stop_streak >= r.early_stop_streak {
                break;
            }
        } else {
            early_stop_streak = 0;
        }

        let progress = current_iter as f64 / iteration_limit as f64;
        let adaptive_decay = (config.params.temperature_decay * (1.0 - 0.12 * progress)).min(0.998);
        temperature = (temperature * adaptive_decay).max(config.params.minimum_temperature);
    }

    resolve_collisions(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ r.final_collision_salt,
        r.final_collision_passes,
    );
    compact_component_shape(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ r.final_collision_salt,
        &topology,
        &config.params,
    );
    resolve_collisions(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ r.final_collision_salt ^ r.collision_direction_salt,
        r.final_collision_passes,
    );

    let bounds = normalize_component_bounds(prepared, component_nodes, &mut positions);

    ComponentLayout {
        node_indices: component_nodes.clone(),
        positions,
        bounds,
        estimated_area: config.params.estimated_area,
        is_isolated,
    }
}

fn cluster_external_connection_counts(
    cluster_count: usize,
    links: &[crate::layout::cluster::ClusterGraphLink],
) -> Vec<usize> {
    let mut counts = vec![0usize; cluster_count];
    for link in links {
        counts[link.source] += link.edge_count;
        counts[link.target] += link.edge_count;
    }
    counts
}

fn assemble_cluster_component(
    prepared: &PreparedLayoutRequest,
    component: &ConnectedComponentSpec,
    cluster_layouts: Vec<ComponentLayout>,
    placement: &ClusterPlacement,
) -> ComponentLayout {
    let mut positioned_clusters = cluster_layouts;
    let mut per_node_position = HashMap::<usize, Vec2>::new();

    for (cluster_index, cluster_layout) in positioned_clusters.iter_mut().enumerate() {
        let target_center = Vec2::new(
            placement.centers[cluster_index][0],
            placement.centers[cluster_index][1],
        );
        let local_center = Vec2::new(
            cluster_layout.bounds.width * 0.5,
            cluster_layout.bounds.height * 0.5,
        );
        let offset = target_center - local_center;

        for center in &mut cluster_layout.positions {
            *center += offset;
        }
    }

    apply_cluster_mirrors(component, &mut positioned_clusters, placement);
    orient_terminal_nodes(prepared, component, &mut positioned_clusters);

    for cluster_layout in &positioned_clusters {
        for (slot, &node_index) in cluster_layout.node_indices.iter().enumerate() {
            per_node_position.insert(node_index, cluster_layout.positions[slot]);
        }
    }

    let mut positions = component
        .node_indices
        .iter()
        .map(|node_index| {
            *per_node_position
                .get(node_index)
                .expect("every clustered node should have an assembled position")
        })
        .collect::<Vec<_>>();
    let bounds = normalize_component_bounds(prepared, &component.node_indices, &mut positions);

    ComponentLayout {
        node_indices: component.node_indices.clone(),
        positions,
        bounds,
        estimated_area: positioned_clusters
            .iter()
            .map(|cluster| cluster.estimated_area)
            .sum::<f64>(),
        is_isolated: component.node_indices.len() == 1 && component.edges.is_empty(),
    }
}

/// 簇拼装前的镜像选择：簇内布局不知道跨簇边朝向哪一侧，直接拼装可能把
/// 连接节点甩在远离对端簇的一侧。对每个簇枚举 4 种绕自身盒中心的镜像
/// （恒等 / 水平翻 / 垂直翻 / 双翻，镜像不改变簇的包围盒），贪心选择让
/// 自身跨簇边总长最小的变体。按簇索引顺序单遍处理，先处理的簇以后处理
/// 簇的未镜像位置为参照——确定性坐标下降一轮。
fn apply_cluster_mirrors(
    component: &ConnectedComponentSpec,
    clusters: &mut [ComponentLayout],
    placement: &ClusterPlacement,
) {
    if clusters.len() <= 1 {
        return;
    }

    let mut locate = HashMap::<usize, (usize, usize)>::new();
    for (cluster_index, cluster) in clusters.iter().enumerate() {
        for (slot, &node_index) in cluster.node_indices.iter().enumerate() {
            locate.insert(node_index, (cluster_index, slot));
        }
    }

    // 每簇的跨簇边：（本簇槽位，对端簇，对端槽位）
    let mut cross_edges: Vec<Vec<(usize, usize, usize)>> = vec![Vec::new(); clusters.len()];
    for edge in &component.edges {
        let Some(&(source_cluster, source_slot)) = locate.get(&edge.source) else {
            continue;
        };
        let Some(&(target_cluster, target_slot)) = locate.get(&edge.target) else {
            continue;
        };
        if source_cluster == target_cluster {
            continue;
        }
        cross_edges[source_cluster].push((source_slot, target_cluster, target_slot));
        cross_edges[target_cluster].push((target_slot, source_cluster, source_slot));
    }

    for cluster_index in 0..clusters.len() {
        if cross_edges[cluster_index].is_empty() {
            continue;
        }
        let center = Vec2::new(
            placement.centers[cluster_index][0],
            placement.centers[cluster_index][1],
        );

        let mut best_variant = 0usize;
        let mut best_cost = f64::INFINITY;
        for variant in 0..4usize {
            let flip_x = variant & 1 == 1;
            let flip_y = variant & 2 == 2;
            let mut cost = 0.0;
            for &(own_slot, other_cluster, other_slot) in &cross_edges[cluster_index] {
                let own = clusters[cluster_index].positions[own_slot];
                let mirrored = Vec2::new(
                    if flip_x {
                        2.0 * center.x - own.x
                    } else {
                        own.x
                    },
                    if flip_y {
                        2.0 * center.y - own.y
                    } else {
                        own.y
                    },
                );
                cost += (mirrored - clusters[other_cluster].positions[other_slot]).length();
            }
            // 严格更优才切换：并列时保留靠前变体（恒等优先），抵抗浮点噪声
            if cost + 1e-9 < best_cost {
                best_cost = cost;
                best_variant = variant;
            }
        }

        if best_variant != 0 {
            let flip_x = best_variant & 1 == 1;
            let flip_y = best_variant & 2 == 2;
            for position in &mut clusters[cluster_index].positions {
                if flip_x {
                    position.x = 2.0 * center.x - position.x;
                }
                if flip_y {
                    position.y = 2.0 * center.y - position.y;
                }
            }
        }
    }
}

/// 把有唯一外联锚点的末端节点转入已有水平空位。锚点和其他簇不动，
/// 候选只有在不增加整体宽高且不制造碰撞/边净空违规时才会被接受。
fn orient_terminal_nodes(
    prepared: &PreparedLayoutRequest,
    component: &ConnectedComponentSpec,
    clusters: &mut [ComponentLayout],
) {
    if clusters.len() <= 1 {
        return;
    }

    let mut locate = HashMap::<usize, (usize, usize)>::new();
    for (cluster_index, cluster) in clusters.iter().enumerate() {
        for (slot, &node_index) in cluster.node_indices.iter().enumerate() {
            locate.insert(node_index, (cluster_index, slot));
        }
    }

    let mut internal_edge_counts = vec![0usize; clusters.len()];
    let mut cross_edges = vec![Vec::<(usize, usize, usize)>::new(); clusters.len()];
    for edge in &component.edges {
        let Some(&(source_cluster, source_slot)) = locate.get(&edge.source) else {
            continue;
        };
        let Some(&(target_cluster, target_slot)) = locate.get(&edge.target) else {
            continue;
        };
        if source_cluster == target_cluster {
            internal_edge_counts[source_cluster] += 1;
        } else {
            cross_edges[source_cluster].push((source_slot, target_cluster, target_slot));
            cross_edges[target_cluster].push((target_slot, source_cluster, source_slot));
        }
    }

    for cluster_index in 0..clusters.len() {
        if clusters[cluster_index].node_indices.len() != 2
            || internal_edge_counts[cluster_index] != 1
            || cross_edges[cluster_index].is_empty()
        {
            continue;
        }

        let (anchor_slot, neighbor_cluster, _) = cross_edges[cluster_index][0];
        if cross_edges[cluster_index]
            .iter()
            .any(|&(slot, other_cluster, _)| {
                slot != anchor_slot || other_cluster != neighbor_cluster
            })
        {
            continue;
        }

        let tail_slot = if anchor_slot == 0 { 1 } else { 0 };
        if let Some((candidate, _)) = best_horizontal_terminal_candidate(
            prepared,
            component,
            clusters,
            &locate,
            (cluster_index, tail_slot),
            (cluster_index, anchor_slot),
        ) {
            clusters[cluster_index].positions[tail_slot] = candidate;
        }
    }

    // ponytail: 单节点末端每个分量只移动收益最大的一个；需要协同换位时再扩展。
    let mut best_singleton = None::<(f64, usize, usize, Vec2)>;
    for cluster_index in 0..clusters.len() {
        if clusters[cluster_index].node_indices.len() != 1 || cross_edges[cluster_index].len() != 1
        {
            continue;
        }
        let (tail_slot, anchor_cluster, anchor_slot) = cross_edges[cluster_index][0];
        let Some((candidate, area_reduction)) = best_horizontal_terminal_candidate(
            prepared,
            component,
            clusters,
            &locate,
            (cluster_index, tail_slot),
            (anchor_cluster, anchor_slot),
        ) else {
            continue;
        };
        if best_singleton
            .as_ref()
            .is_none_or(|(best_reduction, _, _, _)| area_reduction > *best_reduction + 1e-9)
        {
            best_singleton = Some((area_reduction, cluster_index, tail_slot, candidate));
        }
    }

    if let Some((_, cluster_index, tail_slot, candidate)) = best_singleton {
        clusters[cluster_index].positions[tail_slot] = candidate;
    }
}

fn best_horizontal_terminal_candidate(
    prepared: &PreparedLayoutRequest,
    component: &ConnectedComponentSpec,
    clusters: &[ComponentLayout],
    locate: &HashMap<usize, (usize, usize)>,
    tail: (usize, usize),
    anchor: (usize, usize),
) -> Option<(Vec2, f64)> {
    let (tail_cluster, tail_slot) = tail;
    let (anchor_cluster, anchor_slot) = anchor;
    let tail_node_index = clusters[tail_cluster].node_indices[tail_slot];
    let anchor_node_index = clusters[anchor_cluster].node_indices[anchor_slot];
    let anchor_position = clusters[anchor_cluster].positions[anchor_slot];
    let original = clusters[tail_cluster].positions[tail_slot];
    let distance = (original - anchor_position).length();
    if distance <= prepared.resolved_params.min_distance {
        return None;
    }

    let (current_width, current_height) = assembled_dimensions(prepared, clusters, None);
    let current_area = current_width * current_height;
    let mut best = None;
    let mut best_area = current_area;
    let candidates = [
        Vec2::new(anchor_position.x - distance, anchor_position.y),
        Vec2::new(anchor_position.x + distance, anchor_position.y),
    ];

    'candidate: for candidate in candidates {
        let position_of = |node_index: usize| {
            let (other_cluster, other_slot) = locate[&node_index];
            if other_cluster == tail_cluster && other_slot == tail_slot {
                candidate
            } else {
                clusters[other_cluster].positions[other_slot]
            }
        };
        let tail_node = &prepared.nodes[tail_node_index];

        for (&node_index, &(other_cluster, other_slot)) in locate {
            if node_index == tail_node_index {
                continue;
            }
            let other_node = &prepared.nodes[node_index];
            let other_position = clusters[other_cluster].positions[other_slot];
            if (candidate - other_position).length() + prepared.resolved_params.min_distance
                < tail_node.radius + other_node.radius
            {
                continue 'candidate;
            }
        }

        for edge in &component.edges {
            if edge.source == tail_node_index || edge.target == tail_node_index {
                continue;
            }
            let (nearest, _) = closest_point_on_segment(
                candidate,
                position_of(edge.source),
                position_of(edge.target),
                prepared.resolved_params.min_distance,
            );
            let clearance = tail_node.radius
                * prepared
                    .resolved_params
                    .edge_clearance_radius_factor
                    .max(0.0)
                + prepared.resolved_params.edge_clearance_margin.max(0.0);
            if (candidate - nearest).length() + prepared.resolved_params.min_distance < clearance {
                continue 'candidate;
            }
        }

        for &node_index in locate.keys() {
            if node_index == tail_node_index || node_index == anchor_node_index {
                continue;
            }
            let (nearest, _) = closest_point_on_segment(
                position_of(node_index),
                anchor_position,
                candidate,
                prepared.resolved_params.min_distance,
            );
            let clearance = prepared.nodes[node_index].radius
                * prepared
                    .resolved_params
                    .edge_clearance_radius_factor
                    .max(0.0)
                + prepared.resolved_params.edge_clearance_margin.max(0.0);
            if (position_of(node_index) - nearest).length() + prepared.resolved_params.min_distance
                < clearance
            {
                continue 'candidate;
            }
        }

        let (width, height) = assembled_dimensions(
            prepared,
            clusters,
            Some((tail_cluster, tail_slot, candidate)),
        );
        if width > current_width + 1e-9 || height > current_height + 1e-9 {
            continue;
        }
        let area = width * height;
        if area + 1e-9 < best_area {
            best = Some(candidate);
            best_area = area;
        }
    }

    best.map(|candidate| (candidate, current_area - best_area))
}

fn assembled_dimensions(
    prepared: &PreparedLayoutRequest,
    clusters: &[ComponentLayout],
    override_position: Option<(usize, usize, Vec2)>,
) -> (f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for (cluster_index, cluster) in clusters.iter().enumerate() {
        for (slot, &node_index) in cluster.node_indices.iter().enumerate() {
            let node = &prepared.nodes[node_index];
            let position = match override_position {
                Some((override_cluster, override_slot, position))
                    if override_cluster == cluster_index && override_slot == slot =>
                {
                    position
                }
                _ => cluster.positions[slot],
            };
            min_x = min_x.min(position.x - node.width * 0.5);
            min_y = min_y.min(position.y - node.height * 0.5);
            max_x = max_x.max(position.x + node.width * 0.5);
            max_y = max_y.max(position.y + node.height * 0.5);
        }
    }

    ((max_x - min_x).max(0.0), (max_y - min_y).max(0.0))
}

fn log_cluster_stage(
    component: &ConnectedComponentSpec,
    decomposition: &crate::layout::cluster::ClusterDecomposition,
    boxes: &[ClusterBox],
    placement: &ClusterPlacement,
) {
    if !log::log_enabled!(log::Level::Debug) {
        return;
    }

    log::debug!(
        "cluster-stage component={} clusters={} cluster_links={}",
        component.component_id,
        decomposition.clusters.len(),
        decomposition.links.len(),
    );

    for link in &decomposition.links {
        log::debug!(
            "cluster-stage component={} link={} -> {} edges={} two_way={} weight={:.2}",
            component.component_id,
            decomposition.clusters[link.source].cluster_id,
            decomposition.clusters[link.target].cluster_id,
            link.edge_count,
            link.two_way_count,
            link.weight,
        );
    }

    for (index, cluster) in decomposition.clusters.iter().enumerate() {
        log::debug!(
            "cluster-stage component={} cluster={} nodes={} box=({:.2},{:.2}) external_edges={} center_before=({:.2},{:.2}) center_after=({:.2},{:.2})",
            component.component_id,
            cluster.cluster_id,
            cluster.node_indices.len(),
            boxes[index].width,
            boxes[index].height,
            boxes[index].external_connection_count,
            boxes[index].center_before[0],
            boxes[index].center_before[1],
            placement.centers[index][0],
            placement.centers[index][1],
        );
    }
}

fn initial_circle_positions(
    params: &crate::layout::params::ComponentLayoutParams,
    node_count: usize,
    component_seed: u64,
) -> Vec<Vec2> {
    let phase = unit_angle(component_seed);

    (0..node_count)
        .enumerate()
        .map(|(index, _)| {
            let angle = phase + TAU * (index as f64) / (node_count as f64);
            Vec2::new(
                params.initialization_radius * angle.cos(),
                params.initialization_radius * angle.sin(),
            )
        })
        .collect()
}

fn resolve_collisions(
    prepared: &PreparedLayoutRequest,
    component_nodes: &[usize],
    positions: &mut [Vec2],
    component_seed: u64,
    passes: usize,
) -> bool {
    let r = &prepared.resolved_params;
    let mut any_overlap = false;
    for _ in 0..passes {
        let mut pass_overlap = false;

        for left in 0..component_nodes.len() {
            for right in (left + 1)..component_nodes.len() {
                let left_node = &prepared.nodes[component_nodes[left]];
                let right_node = &prepared.nodes[component_nodes[right]];
                let minimum_distance = left_node.radius + right_node.radius;
                let delta = positions[right] - positions[left];
                let distance = delta.length();

                if distance + r.min_distance >= minimum_distance {
                    continue;
                }

                let overlap = minimum_distance - distance;
                let direction = safe_direction(
                    delta,
                    deterministic_unit(
                        component_seed
                            ^ r.collision_direction_salt
                            ^ ((component_nodes[left] as u64) << 32)
                            ^ component_nodes[right] as u64,
                    ),
                );
                let shift = direction * (overlap * 0.54);
                positions[left] -= shift;
                positions[right] += shift;
                pass_overlap = true;
            }
        }

        if !pass_overlap {
            break;
        }
        any_overlap = true;
    }
    any_overlap
}

fn closest_point_on_segment(point: Vec2, start: Vec2, end: Vec2, min_distance: f64) -> (Vec2, f64) {
    let segment = end - start;
    let length_squared = segment.dot(segment);
    if length_squared <= min_distance * min_distance {
        return ((start + end) * 0.5, 0.5);
    }

    let t = ((point - start).dot(segment) / length_squared).clamp(0.0, 1.0);
    (start + segment * t, t)
}

fn resolve_edge_clearance(
    prepared: &PreparedLayoutRequest,
    component_nodes: &[usize],
    local_edges: &[(usize, usize)],
    positions: &mut [Vec2],
    component_seed: u64,
    passes: usize,
) -> bool {
    // 端点只承担部分反作用，避免修一条边时把相邻关系整体推散。
    const REACTION_FACTOR: f64 = 0.35;

    if passes == 0 || local_edges.is_empty() || positions.len() < 3 {
        return false;
    }

    let r = &prepared.resolved_params;
    let strength = r.edge_clearance_strength.clamp(0.0, 1.0);
    if strength <= r.min_distance {
        return false;
    }

    let radius_factor = r.edge_clearance_radius_factor.max(0.0);
    let margin = r.edge_clearance_margin.max(0.0);
    let mut any_moved = false;
    let mut completed_passes = 0usize;

    for pass in 0..passes {
        let mut pass_moved = false;

        for (edge_index, &(source_slot, target_slot)) in local_edges.iter().enumerate() {
            for slot in 0..positions.len() {
                if slot == source_slot || slot == target_slot {
                    continue;
                }

                let source = positions[source_slot];
                let target = positions[target_slot];
                let (nearest, t) =
                    closest_point_on_segment(positions[slot], source, target, r.min_distance);
                let delta = positions[slot] - nearest;
                let distance = delta.length();
                let clearance =
                    prepared.nodes[component_nodes[slot]].radius * radius_factor + margin;
                if distance + r.min_distance >= clearance {
                    continue;
                }

                let deterministic = deterministic_unit(
                    component_seed
                        ^ r.edge_clearance_salt
                        ^ ((edge_index as u64) << 32)
                        ^ slot as u64,
                );
                let segment = target - source;
                let normal = safe_direction(Vec2::new(-segment.y, segment.x), deterministic);
                let fallback = if normal.dot(deterministic) < 0.0 {
                    normal * -1.0
                } else {
                    normal
                };
                let direction = safe_direction(delta, fallback);
                let movement = direction * ((clearance - distance) * strength);

                positions[slot] += movement;
                positions[source_slot] -= movement * (REACTION_FACTOR * (1.0 - t));
                positions[target_slot] -= movement * (REACTION_FACTOR * t);
                pass_moved = true;
                any_moved = true;
            }
        }

        if !pass_moved {
            break;
        }
        completed_passes = pass + 1;
        let _ = resolve_collisions(
            prepared,
            component_nodes,
            positions,
            component_seed ^ r.edge_clearance_salt ^ pass as u64,
            2,
        );
    }

    if log::log_enabled!(log::Level::Debug) {
        let mut residual = 0usize;
        for &(source_slot, target_slot) in local_edges {
            for slot in 0..positions.len() {
                if slot == source_slot || slot == target_slot {
                    continue;
                }
                let (nearest, _) = closest_point_on_segment(
                    positions[slot],
                    positions[source_slot],
                    positions[target_slot],
                    r.min_distance,
                );
                let clearance =
                    prepared.nodes[component_nodes[slot]].radius * radius_factor + margin;
                if (positions[slot] - nearest).length() + r.min_distance < clearance {
                    residual += 1;
                }
            }
        }
        log::debug!(
            "layout edge-clearance component={} passes={} residual={}",
            component_key_from_node_indices(prepared, component_nodes),
            completed_passes,
            residual,
        );
    }

    any_moved
}

fn build_local_topology(
    node_count: usize,
    local_edges: &[LocalEdgeLayout],
) -> LocalComponentTopology {
    let UndirectedTopology { neighbors, degrees } = build_undirected_topology(
        node_count,
        local_edges.iter().map(|edge| (edge.source, edge.target)),
    );
    LocalComponentTopology { neighbors, degrees }
}

fn compact_component_shape(
    prepared: &PreparedLayoutRequest,
    component_nodes: &[usize],
    positions: &mut [Vec2],
    component_seed: u64,
    topology: &LocalComponentTopology,
    params: &crate::layout::params::ComponentLayoutParams,
) {
    if positions.len() < 3 {
        return;
    }

    let r = &prepared.resolved_params;
    for _ in 0..r.post_layout_compaction_passes {
        let Some((centroid, major_axis, linearity)) =
            principal_axis_signature(positions, r.min_distance)
        else {
            return;
        };
        // 长宽比兜底：pathish 低的混合结构跑成瘦长条时，仍按展布比触发主轴压实
        let aspect =
            principal_axis_aspect(prepared, component_nodes, positions, centroid, major_axis);
        let trigger = r.aspect_compaction_trigger.max(1.0);
        let aspect_boost = if aspect > trigger {
            r.aspect_compaction_max * ((aspect / trigger) - 1.0).min(1.0)
        } else {
            0.0
        };
        let axis_strength = (params.axis_compaction_strength * (0.7 + 0.3 * linearity))
            .max(aspect_boost)
            .clamp(0.0, 0.42);
        let radial_strength =
            (params.radial_pull_strength * (0.65 + 0.35 * linearity)).clamp(0.0, 0.28);
        let branch_strength = params.branch_smoothing_strength.clamp(0.0, 0.32);
        let leaf_strength = params.leaf_pull_strength.clamp(0.0, 0.38);

        if axis_strength <= r.min_distance
            && radial_strength <= r.min_distance
            && branch_strength <= r.min_distance
            && leaf_strength <= r.min_distance
        {
            return;
        }

        if axis_strength > r.min_distance {
            for position in positions.iter_mut() {
                let relative = *position - centroid;
                let longitudinal = relative.dot(major_axis);
                let transverse = relative - (major_axis * longitudinal);
                *position =
                    centroid + (major_axis * (longitudinal * (1.0 - axis_strength))) + transverse;
            }
        }

        if radial_strength > r.min_distance {
            apply_radial_pull(
                positions,
                topology,
                centroid,
                radial_strength,
                r.min_distance,
            );
        }

        if branch_strength > r.min_distance || leaf_strength > r.min_distance {
            apply_branch_compaction(
                positions,
                topology,
                centroid,
                branch_strength,
                leaf_strength,
                r.min_distance,
            );
        }

        resolve_collisions(prepared, component_nodes, positions, component_seed, 2);
    }
}

fn apply_radial_pull(
    positions: &mut [Vec2],
    topology: &LocalComponentTopology,
    centroid: Vec2,
    radial_strength: f64,
    min_distance: f64,
) {
    let snapshot = positions.to_vec();
    let radial_mean = snapshot
        .iter()
        .map(|position| (*position - centroid).length())
        .sum::<f64>()
        / snapshot.len() as f64;

    for (slot, position) in positions.iter_mut().enumerate() {
        let relative = snapshot[slot] - centroid;
        let distance = relative.length();
        if distance <= min_distance {
            continue;
        }

        let degree = topology.degrees[slot];
        let leafish = match degree {
            0 | 1 => 1.0,
            2 => 0.72,
            3 => 0.35,
            _ => 0.16,
        };
        let neighbor_mean = if topology.neighbors[slot].is_empty() {
            radial_mean
        } else {
            topology.neighbors[slot]
                .iter()
                .map(|&neighbor| (snapshot[neighbor] - centroid).length())
                .sum::<f64>()
                / topology.neighbors[slot].len() as f64
        };
        let far_bias = ((distance / radial_mean.max(min_distance)) - 0.95).clamp(0.0, 1.2);
        let outward_bias =
            ((distance - neighbor_mean) / distance.max(min_distance)).clamp(0.0, 1.0);
        let strength = radial_strength
            * (0.3 + 0.7 * leafish)
            * (0.25 + 0.75 * far_bias)
            * (0.35 + 0.65 * outward_bias);

        *position -= relative * strength;
    }
}

fn apply_branch_compaction(
    positions: &mut [Vec2],
    topology: &LocalComponentTopology,
    centroid: Vec2,
    branch_strength: f64,
    leaf_strength: f64,
    min_distance: f64,
) {
    let snapshot = positions.to_vec();

    for slot in 0..positions.len() {
        let degree = topology.degrees[slot];
        if degree == 0 {
            continue;
        }

        let neighbor_center = topology.neighbors[slot]
            .iter()
            .map(|&neighbor| snapshot[neighbor])
            .fold(Vec2::default(), |acc, point| acc + point)
            * (1.0 / degree as f64);
        let current = snapshot[slot];
        let distance = (current - centroid).length();
        let neighbor_distance = (neighbor_center - centroid).length();
        let outward_bias =
            ((distance - neighbor_distance) / distance.max(min_distance)).clamp(0.0, 1.0);

        if degree <= 2 && branch_strength > min_distance {
            let target = neighbor_center + ((centroid - neighbor_center) * 0.18);
            let shift = (target - current)
                * branch_strength
                * (if degree == 1 { 0.95 } else { 0.72 })
                * (0.35 + 0.65 * outward_bias);
            positions[slot] += shift;
        }

        if degree == 1 && leaf_strength > min_distance {
            let target = (neighbor_center * 0.68) + (centroid * 0.32);
            let shift = (target - current) * leaf_strength * (0.45 + 0.55 * outward_bias);
            positions[slot] += shift;
        }
    }
}

/// 分量沿主轴/次轴的半展布之比（各加平均节点半径），衡量"瘦长程度"。
/// 用主轴系而非 x/y 包围盒，斜向拉长的分量同样能被识别。
fn principal_axis_aspect(
    prepared: &PreparedLayoutRequest,
    component_nodes: &[usize],
    positions: &[Vec2],
    centroid: Vec2,
    major_axis: Vec2,
) -> f64 {
    let minor_axis = Vec2::new(-major_axis.y, major_axis.x);
    let mut long_extent = 0.0_f64;
    let mut short_extent = 0.0_f64;
    for position in positions {
        let relative = *position - centroid;
        long_extent = long_extent.max(relative.dot(major_axis).abs());
        short_extent = short_extent.max(relative.dot(minor_axis).abs());
    }

    let mean_radius = component_nodes
        .iter()
        .map(|&node_index| prepared.nodes[node_index].radius)
        .sum::<f64>()
        / component_nodes.len().max(1) as f64;
    (long_extent + mean_radius)
        / (short_extent + mean_radius).max(prepared.resolved_params.min_distance)
}

fn principal_axis_signature(positions: &[Vec2], min_distance: f64) -> Option<(Vec2, Vec2, f64)> {
    if positions.len() < 2 {
        return None;
    }

    let centroid = positions
        .iter()
        .copied()
        .fold(Vec2::default(), |acc, point| acc + point)
        * (1.0 / positions.len() as f64);

    let mut xx = 0.0;
    let mut xy = 0.0;
    let mut yy = 0.0;

    for point in positions {
        let relative = *point - centroid;
        xx += relative.x * relative.x;
        xy += relative.x * relative.y;
        yy += relative.y * relative.y;
    }

    xx /= positions.len() as f64;
    xy /= positions.len() as f64;
    yy /= positions.len() as f64;

    let trace = xx + yy;
    if trace <= min_distance {
        return None;
    }

    let delta = ((xx - yy) * (xx - yy) + 4.0 * xy * xy).sqrt();
    let major = ((trace + delta) * 0.5).max(min_distance);
    let minor = ((trace - delta) * 0.5).max(0.0);
    let theta = 0.5 * (2.0 * xy).atan2(xx - yy);
    let major_axis = Vec2::new(theta.cos(), theta.sin());
    let linearity = (1.0 - minor / major).clamp(0.0, 1.0);

    Some((centroid, major_axis, linearity))
}

fn normalize_component_bounds(
    prepared: &PreparedLayoutRequest,
    component_nodes: &[usize],
    positions: &mut [Vec2],
) -> ComponentBounds {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for (slot, &node_index) in component_nodes.iter().enumerate() {
        let node = &prepared.nodes[node_index];
        let center = positions[slot];
        min_x = min_x.min(center.x - node.width * 0.5);
        min_y = min_y.min(center.y - node.height * 0.5);
        max_x = max_x.max(center.x + node.width * 0.5);
        max_y = max_y.max(center.y + node.height * 0.5);
    }

    for center in positions.iter_mut() {
        center.x -= min_x;
        center.y -= min_y;
    }

    ComponentBounds {
        width: (max_x - min_x).max(0.0),
        height: (max_y - min_y).max(0.0),
    }
}

fn place_components(
    prepared: &PreparedLayoutRequest,
    mut components: Vec<ComponentLayout>,
) -> BTreeMap<String, Vec2> {
    let r = &prepared.resolved_params;
    let mut main_components = Vec::new();
    let mut isolated_components = Vec::new();

    for component in components.drain(..) {
        if component.is_isolated {
            isolated_components.push(component);
        } else {
            main_components.push(component);
        }
    }

    main_components.sort_by(|left, right| {
        let left_area = left.bounds.width * left.bounds.height;
        let right_area = right.bounds.width * right.bounds.height;
        right_area
            .total_cmp(&left_area)
            .then_with(|| right.estimated_area.total_cmp(&left.estimated_area))
            .then_with(|| component_key(prepared, left).cmp(&component_key(prepared, right)))
    });

    isolated_components
        .sort_by(|left, right| component_key(prepared, left).cmp(&component_key(prepared, right)));

    let mut placed = BTreeMap::new();
    let main_bottom = place_component_group(
        prepared,
        &main_components,
        r.component_gap,
        0.0,
        &mut placed,
    );
    let isolated_start_y = if main_components.is_empty() {
        0.0
    } else {
        main_bottom + r.component_gap
    };

    let _ = place_component_group(
        prepared,
        &isolated_components,
        r.isolated_node_horizontal_gap,
        isolated_start_y,
        &mut placed,
    );

    placed
}

fn place_component_group(
    prepared: &PreparedLayoutRequest,
    components: &[ComponentLayout],
    horizontal_gap: f64,
    start_y: f64,
    placed: &mut BTreeMap<String, Vec2>,
) -> f64 {
    let r = &prepared.resolved_params;
    let mut cursor_x = 0.0;
    let mut cursor_y = start_y;
    let mut row_height = 0.0;

    for component in components {
        if cursor_x > 0.0 && cursor_x + component.bounds.width > r.shelf_row_max_width {
            cursor_x = 0.0;
            cursor_y += row_height + r.component_gap;
            row_height = 0.0;
        }

        for (slot, &node_index) in component.node_indices.iter().enumerate() {
            let center = component.positions[slot] + Vec2::new(cursor_x, cursor_y);
            placed.insert(prepared.nodes[node_index].id.clone(), center);
        }

        cursor_x += component.bounds.width + horizontal_gap;
        row_height = row_height.max(component.bounds.height);
    }

    cursor_y + row_height
}

fn overall_bounds(
    prepared: &PreparedLayoutRequest,
    positions: &BTreeMap<String, Vec2>,
) -> Option<LayoutBounds> {
    if positions.is_empty() {
        return None;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for node in &prepared.nodes {
        let center = positions
            .get(&node.id)
            .expect("every node should have a placed center");
        min_x = min_x.min(center.x - node.width * 0.5);
        min_y = min_y.min(center.y - node.height * 0.5);
        max_x = max_x.max(center.x + node.width * 0.5);
        max_y = max_y.max(center.y + node.height * 0.5);
    }

    Some(LayoutBounds {
        x: min_x,
        y: min_y,
        width: (max_x - min_x).max(0.0),
        height: (max_y - min_y).max(0.0),
    })
}

fn component_key(prepared: &PreparedLayoutRequest, component: &ComponentLayout) -> String {
    component_key_from_node_indices(prepared, &component.node_indices)
}

#[cfg(test)]
mod tests {
    use super::{
        Vec2, build_local_topology, cache_key, compact_component_shape, compute_layout,
        prepare_request, principal_axis_signature,
    };
    use crate::layout::cache::LayoutCache;
    use crate::layout::constants::COLLISION_PADDING;
    use crate::layout::params::ComponentLayoutParams;
    use crate::layout::types::{LayoutEdgeInput, LayoutEdgeKind, LayoutNodeInput, LayoutRequest};

    fn node(id: &str, width: f64, height: f64) -> LayoutNodeInput {
        LayoutNodeInput {
            id: id.to_string(),
            width,
            height,
        }
    }

    fn edge(source: &str, target: &str) -> LayoutEdgeInput {
        LayoutEdgeInput {
            id: None,
            source: source.to_string(),
            target: target.to_string(),
            source_handle: None,
            target_handle: None,
            kind: Some(LayoutEdgeKind::OneWay),
        }
    }

    fn compaction_params() -> ComponentLayoutParams {
        ComponentLayoutParams {
            ideal_edge_length: 120.0,
            fr_scale: 120.0,
            initialization_radius: 80.0,
            initial_temperature: 24.0,
            minimum_temperature: 4.0,
            temperature_decay: 0.94,
            iterations: 96,
            estimated_area: 10_000.0,
            axis_compaction_strength: 0.3,
            radial_pull_strength: 0.18,
            leaf_pull_strength: 0.28,
            branch_smoothing_strength: 0.22,
        }
    }

    #[test]
    fn mirrors_clusters_to_shorten_cross_edges() {
        use super::{ComponentBounds, ComponentLayout, apply_cluster_mirrors};
        use crate::layout::cluster::{ClusterEdgeRef, ClusterPlacement, ConnectedComponentSpec};

        // 簇 0（中心 50,50）：节点 0 在左缘、节点 1 在右缘；
        // 簇 1（中心 250,50）：节点 2 在左缘、节点 3 在右缘。
        let clusters = vec![
            ComponentLayout {
                node_indices: vec![0, 1],
                positions: vec![Vec2::new(10.0, 50.0), Vec2::new(90.0, 50.0)],
                bounds: ComponentBounds {
                    width: 100.0,
                    height: 100.0,
                },
                estimated_area: 10_000.0,
                is_isolated: false,
            },
            ComponentLayout {
                node_indices: vec![2, 3],
                positions: vec![Vec2::new(210.0, 50.0), Vec2::new(290.0, 50.0)],
                bounds: ComponentBounds {
                    width: 100.0,
                    height: 100.0,
                },
                estimated_area: 10_000.0,
                is_isolated: false,
            },
        ];
        let component = ConnectedComponentSpec {
            component_id: "0|1|2|3".to_string(),
            node_indices: vec![0, 1, 2, 3],
            edges: vec![
                ClusterEdgeRef {
                    source: 0,
                    target: 1,
                    is_two_way: false,
                },
                ClusterEdgeRef {
                    source: 2,
                    target: 3,
                    is_two_way: false,
                },
                // 跨簇边连接簇 0 左缘节点与簇 1 右缘节点——不镜像时最远（280）
                ClusterEdgeRef {
                    source: 0,
                    target: 3,
                    is_two_way: false,
                },
            ],
        };
        let placement = ClusterPlacement {
            centers: vec![[50.0, 50.0], [250.0, 50.0]],
        };

        let mut mirrored = clusters;
        apply_cluster_mirrors(&component, &mut mirrored, &placement);

        // 两簇都应水平翻转：节点 0 → x=90，节点 3 → x=210，跨簇边 280 → 120
        let n0 = mirrored[0].positions[0];
        let n3 = mirrored[1].positions[1];
        assert!((n0.x - 90.0).abs() < 1e-9);
        assert!((n3.x - 210.0).abs() < 1e-9);
        assert!(((n3 - n0).length() - 120.0).abs() < 1e-9);
    }

    #[test]
    fn normalizes_linear_cluster_orientation_and_respects_kill_switch() {
        use super::{ComponentBounds, ComponentLayout, normalize_cluster_orientation};

        let mut prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 100.0, 50.0),
                node("b", 100.0, 50.0),
                node("c", 100.0, 50.0),
                node("d", 100.0, 50.0),
            ],
            edges: Vec::new(),
            params: Some(
                serde_json::from_value(serde_json::json!({
                    "orientationLinearityThreshold": 0.35
                }))
                .expect("orientation threshold payload should deserialize"),
            ),
        });
        assert_eq!(
            prepared.resolved_params.orientation_linearity_threshold,
            0.35
        );
        let diagonal = ComponentLayout {
            node_indices: vec![0, 1, 2],
            positions: vec![
                Vec2::new(-100.0, -100.0),
                Vec2::new(0.0, 0.0),
                Vec2::new(100.0, 100.0),
            ],
            bounds: ComponentBounds {
                width: 300.0,
                height: 250.0,
            },
            estimated_area: 75_000.0,
            is_isolated: false,
        };
        let original_distance = (diagonal.positions[2] - diagonal.positions[0]).length();

        let mut oriented = diagonal.clone();
        normalize_cluster_orientation(&prepared, &mut oriented);
        let min_y = oriented
            .positions
            .iter()
            .map(|position| position.y)
            .fold(f64::INFINITY, f64::min);
        let max_y = oriented
            .positions
            .iter()
            .map(|position| position.y)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(max_y - min_y < 1e-9);
        assert!(
            ((oriented.positions[2] - oriented.positions[0]).length() - original_distance).abs()
                < 1e-9
        );

        prepared.resolved_params.orientation_linearity_threshold = 1.01;
        let mut disabled = diagonal.clone();
        normalize_cluster_orientation(&prepared, &mut disabled);
        assert_eq!(disabled.positions, diagonal.positions);

        prepared.resolved_params.orientation_linearity_threshold = 0.35;
        let square = ComponentLayout {
            node_indices: vec![0, 1, 2, 3],
            positions: vec![
                Vec2::new(-100.0, -100.0),
                Vec2::new(100.0, -100.0),
                Vec2::new(-100.0, 100.0),
                Vec2::new(100.0, 100.0),
            ],
            bounds: ComponentBounds {
                width: 300.0,
                height: 250.0,
            },
            estimated_area: 75_000.0,
            is_isolated: false,
        };
        let mut unchanged_square = square.clone();
        normalize_cluster_orientation(&prepared, &mut unchanged_square);
        assert_eq!(unchanged_square.positions, square.positions);
    }

    #[test]
    fn lays_out_realistically_decomposed_three_node_chain_horizontally() {
        let node_ids = [
            "A", "B", "C", "d1", "d2", "d3", "p1", "p2", "s1", "s2", "s3", "s4", "s5", "s6",
        ];
        let request = LayoutRequest {
            node_origin: None,
            nodes: node_ids.iter().map(|id| node(id, 160.0, 80.0)).collect(),
            edges: vec![
                edge("A", "B"),
                edge("B", "C"),
                edge("C", "A"),
                edge("d1", "d2"),
                edge("d2", "d3"),
                edge("d2", "A"),
                edge("p1", "p2"),
                edge("p1", "A"),
                edge("s1", "A"),
                edge("s2", "A"),
                edge("s3", "B"),
                edge("s4", "B"),
                edge("s5", "C"),
                edge("s6", "C"),
            ],
            params: None,
        };
        let prepared = prepare_request(request);
        let response = compute_layout(&prepared);
        let chain = ["d1", "d2", "d3"]
            .map(|id| response.positions.get(id).expect("chain node should exist"));
        let x_span = chain
            .iter()
            .map(|position| position.x)
            .fold(f64::NEG_INFINITY, f64::max)
            - chain
                .iter()
                .map(|position| position.x)
                .fold(f64::INFINITY, f64::min);
        let y_span = chain
            .iter()
            .map(|position| position.y)
            .fold(f64::NEG_INFINITY, f64::max)
            - chain
                .iter()
                .map(|position| position.y)
                .fold(f64::INFINITY, f64::min);

        assert!(x_span > y_span, "chain should lie horizontally");
    }

    #[test]
    fn orients_terminal_pair_into_free_horizontal_space_only() {
        use super::{ComponentBounds, ComponentLayout, orient_terminal_nodes};
        use crate::layout::cluster::{ClusterEdgeRef, ConnectedComponentSpec};

        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("anchor", 100.0, 50.0),
                node("tail", 100.0, 50.0),
                node("right", 100.0, 50.0),
                node("left", 100.0, 50.0),
            ],
            edges: Vec::new(),
            params: None,
        });
        let component = ConnectedComponentSpec {
            component_id: "anchor|tail|right|left".to_string(),
            node_indices: vec![0, 1, 2, 3],
            edges: vec![
                ClusterEdgeRef {
                    source: 0,
                    target: 1,
                    is_two_way: false,
                },
                ClusterEdgeRef {
                    source: 0,
                    target: 2,
                    is_two_way: false,
                },
            ],
        };
        let pair = ComponentLayout {
            node_indices: vec![0, 1],
            positions: vec![Vec2::new(0.0, 0.0), Vec2::new(0.0, -200.0)],
            bounds: ComponentBounds {
                width: 100.0,
                height: 250.0,
            },
            estimated_area: 25_000.0,
            is_isolated: false,
        };
        let surrounding = ComponentLayout {
            node_indices: vec![2, 3],
            positions: vec![Vec2::new(300.0, 0.0), Vec2::new(-400.0, 0.0)],
            bounds: ComponentBounds {
                width: 800.0,
                height: 50.0,
            },
            estimated_area: 40_000.0,
            is_isolated: false,
        };

        let mut free = vec![pair.clone(), surrounding.clone()];
        orient_terminal_nodes(&prepared, &component, &mut free);
        assert_eq!(free[0].positions[0], Vec2::new(0.0, 0.0));
        assert_eq!(free[0].positions[1], Vec2::new(-200.0, 0.0));
        assert_eq!(free[1].positions, surrounding.positions);

        let mut blocked = vec![pair, surrounding];
        blocked[1].positions = vec![Vec2::new(200.0, 0.0), Vec2::new(-200.0, 0.0)];
        orient_terminal_nodes(&prepared, &component, &mut blocked);
        assert_eq!(blocked[0].positions[0], Vec2::new(0.0, 0.0));
        assert_eq!(blocked[0].positions[1], Vec2::new(0.0, -200.0));
    }

    #[test]
    fn orients_only_the_best_terminal_singleton() {
        use super::{ComponentBounds, ComponentLayout, orient_terminal_nodes};
        use crate::layout::cluster::{ClusterEdgeRef, ConnectedComponentSpec};

        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("top-leaf", 100.0, 50.0),
                node("top-anchor", 100.0, 50.0),
                node("right", 100.0, 50.0),
                node("left", 100.0, 50.0),
                node("bottom-leaf", 100.0, 50.0),
                node("bottom-anchor", 100.0, 50.0),
            ],
            edges: Vec::new(),
            params: None,
        });
        let component = ConnectedComponentSpec {
            component_id: "terminal-singletons".to_string(),
            node_indices: vec![0, 1, 2, 3, 4, 5],
            edges: vec![
                ClusterEdgeRef {
                    source: 0,
                    target: 1,
                    is_two_way: false,
                },
                ClusterEdgeRef {
                    source: 4,
                    target: 5,
                    is_two_way: false,
                },
            ],
        };
        let mut clusters = vec![
            ComponentLayout {
                node_indices: vec![0],
                positions: vec![Vec2::new(0.0, -240.0)],
                bounds: ComponentBounds {
                    width: 100.0,
                    height: 50.0,
                },
                estimated_area: 5_000.0,
                is_isolated: false,
            },
            ComponentLayout {
                node_indices: vec![1, 2, 3, 5],
                positions: vec![
                    Vec2::new(0.0, 0.0),
                    Vec2::new(500.0, 0.0),
                    Vec2::new(-500.0, 0.0),
                    Vec2::new(0.0, 200.0),
                ],
                bounds: ComponentBounds {
                    width: 1_100.0,
                    height: 250.0,
                },
                estimated_area: 275_000.0,
                is_isolated: false,
            },
            ComponentLayout {
                node_indices: vec![4],
                positions: vec![Vec2::new(0.0, 400.0)],
                bounds: ComponentBounds {
                    width: 100.0,
                    height: 50.0,
                },
                estimated_area: 5_000.0,
                is_isolated: false,
            },
        ];
        let unchanged_core = clusters[1].positions.clone();

        orient_terminal_nodes(&prepared, &component, &mut clusters);

        assert_eq!(clusters[0].positions[0], Vec2::new(-240.0, 0.0));
        assert_eq!(clusters[1].positions, unchanged_core);
        assert_eq!(clusters[2].positions[0], Vec2::new(0.0, 400.0));
    }

    #[test]
    fn returns_empty_layout_for_empty_input() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: Vec::new(),
            edges: Vec::new(),
            params: None,
        });

        let response = compute_layout(&prepared);
        assert!(response.positions.is_empty());
        assert!(response.bounds.is_none());
        assert!(response.layout_hash.is_some());
    }

    #[test]
    fn handles_single_node_without_force_iteration() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: Some([0.0, 0.0]),
            nodes: vec![node("a", 120.0, 60.0)],
            edges: vec![edge("a", "a")],
            params: None,
        });

        let response = compute_layout(&prepared);
        let position = response.positions.get("a").expect("position should exist");
        assert_eq!(position.x, 0.0);
        assert_eq!(position.y, 0.0);

        let bounds = response.bounds.expect("bounds should exist");
        assert_eq!(bounds.width, 120.0);
        assert_eq!(bounds.height, 60.0);
    }

    #[test]
    fn drops_invalid_edges_and_merges_bidirectional_relationships() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![node("a", 100.0, 50.0), node("b", 100.0, 50.0)],
            edges: vec![
                edge("a", "b"),
                edge("b", "a"),
                edge("a", "missing"),
                LayoutEdgeInput {
                    id: Some("explicit".to_string()),
                    source: "b".to_string(),
                    target: "a".to_string(),
                    source_handle: None,
                    target_handle: None,
                    kind: Some(LayoutEdgeKind::TwoWay),
                },
            ],
            params: None,
        });

        assert_eq!(prepared.layout_edges.len(), 1);
        assert!(cache_key(&prepared).contains("\"source\":\"a\""));
    }

    #[test]
    fn separates_multiple_components_and_isolated_nodes() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 120.0, 70.0),
                node("b", 120.0, 70.0),
                node("c", 120.0, 70.0),
                node("d", 120.0, 70.0),
                node("e", 120.0, 70.0),
            ],
            edges: vec![edge("a", "b"), edge("c", "d")],
            params: None,
        });

        let response = compute_layout(&prepared);
        let isolated = response.positions.get("e").expect("position should exist");
        let connected = response.positions.get("a").expect("position should exist");

        assert_eq!(response.positions.len(), 5);
        assert!(isolated.y >= connected.y);
    }

    #[test]
    fn keeps_results_deterministic_across_runs() {
        let request = LayoutRequest {
            node_origin: Some([0.5, 0.5]),
            nodes: vec![
                node("a", 100.0, 100.0),
                node("b", 100.0, 100.0),
                node("c", 100.0, 100.0),
            ],
            edges: vec![edge("a", "b"), edge("b", "c"), edge("c", "a")],
            params: None,
        };

        let first = compute_layout(&prepare_request(request.clone()));
        let second = compute_layout(&prepare_request(request));

        assert_eq!(first, second);
    }

    #[test]
    fn applies_node_origin_conversion() {
        let request = LayoutRequest {
            node_origin: Some([0.5, 0.5]),
            nodes: vec![node("a", 80.0, 40.0)],
            edges: Vec::new(),
            params: None,
        };

        let response = compute_layout(&prepare_request(request));
        let position = response.positions.get("a").expect("position should exist");
        assert_eq!(position.x, 40.0);
        assert_eq!(position.y, 20.0);
    }

    #[test]
    fn caches_layout_by_normalized_input() {
        let request = LayoutRequest {
            node_origin: None,
            nodes: vec![node("a", 90.0, 90.0), node("b", 90.0, 90.0)],
            edges: vec![edge("a", "b")],
            params: None,
        };
        let prepared = prepare_request(request);
        let key = cache_key(&prepared).to_string();
        let response = compute_layout(&prepared);

        let mut cache = LayoutCache::new(1);
        cache.put(key.clone(), response.clone());
        let cached = cache.get(&key).expect("cached response should exist");

        assert_eq!(cached, response);
    }

    #[test]
    fn compacts_line_like_components_along_principal_axis() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 48.0, 48.0),
                node("b", 48.0, 48.0),
                node("c", 48.0, 48.0),
                node("d", 48.0, 48.0),
            ],
            edges: vec![edge("a", "b"), edge("b", "c"), edge("c", "d")],
            params: None,
        });
        let component_nodes = vec![0usize, 1, 2, 3];
        let local_edges = vec![
            super::LocalEdgeLayout {
                source: 0,
                target: 1,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
            super::LocalEdgeLayout {
                source: 1,
                target: 2,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
            super::LocalEdgeLayout {
                source: 2,
                target: 3,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
        ];
        let topology = build_local_topology(component_nodes.len(), &local_edges);
        let mut positions = vec![
            Vec2::new(-240.0, -240.0),
            Vec2::new(-80.0, -80.0),
            Vec2::new(80.0, 80.0),
            Vec2::new(240.0, 240.0),
        ];
        let (centroid, major_axis, _) =
            principal_axis_signature(&positions, prepared.resolved_params.min_distance)
                .expect("signature should exist");
        let before_extent = positions
            .iter()
            .map(|position| (*position - centroid).dot(major_axis).abs())
            .fold(0.0_f64, f64::max);

        compact_component_shape(
            &prepared,
            &component_nodes,
            &mut positions,
            42,
            &topology,
            &compaction_params(),
        );

        let (centroid, major_axis, _) =
            principal_axis_signature(&positions, prepared.resolved_params.min_distance)
                .expect("signature should exist");
        let after_extent = positions
            .iter()
            .map(|position| (*position - centroid).dot(major_axis).abs())
            .fold(0.0_f64, f64::max);

        assert!(after_extent < before_extent);
        assert!(after_extent < 220.0);
    }

    #[test]
    fn compacts_elongated_components_without_pathish_score() {
        let mut prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 48.0, 48.0),
                node("b", 48.0, 48.0),
                node("c", 48.0, 48.0),
                node("d", 48.0, 48.0),
            ],
            edges: vec![edge("a", "b"), edge("b", "c"), edge("c", "d")],
            params: None,
        });
        let component_nodes = vec![0usize, 1, 2, 3];
        let local_edges = vec![
            super::LocalEdgeLayout {
                source: 0,
                target: 1,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
            super::LocalEdgeLayout {
                source: 1,
                target: 2,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
            super::LocalEdgeLayout {
                source: 2,
                target: 3,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
        ];
        let topology = build_local_topology(component_nodes.len(), &local_edges);
        // pathish 四项强度全零：只有长宽比兜底能驱动压实
        let zero_pathish = ComponentLayoutParams {
            axis_compaction_strength: 0.0,
            radial_pull_strength: 0.0,
            leaf_pull_strength: 0.0,
            branch_smoothing_strength: 0.0,
            ..compaction_params()
        };
        let diagonal_line = vec![
            Vec2::new(-240.0, -240.0),
            Vec2::new(-80.0, -80.0),
            Vec2::new(80.0, 80.0),
            Vec2::new(240.0, 240.0),
        ];

        // 对照：触发阈值调到不可达 → 早退，位置完全不变
        prepared.resolved_params.aspect_compaction_trigger = 1000.0;
        let mut untouched = diagonal_line.clone();
        compact_component_shape(
            &prepared,
            &component_nodes,
            &mut untouched,
            42,
            &topology,
            &zero_pathish,
        );
        assert_eq!(untouched, diagonal_line);

        // 默认阈值：斜向瘦长分量沿主轴收缩
        prepared.resolved_params.aspect_compaction_trigger = 1.6;
        let mut positions = diagonal_line.clone();
        let (centroid, major_axis, _) =
            principal_axis_signature(&positions, prepared.resolved_params.min_distance)
                .expect("signature should exist");
        let before_extent = positions
            .iter()
            .map(|position| (*position - centroid).dot(major_axis).abs())
            .fold(0.0_f64, f64::max);

        compact_component_shape(
            &prepared,
            &component_nodes,
            &mut positions,
            42,
            &topology,
            &zero_pathish,
        );

        let (centroid, major_axis, _) =
            principal_axis_signature(&positions, prepared.resolved_params.min_distance)
                .expect("signature should exist");
        let after_extent = positions
            .iter()
            .map(|position| (*position - centroid).dot(major_axis).abs())
            .fold(0.0_f64, f64::max);

        assert!(after_extent < before_extent * 0.6);
    }

    #[test]
    fn branch_tips_are_pulled_back_toward_component_center() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("core", 48.0, 48.0),
                node("mid", 48.0, 48.0),
                node("tip", 48.0, 48.0),
            ],
            edges: vec![edge("core", "mid"), edge("mid", "tip")],
            params: None,
        });
        let component_nodes = vec![0usize, 1, 2];
        let local_edges = vec![
            super::LocalEdgeLayout {
                source: 0,
                target: 1,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
            super::LocalEdgeLayout {
                source: 1,
                target: 2,
                target_length: 120.0,
                attraction_weight: 1.0,
            },
        ];
        let topology = build_local_topology(component_nodes.len(), &local_edges);
        let mut positions = vec![
            Vec2::new(0.0, 0.0),
            Vec2::new(120.0, 0.0),
            Vec2::new(420.0, 60.0),
        ];
        let before_tip_distance = positions[2].length();

        compact_component_shape(
            &prepared,
            &component_nodes,
            &mut positions,
            99,
            &topology,
            &compaction_params(),
        );

        let after_tip_distance = positions[2].length();
        assert!(after_tip_distance < before_tip_distance);
    }

    #[test]
    fn avoids_visible_node_overlap() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 180.0, 120.0),
                node("b", 180.0, 120.0),
                node("c", 180.0, 120.0),
                node("d", 180.0, 120.0),
            ],
            edges: vec![edge("a", "b"), edge("b", "c"), edge("c", "d")],
            params: None,
        });

        let response = compute_layout(&prepared);
        let centers = prepared
            .nodes
            .iter()
            .map(|node| {
                let position = response
                    .positions
                    .get(&node.id)
                    .expect("position should exist");
                (
                    node,
                    (
                        position.x + node.width * 0.5,
                        position.y + node.height * 0.5,
                    ),
                )
            })
            .collect::<Vec<_>>();

        for left in 0..centers.len() {
            for right in (left + 1)..centers.len() {
                let left_radius =
                    (centers[left].0.width.max(centers[left].0.height) * 0.5) + COLLISION_PADDING;
                let right_radius =
                    (centers[right].0.width.max(centers[right].0.height) * 0.5) + COLLISION_PADDING;
                let dx = centers[left].1.0 - centers[right].1.0;
                let dy = centers[left].1.1 - centers[right].1.1;
                let distance = (dx * dx + dy * dy).sqrt();

                assert!(distance + 1e-6 >= left_radius + right_radius);
            }
        }
    }

    fn distance_to_segment(point: Vec2, start: Vec2, end: Vec2) -> f64 {
        let edge = end - start;
        let length_squared = edge.dot(edge);
        if length_squared <= 1e-12 {
            return (point - start).length();
        }

        let t = ((point - start).dot(edge) / length_squared).clamp(0.0, 1.0);
        (point - (start + edge * t)).length()
    }

    fn edge_clearance_violation_count(
        prepared: &super::PreparedLayoutRequest,
        response: &crate::layout::types::LayoutResponse,
        clearance_ratio: f64,
    ) -> usize {
        let centers = prepared
            .nodes
            .iter()
            .map(|node| {
                let position = response
                    .positions
                    .get(&node.id)
                    .expect("position should exist");
                Vec2::new(
                    position.x + node.width * 0.5,
                    position.y + node.height * 0.5,
                )
            })
            .collect::<Vec<_>>();
        let mut violations = 0usize;

        for edge in &prepared.layout_edges {
            for (slot, node) in prepared.nodes.iter().enumerate() {
                if slot == edge.source || slot == edge.target {
                    continue;
                }
                let clearance = (node.radius
                    * prepared.resolved_params.edge_clearance_radius_factor
                    + prepared.resolved_params.edge_clearance_margin)
                    * clearance_ratio;
                let distance =
                    distance_to_segment(centers[slot], centers[edge.source], centers[edge.target]);
                if distance < clearance {
                    violations += 1;
                }
            }
        }

        violations
    }

    #[test]
    fn pushes_node_out_of_edge_clearance() {
        let mut prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 40.0, 40.0),
                node("b", 40.0, 40.0),
                node("c", 40.0, 40.0),
            ],
            edges: vec![edge("a", "b")],
            params: None,
        });
        prepared.resolved_params.edge_clearance_margin = 8.0;
        prepared.resolved_params.edge_clearance_radius_factor = 0.7;
        prepared.resolved_params.edge_clearance_strength = 0.5;
        let component_nodes = vec![0usize, 1, 2];
        let local_edges = vec![(0usize, 1usize)];
        // c 恰在线段上，覆盖退化方向的确定性法线回退。
        let mut positions = vec![
            Vec2::new(-200.0, 0.0),
            Vec2::new(200.0, 0.0),
            Vec2::new(0.0, 0.0),
        ];

        let moved = super::resolve_edge_clearance(
            &prepared,
            &component_nodes,
            &local_edges,
            &mut positions,
            42,
            6,
        );

        let clearance = prepared.nodes[2].radius
            * prepared.resolved_params.edge_clearance_radius_factor
            + prepared.resolved_params.edge_clearance_margin;
        let distance = distance_to_segment(positions[2], positions[0], positions[1]);
        assert!(moved);
        assert!(
            positions
                .iter()
                .all(|position| position.x.is_finite() && position.y.is_finite())
        );
        assert!(
            distance >= clearance - 0.5,
            "distance={distance}, clearance={clearance}"
        );
    }

    #[test]
    fn zero_edge_clearance_passes_leave_positions_unchanged() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("a", 40.0, 40.0),
                node("b", 40.0, 40.0),
                node("c", 40.0, 40.0),
            ],
            edges: vec![edge("a", "b")],
            params: None,
        });
        let component_nodes = vec![0usize, 1, 2];
        let local_edges = vec![(0usize, 1usize)];
        let original = vec![
            Vec2::new(-200.0, 0.0),
            Vec2::new(200.0, 0.0),
            Vec2::new(0.0, 0.0),
        ];
        let mut positions = original.clone();

        let moved = super::resolve_edge_clearance(
            &prepared,
            &component_nodes,
            &local_edges,
            &mut positions,
            42,
            0,
        );

        assert!(!moved);
        assert_eq!(positions, original);
    }

    #[test]
    fn final_layout_keeps_non_endpoint_nodes_clear_of_edges() {
        let request = LayoutRequest {
            node_origin: None,
            nodes: vec![
                node("hub", 48.0, 48.0),
                node("leaf-1", 48.0, 48.0),
                node("leaf-2", 48.0, 48.0),
                node("leaf-3", 48.0, 48.0),
                node("leaf-4", 48.0, 48.0),
                node("leaf-5", 48.0, 48.0),
                node("chain-1", 48.0, 48.0),
                node("chain-2", 48.0, 48.0),
                node("chain-3", 48.0, 48.0),
            ],
            edges: vec![
                edge("hub", "leaf-1"),
                edge("hub", "leaf-2"),
                edge("hub", "leaf-3"),
                edge("hub", "leaf-4"),
                edge("hub", "leaf-5"),
                edge("leaf-1", "chain-1"),
                edge("chain-1", "chain-2"),
                edge("chain-2", "chain-3"),
            ],
            params: None,
        };

        let mut disabled = prepare_request(request.clone());
        disabled.resolved_params.edge_clearance_passes = 0;
        let disabled_response = compute_layout(&disabled);
        assert!(edge_clearance_violation_count(&disabled, &disabled_response, 0.9) > 0);

        let prepared = prepare_request(request);
        let response = compute_layout(&prepared);
        assert_eq!(edge_clearance_violation_count(&prepared, &response, 0.9), 0);
    }
}
