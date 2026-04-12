//! 确定性布局求解层。
//!
//! 设计依据：
//! - Fruchterman-Reingold (1991)：主循环严格使用经典吸引/斥力形式，
//!   `fa(d) = d^2 / k` 与 `fr(d) = k^2 / d`，温度负责位移截断与收敛。
//! - Graphviz overlap / pack：将“主布局”和“去重叠/分量摆放”分成独立层次处理。
//! - petgraph connected_components 文档：只把 petgraph 用于建图，不误用该 API 来收集成员，
//!   连通分量成员由本模块自行稳定遍历收集。

use crate::layout::cluster::{
    decompose_component, layout_cluster_graph, ClusterBox, ClusterPlacement, ConnectedComponentSpec,
};
use crate::layout::component_graph::{
    component_key_from_node_indices, component_seed, split_connected_components,
};
use crate::layout::constants::{
    ATTRACTIVE_DIRECTION_SALT, COLLISION_DIRECTION_SALT, COLLISION_PASSES_PER_ITERATION,
    COMPONENT_GAP, EARLY_STOP_STREAK, EARLY_STOP_THRESHOLD, FINAL_COLLISION_PASSES,
    FINAL_COLLISION_SALT, ISOLATED_NODE_HORIZONTAL_GAP, MIN_DISTANCE,
    POST_LAYOUT_COMPACTION_PASSES, SHELF_ROW_MAX_WIDTH,
};
use crate::layout::math::{deterministic_unit, safe_direction, unit_angle, Vec2};
use crate::layout::params::{build_adaptive_component_config, AdaptiveComponentConfig};
pub use crate::layout::prepare::{cache_key, prepare_request, PreparedLayoutRequest};
pub(crate) use crate::layout::prepare::{LayoutEdge, LayoutNode};
use crate::layout::topology::{build_undirected_topology, UndirectedTopology};
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
    let decomposition = decompose_component(component, &node_ids);

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
            );
            layout_component(prepared, &config)
        })
        .collect::<Vec<_>>();

    if cluster_layouts.len() == 1 {
        return cluster_layouts
            .pop()
            .expect("single-cluster component should yield one layout");
    }

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
    );

    log_cluster_stage(component, &decomposition, &cluster_boxes, &placement);
    assemble_cluster_component(prepared, component, cluster_layouts, &placement)
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

    for _ in 0..iteration_limit {
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
                    config.params.fr_scale * config.params.fr_scale / distance.max(MIN_DISTANCE);
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
                        ^ ATTRACTIVE_DIRECTION_SALT
                        ^ ((edge.source as u64) << 32)
                        ^ edge.target as u64,
                ),
            );
            let force = edge.attraction_weight * distance.max(MIN_DISTANCE).powi(2)
                / edge.target_length.max(MIN_DISTANCE);
            let movement = direction * force;
            displacements[edge.source] -= movement;
            displacements[edge.target] += movement;
        }

        let mut max_movement = 0.0_f64;

        for (slot, displacement) in displacements.iter().enumerate() {
            let magnitude = displacement.length();
            if magnitude <= MIN_DISTANCE {
                continue;
            }

            let limited =
                *displacement * (temperature.min(magnitude) / magnitude.max(MIN_DISTANCE));
            positions[slot] += limited;
            max_movement = max_movement.max(limited.length());
        }

        resolve_collisions(
            prepared,
            component_nodes,
            &mut positions,
            component_seed,
            COLLISION_PASSES_PER_ITERATION,
        );

        if temperature <= config.params.minimum_temperature * 1.4
            && max_movement < EARLY_STOP_THRESHOLD
        {
            early_stop_streak += 1;
            if early_stop_streak >= EARLY_STOP_STREAK {
                break;
            }
        } else {
            early_stop_streak = 0;
        }

        temperature =
            (temperature * config.params.temperature_decay).max(config.params.minimum_temperature);
    }

    resolve_collisions(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ FINAL_COLLISION_SALT,
        FINAL_COLLISION_PASSES,
    );
    compact_component_shape(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ FINAL_COLLISION_SALT,
        &topology,
        &config.params,
    );
    resolve_collisions(
        prepared,
        component_nodes,
        &mut positions,
        component_seed ^ FINAL_COLLISION_SALT ^ COLLISION_DIRECTION_SALT,
        FINAL_COLLISION_PASSES,
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
) {
    for _ in 0..passes {
        let mut any_overlap = false;

        for left in 0..component_nodes.len() {
            for right in (left + 1)..component_nodes.len() {
                let left_node = &prepared.nodes[component_nodes[left]];
                let right_node = &prepared.nodes[component_nodes[right]];
                let minimum_distance = left_node.radius + right_node.radius;
                let delta = positions[right] - positions[left];
                let distance = delta.length();

                if distance + MIN_DISTANCE >= minimum_distance {
                    continue;
                }

                let overlap = minimum_distance - distance;
                let direction = safe_direction(
                    delta,
                    deterministic_unit(
                        component_seed
                            ^ COLLISION_DIRECTION_SALT
                            ^ ((component_nodes[left] as u64) << 32)
                            ^ component_nodes[right] as u64,
                    ),
                );
                let shift = direction * (overlap * 0.54);
                positions[left] -= shift;
                positions[right] += shift;
                any_overlap = true;
            }
        }

        if !any_overlap {
            break;
        }
    }
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

    for _ in 0..POST_LAYOUT_COMPACTION_PASSES {
        let Some((centroid, major_axis, linearity)) = principal_axis_signature(positions) else {
            return;
        };
        let axis_strength =
            (params.axis_compaction_strength * (0.7 + 0.3 * linearity)).clamp(0.0, 0.42);
        let radial_strength =
            (params.radial_pull_strength * (0.65 + 0.35 * linearity)).clamp(0.0, 0.28);
        let branch_strength = params.branch_smoothing_strength.clamp(0.0, 0.32);
        let leaf_strength = params.leaf_pull_strength.clamp(0.0, 0.38);

        if axis_strength <= MIN_DISTANCE
            && radial_strength <= MIN_DISTANCE
            && branch_strength <= MIN_DISTANCE
            && leaf_strength <= MIN_DISTANCE
        {
            return;
        }

        if axis_strength > MIN_DISTANCE {
            for position in positions.iter_mut() {
                let relative = *position - centroid;
                let longitudinal = relative.dot(major_axis);
                let transverse = relative - (major_axis * longitudinal);
                *position =
                    centroid + (major_axis * (longitudinal * (1.0 - axis_strength))) + transverse;
            }
        }

        if radial_strength > MIN_DISTANCE {
            apply_radial_pull(positions, topology, centroid, radial_strength);
        }

        if branch_strength > MIN_DISTANCE || leaf_strength > MIN_DISTANCE {
            apply_branch_compaction(
                positions,
                topology,
                centroid,
                branch_strength,
                leaf_strength,
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
        if distance <= MIN_DISTANCE {
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
        let far_bias = ((distance / radial_mean.max(MIN_DISTANCE)) - 0.95).clamp(0.0, 1.2);
        let outward_bias =
            ((distance - neighbor_mean) / distance.max(MIN_DISTANCE)).clamp(0.0, 1.0);
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
            ((distance - neighbor_distance) / distance.max(MIN_DISTANCE)).clamp(0.0, 1.0);

        if degree <= 2 && branch_strength > MIN_DISTANCE {
            let target = neighbor_center + ((centroid - neighbor_center) * 0.18);
            let shift = (target - current)
                * branch_strength
                * (if degree == 1 { 0.95 } else { 0.72 })
                * (0.35 + 0.65 * outward_bias);
            positions[slot] += shift;
        }

        if degree == 1 && leaf_strength > MIN_DISTANCE {
            let target = (neighbor_center * 0.68) + (centroid * 0.32);
            let shift = (target - current) * leaf_strength * (0.45 + 0.55 * outward_bias);
            positions[slot] += shift;
        }
    }
}

fn principal_axis_signature(positions: &[Vec2]) -> Option<(Vec2, Vec2, f64)> {
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
    if trace <= MIN_DISTANCE {
        return None;
    }

    let delta = ((xx - yy) * (xx - yy) + 4.0 * xy * xy).sqrt();
    let major = ((trace + delta) * 0.5).max(MIN_DISTANCE);
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
    let main_bottom =
        place_component_group(prepared, &main_components, COMPONENT_GAP, 0.0, &mut placed);
    let isolated_start_y = if main_components.is_empty() {
        0.0
    } else {
        main_bottom + COMPONENT_GAP
    };

    let _ = place_component_group(
        prepared,
        &isolated_components,
        ISOLATED_NODE_HORIZONTAL_GAP,
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
    let mut cursor_x = 0.0;
    let mut cursor_y = start_y;
    let mut row_height = 0.0;

    for component in components {
        if cursor_x > 0.0 && cursor_x + component.bounds.width > SHELF_ROW_MAX_WIDTH {
            cursor_x = 0.0;
            cursor_y += row_height + COMPONENT_GAP;
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
        build_local_topology, cache_key, compact_component_shape, compute_layout, prepare_request,
        principal_axis_signature, Vec2,
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
    fn returns_empty_layout_for_empty_input() {
        let prepared = prepare_request(LayoutRequest {
            node_origin: None,
            nodes: Vec::new(),
            edges: Vec::new(),
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
            principal_axis_signature(&positions).expect("signature should exist");
        let before_extent = positions
            .iter()
            .map(|position| ((*position - centroid).dot(major_axis)).abs())
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
            principal_axis_signature(&positions).expect("signature should exist");
        let after_extent = positions
            .iter()
            .map(|position| ((*position - centroid).dot(major_axis)).abs())
            .fold(0.0_f64, f64::max);

        assert!(after_extent < before_extent);
        assert!(after_extent < 220.0);
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
}
