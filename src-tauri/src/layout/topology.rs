use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub(crate) struct UndirectedTopology {
    pub(crate) neighbors: Vec<Vec<usize>>,
    pub(crate) degrees: Vec<usize>,
}

pub(crate) fn build_undirected_topology<I>(node_count: usize, edges: I) -> UndirectedTopology
where
    I: IntoIterator<Item = (usize, usize)>,
{
    let mut neighbors = vec![Vec::<usize>::new(); node_count];

    for (source, target) in edges {
        neighbors[source].push(target);
        neighbors[target].push(source);
    }

    for node_neighbors in &mut neighbors {
        node_neighbors.sort_unstable();
        node_neighbors.dedup();
    }

    let degrees = neighbors.iter().map(Vec::len).collect::<Vec<_>>();
    UndirectedTopology { neighbors, degrees }
}

pub(crate) fn build_node_slot_map(component_nodes: &[usize]) -> BTreeMap<usize, usize> {
    component_nodes
        .iter()
        .enumerate()
        .map(|(slot, &node_index)| (node_index, slot))
        .collect::<BTreeMap<_, _>>()
}
