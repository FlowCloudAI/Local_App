use crate::layout::constants::{COLLISION_PADDING, HASH_FLOAT_SCALE, MIN_NODE_SIZE};
use crate::layout::math::fnv64_hex;
use crate::layout::types::{LayoutEdgeInput, LayoutEdgeKind, LayoutNodeInput, LayoutRequest};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Clone)]
pub struct PreparedLayoutRequest {
    pub(crate) node_origin: [f64; 2],
    pub(crate) nodes: Vec<LayoutNode>,
    pub(crate) layout_edges: Vec<LayoutEdge>,
    cache_key: String,
    pub(crate) layout_hash: String,
}

#[derive(Debug, Clone)]
pub(crate) struct LayoutNode {
    pub(crate) id: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) radius: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct LayoutEdge {
    pub(crate) source: usize,
    pub(crate) target: usize,
    pub(crate) is_two_way: bool,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedCacheInput {
    #[serde(rename = "nodeOrigin")]
    node_origin: [i64; 2],
    nodes: Vec<NormalizedNode>,
    edges: Vec<NormalizedEdge>,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedNode {
    id: String,
    width: i64,
    height: i64,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedEdge {
    id: Option<String>,
    source: String,
    target: String,
    #[serde(rename = "sourceHandle")]
    source_handle: Option<String>,
    #[serde(rename = "targetHandle")]
    target_handle: Option<String>,
    kind: Option<&'static str>,
}

#[derive(Debug, Default)]
struct PairFlags {
    explicit_two_way: bool,
    forward_one_way: bool,
    reverse_one_way: bool,
}

pub fn prepare_request(request: LayoutRequest) -> PreparedLayoutRequest {
    let node_origin = normalize_node_origin(request.node_origin);
    let normalized_nodes = normalize_nodes(request.nodes);
    let node_index_by_id = normalized_nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();

    let normalized_edges = normalize_edges(request.edges);
    let layout_edges = build_layout_edges(&normalized_edges, &node_index_by_id);

    let cache_input = NormalizedCacheInput {
        node_origin: [
            stabilize_float(node_origin[0]),
            stabilize_float(node_origin[1]),
        ],
        nodes: normalized_nodes
            .iter()
            .map(|node| NormalizedNode {
                id: node.id.clone(),
                width: stabilize_float(node.width),
                height: stabilize_float(node.height),
            })
            .collect(),
        edges: normalized_edges
            .iter()
            .map(|edge| NormalizedEdge {
                id: edge.id.clone(),
                source: edge.source.clone(),
                target: edge.target.clone(),
                source_handle: edge.source_handle.clone(),
                target_handle: edge.target_handle.clone(),
                kind: edge.kind.as_ref().map(kind_name),
            })
            .collect(),
    };

    let cache_key = serde_json::to_string(&cache_input)
        .expect("normalized cache input should always serialize");
    let layout_hash = fnv64_hex(cache_key.as_bytes());

    PreparedLayoutRequest {
        node_origin,
        nodes: normalized_nodes,
        layout_edges,
        cache_key,
        layout_hash,
    }
}

pub fn cache_key(prepared: &PreparedLayoutRequest) -> &str {
    &prepared.cache_key
}

fn normalize_nodes(nodes: Vec<LayoutNodeInput>) -> Vec<LayoutNode> {
    let mut ordered = nodes
        .into_iter()
        .enumerate()
        .map(|(original_index, node)| (original_index, node))
        .collect::<Vec<_>>();

    ordered.sort_by(|(left_index, left), (right_index, right)| {
        left.id
            .cmp(&right.id)
            .then_with(|| left_index.cmp(right_index))
    });

    let mut unique_ids = BTreeSet::new();
    let mut normalized = Vec::with_capacity(ordered.len());

    for (_, node) in ordered {
        if !unique_ids.insert(node.id.clone()) {
            continue;
        }

        let width = sanitize_dimension(node.width);
        let height = sanitize_dimension(node.height);

        normalized.push(LayoutNode {
            id: node.id,
            width,
            height,
            radius: (width.max(height) * 0.5) + COLLISION_PADDING,
        });
    }

    normalized
}

fn normalize_edges(edges: Vec<LayoutEdgeInput>) -> Vec<LayoutEdgeInput> {
    let mut ordered = edges
        .into_iter()
        .enumerate()
        .map(|(original_index, edge)| (original_index, edge))
        .collect::<Vec<_>>();

    ordered.sort_by(|(left_index, left), (right_index, right)| {
        left.source
            .cmp(&right.source)
            .then_with(|| left.target.cmp(&right.target))
            .then_with(|| left.source_handle.cmp(&right.source_handle))
            .then_with(|| left.target_handle.cmp(&right.target_handle))
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.id.cmp(&right.id))
            .then_with(|| left_index.cmp(right_index))
    });

    ordered.into_iter().map(|(_, edge)| edge).collect()
}

fn build_layout_edges(
    edges: &[LayoutEdgeInput],
    node_index_by_id: &HashMap<String, usize>,
) -> Vec<LayoutEdge> {
    let mut pair_flags = BTreeMap::<(usize, usize), PairFlags>::new();

    for edge in edges {
        let Some(&source_index) = node_index_by_id.get(&edge.source) else {
            continue;
        };
        let Some(&target_index) = node_index_by_id.get(&edge.target) else {
            continue;
        };

        if source_index == target_index {
            continue;
        }

        let pair = if source_index < target_index {
            (source_index, target_index)
        } else {
            (target_index, source_index)
        };

        let flags = pair_flags.entry(pair).or_default();

        match edge.kind {
            Some(LayoutEdgeKind::TwoWay) => flags.explicit_two_way = true,
            _ if source_index < target_index => flags.forward_one_way = true,
            _ => flags.reverse_one_way = true,
        }
    }

    pair_flags
        .into_iter()
        .map(|((source, target), flags)| LayoutEdge {
            source,
            target,
            is_two_way: flags.explicit_two_way || (flags.forward_one_way && flags.reverse_one_way),
        })
        .collect()
}

fn sanitize_dimension(value: f64) -> f64 {
    let sanitized = if value.is_finite() {
        value.abs()
    } else {
        MIN_NODE_SIZE
    };
    if sanitized < MIN_NODE_SIZE {
        MIN_NODE_SIZE
    } else {
        sanitized
    }
}

fn normalize_node_origin(node_origin: Option<[f64; 2]>) -> [f64; 2] {
    let [x, y] = node_origin.unwrap_or([0.0, 0.0]);
    [sanitize_origin_coordinate(x), sanitize_origin_coordinate(y)]
}

fn sanitize_origin_coordinate(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn stabilize_float(value: f64) -> i64 {
    let normalized = if value == 0.0 { 0.0 } else { value };
    (normalized * HASH_FLOAT_SCALE).round() as i64
}

fn kind_name(kind: &LayoutEdgeKind) -> &'static str {
    match kind {
        LayoutEdgeKind::OneWay => "one_way",
        LayoutEdgeKind::TwoWay => "two_way",
    }
}
