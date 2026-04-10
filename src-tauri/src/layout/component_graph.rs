use crate::layout::cluster::{ClusterEdgeRef, ConnectedComponentSpec};
use crate::layout::constants::FIXED_RANDOM_SEED;
use crate::layout::math::fnv64;
use crate::layout::prepare::PreparedLayoutRequest;
use crate::layout::topology::build_undirected_topology;
use std::collections::VecDeque;

pub(crate) fn split_connected_components(
    prepared: &PreparedLayoutRequest,
) -> Vec<ConnectedComponentSpec> {
    let adjacency = build_undirected_topology(
        prepared.nodes.len(),
        prepared
            .layout_edges
            .iter()
            .map(|edge| (edge.source, edge.target)),
    )
    .neighbors;
    let mut visited = vec![false; prepared.nodes.len()];
    let mut components = Vec::new();

    for start in 0..prepared.nodes.len() {
        if visited[start] {
            continue;
        }

        let mut queue = VecDeque::from([start]);
        let mut component_nodes = Vec::new();
        visited[start] = true;

        while let Some(current) = queue.pop_front() {
            component_nodes.push(current);

            for &neighbor in &adjacency[current] {
                if !visited[neighbor] {
                    visited[neighbor] = true;
                    queue.push_back(neighbor);
                }
            }
        }

        component_nodes.sort_unstable();
        let component_edges = prepared
            .layout_edges
            .iter()
            .filter(|edge| {
                component_nodes.binary_search(&edge.source).is_ok()
                    && component_nodes.binary_search(&edge.target).is_ok()
            })
            .map(|edge| ClusterEdgeRef {
                source: edge.source,
                target: edge.target,
                is_two_way: edge.is_two_way,
            })
            .collect::<Vec<_>>();
        let component_id = component_key_from_node_indices(prepared, &component_nodes);
        components.push(ConnectedComponentSpec {
            component_id,
            node_indices: component_nodes,
            edges: component_edges,
        });
    }

    components
}

pub(crate) fn component_key_from_node_indices(
    prepared: &PreparedLayoutRequest,
    node_indices: &[usize],
) -> String {
    node_indices
        .iter()
        .map(|&index| prepared.nodes[index].id.as_str())
        .collect::<Vec<_>>()
        .join("|")
}

pub(crate) fn component_seed(prepared: &PreparedLayoutRequest, component_nodes: &[usize]) -> u64 {
    let mut bytes = Vec::new();
    for &node_index in component_nodes {
        bytes.extend_from_slice(prepared.nodes[node_index].id.as_bytes());
        bytes.push(0x1f);
    }
    fnv64(bytes.as_slice()) ^ FIXED_RANDOM_SEED
}
