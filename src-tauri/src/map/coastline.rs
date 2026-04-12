use crate::map::constants::{
    COASTLINE_AMPLITUDE_BASE, COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX, COASTLINE_AMPLITUDE_MIN,
    COASTLINE_DEDUPLICATE_DISTANCE_SQUARED, COASTLINE_FALLBACK_RELAX_PASSES,
    COASTLINE_FALLBACK_RELAX_WEIGHT, COASTLINE_MAX_SEGMENTS, COASTLINE_MIN_SEGMENTS,
    COASTLINE_NOISE_SALT_A, COASTLINE_NOISE_SALT_B, COASTLINE_NOISE_SALT_C,
    COASTLINE_NORMALIZED_LENGTH_MAX, COASTLINE_NORMALIZED_LENGTH_MIN, COASTLINE_RELAX_PASSES,
    COASTLINE_RELAX_WEIGHT, COASTLINE_SEGMENT_BASE, COASTLINE_SEGMENT_EDGE_RATIO_FACTOR,
    COASTLINE_SEGMENT_LENGTH_FACTOR, COASTLINE_WAVE_A_BASE, COASTLINE_WAVE_A_SPAN,
    COASTLINE_WAVE_A_WEIGHT, COASTLINE_WAVE_B_BASE, COASTLINE_WAVE_B_SPAN, COASTLINE_WAVE_B_WEIGHT,
    COASTLINE_WAVE_C_BASE, COASTLINE_WAVE_C_SPAN, COASTLINE_WAVE_C_WEIGHT, HASH_TEXT_OFFSET_BASIS,
    HASH_TEXT_PRIME, HASH_UNIT_INCREMENT, HASH_UNIT_MULTIPLIER, TAU,
};
use crate::map::geometry::{find_polygon_self_intersections, is_point_in_polygon};
use crate::map::types::{MapEditorCanvas, MapKeyLocationDraft, MapShapeDraft, MapShapeVertex};

pub fn build_natural_coastline_polygon(
    canvas: &MapEditorCanvas,
    shape: &MapShapeDraft,
    related_locations: &[MapKeyLocationDraft],
) -> Vec<[f64; 2]> {
    if shape.vertices.len() < 3 {
        return to_polygon(&shape.vertices);
    }

    let naturalized = naturalize_vertices(canvas, shape);
    if coastline_is_usable(&naturalized, related_locations) {
        return to_polygon(&naturalized);
    }

    let smoothed = relax_polygon(
        &shape.vertices,
        COASTLINE_FALLBACK_RELAX_PASSES,
        COASTLINE_FALLBACK_RELAX_WEIGHT,
    );
    if coastline_is_usable(&smoothed, related_locations) {
        return to_polygon(&smoothed);
    }

    to_polygon(&shape.vertices)
}

fn naturalize_vertices(canvas: &MapEditorCanvas, shape: &MapShapeDraft) -> Vec<MapShapeVertex> {
    let vertices = &shape.vertices;
    let perimeter = polygon_perimeter(vertices).max(1.0);
    let average_edge_length = perimeter / vertices.len() as f64;
    let canvas_scale = canvas.width.min(canvas.height).max(1.0);
    let outward_sign = if signed_area(vertices) >= 0.0 {
        -1.0
    } else {
        1.0
    };
    let seed = hash_text(&format!("{}:{}", shape.id, shape.name));

    let mut refined = Vec::new();
    refined.push(vertices[0].clone());

    for edge_index in 0..vertices.len() {
        let start = &vertices[edge_index];
        let end = &vertices[(edge_index + 1) % vertices.len()];
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let edge_length = (dx * dx + dy * dy).sqrt();
        if edge_length <= f64::EPSILON {
            continue;
        }

        let normalized_length = (edge_length / average_edge_length).clamp(
            COASTLINE_NORMALIZED_LENGTH_MIN,
            COASTLINE_NORMALIZED_LENGTH_MAX,
        );
        let segment_count = segment_count_for_edge(edge_length, perimeter, normalized_length);
        let amplitude = displacement_amplitude(edge_length, canvas_scale, normalized_length);
        let outward_normal = (
            outward_sign * dy / edge_length,
            outward_sign * -dx / edge_length,
        );

        for segment_index in 1..=segment_count {
            let t = segment_index as f64 / segment_count as f64;
            if segment_index == segment_count {
                refined.push(end.clone());
                continue;
            }

            let base_x = start.x + dx * t;
            let base_y = start.y + dy * t;
            let envelope = (std::f64::consts::PI * t).sin().powf(1.15);
            let signed_noise = layered_edge_noise(seed, edge_index, t);
            let offset = amplitude * envelope * signed_noise;

            refined.push(MapShapeVertex {
                id: format!("{}-coast-{}-{}", start.id, edge_index, segment_index),
                x: base_x + outward_normal.0 * offset,
                y: base_y + outward_normal.1 * offset,
            });
        }
    }

    let refined = dedupe_adjacent_vertices(refined);
    relax_polygon(&refined, COASTLINE_RELAX_PASSES, COASTLINE_RELAX_WEIGHT)
}

fn coastline_is_usable(
    vertices: &[MapShapeVertex],
    related_locations: &[MapKeyLocationDraft],
) -> bool {
    if vertices.len() < 3 {
        return false;
    }

    if !find_polygon_self_intersections(vertices).is_empty() {
        return false;
    }

    related_locations.iter().all(|location| {
        let point = MapShapeVertex {
            id: location.id.clone(),
            x: location.x,
            y: location.y,
        };
        is_point_in_polygon(&point, vertices)
    })
}

fn relax_polygon(vertices: &[MapShapeVertex], passes: usize, weight: f64) -> Vec<MapShapeVertex> {
    if vertices.len() < 3 {
        return vertices.to_vec();
    }

    let mut current = vertices.to_vec();
    for _ in 0..passes {
        let total = current.len();
        let mut next = Vec::with_capacity(total);
        for index in 0..total {
            let previous = &current[(index + total - 1) % total];
            let current_vertex = &current[index];
            let following = &current[(index + 1) % total];
            next.push(MapShapeVertex {
                id: current_vertex.id.clone(),
                x: current_vertex.x * (1.0 - weight * 2.0)
                    + previous.x * weight
                    + following.x * weight,
                y: current_vertex.y * (1.0 - weight * 2.0)
                    + previous.y * weight
                    + following.y * weight,
            });
        }
        current = next;
    }
    current
}

fn segment_count_for_edge(edge_length: f64, perimeter: f64, normalized_length: f64) -> usize {
    let edge_ratio = (edge_length / perimeter).clamp(0.02, 0.35);
    let desired = (COASTLINE_SEGMENT_BASE
        + normalized_length * COASTLINE_SEGMENT_LENGTH_FACTOR
        + edge_ratio * COASTLINE_SEGMENT_EDGE_RATIO_FACTOR)
        .round() as usize;
    desired.clamp(COASTLINE_MIN_SEGMENTS, COASTLINE_MAX_SEGMENTS)
}

fn displacement_amplitude(edge_length: f64, canvas_scale: f64, normalized_length: f64) -> f64 {
    let amplitude = edge_length * COASTLINE_AMPLITUDE_BASE * normalized_length.sqrt();
    amplitude.clamp(
        COASTLINE_AMPLITUDE_MIN,
        canvas_scale * COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX,
    )
}

fn polygon_perimeter(vertices: &[MapShapeVertex]) -> f64 {
    let mut perimeter = 0.0;
    for index in 0..vertices.len() {
        let start = &vertices[index];
        let end = &vertices[(index + 1) % vertices.len()];
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        perimeter += (dx * dx + dy * dy).sqrt();
    }
    perimeter
}

fn signed_area(vertices: &[MapShapeVertex]) -> f64 {
    let mut area = 0.0;
    for index in 0..vertices.len() {
        let current = &vertices[index];
        let next = &vertices[(index + 1) % vertices.len()];
        area += current.x * next.y - next.x * current.y;
    }
    area * 0.5
}

fn layered_edge_noise(seed: u64, edge_index: usize, t: f64) -> f64 {
    let phase_a = hash_unit(seed ^ (edge_index as u64 + 1).wrapping_mul(COASTLINE_NOISE_SALT_A));
    let phase_b = hash_unit(seed ^ (edge_index as u64 + 7).wrapping_mul(COASTLINE_NOISE_SALT_B));
    let phase_c = hash_unit(seed ^ (edge_index as u64 + 17).wrapping_mul(COASTLINE_NOISE_SALT_C));

    let wave_a =
        (TAU * (COASTLINE_WAVE_A_BASE + phase_a * COASTLINE_WAVE_A_SPAN) * t + phase_b * TAU).sin();
    let wave_b =
        (TAU * (COASTLINE_WAVE_B_BASE + phase_b * COASTLINE_WAVE_B_SPAN) * t + phase_c * TAU).sin();
    let wave_c =
        (TAU * (COASTLINE_WAVE_C_BASE + phase_c * COASTLINE_WAVE_C_SPAN) * t + phase_a * TAU).sin();

    (wave_a * COASTLINE_WAVE_A_WEIGHT
        + wave_b * COASTLINE_WAVE_B_WEIGHT
        + wave_c * COASTLINE_WAVE_C_WEIGHT)
        .clamp(-1.0, 1.0)
}

fn dedupe_adjacent_vertices(vertices: Vec<MapShapeVertex>) -> Vec<MapShapeVertex> {
    let mut deduped = Vec::new();
    for vertex in vertices {
        let should_push = deduped.last().is_none_or(|previous: &MapShapeVertex| {
            let dx = previous.x - vertex.x;
            let dy = previous.y - vertex.y;
            dx * dx + dy * dy > COASTLINE_DEDUPLICATE_DISTANCE_SQUARED
        });
        if should_push {
            deduped.push(vertex);
        }
    }

    if deduped.len() > 1 {
        let first = deduped.first().cloned();
        let last = deduped.last().cloned();
        if let (Some(first), Some(last)) = (first, last) {
            let dx = first.x - last.x;
            let dy = first.y - last.y;
            if dx * dx + dy * dy <= COASTLINE_DEDUPLICATE_DISTANCE_SQUARED {
                deduped.pop();
            }
        }
    }

    deduped
}

fn to_polygon(vertices: &[MapShapeVertex]) -> Vec<[f64; 2]> {
    vertices.iter().map(|vertex| [vertex.x, vertex.y]).collect()
}

fn hash_text(value: &str) -> u64 {
    let mut hash = HASH_TEXT_OFFSET_BASIS;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(HASH_TEXT_PRIME);
    }
    hash
}

fn hash_unit(seed: u64) -> f64 {
    let mixed = seed
        .wrapping_mul(HASH_UNIT_MULTIPLIER)
        .rotate_left(17)
        .wrapping_add(HASH_UNIT_INCREMENT);
    (mixed as f64) / (u64::MAX as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::types::{MapShapeKind, MapShapeVertex};

    fn vertex(id: &str, x: f64, y: f64) -> MapShapeVertex {
        MapShapeVertex {
            id: id.to_string(),
            x,
            y,
        }
    }

    fn build_shape() -> MapShapeDraft {
        MapShapeDraft {
            id: "shape-1".to_string(),
            name: "大陆".to_string(),
            vertices: vec![
                vertex("v1", 180.0, 120.0),
                vertex("v2", 420.0, 140.0),
                vertex("v3", 460.0, 340.0),
                vertex("v4", 220.0, 360.0),
            ],
            fill: None,
            stroke: None,
            biz_id: None,
            kind: Some(MapShapeKind::Coastline),
            ext: None,
        }
    }

    #[test]
    fn coastline_generation_adds_more_points() {
        let polygon = build_natural_coastline_polygon(
            &MapEditorCanvas {
                width: 1000.0,
                height: 640.0,
            },
            &build_shape(),
            &[],
        );

        assert!(polygon.len() > 4);
    }

    #[test]
    fn coastline_generation_keeps_key_location_inside() {
        let polygon = build_natural_coastline_polygon(
            &MapEditorCanvas {
                width: 1000.0,
                height: 640.0,
            },
            &build_shape(),
            &[MapKeyLocationDraft {
                id: "loc-1".to_string(),
                name: "主入口".to_string(),
                r#type: "入口".to_string(),
                x: 260.0,
                y: 180.0,
                shape_id: Some("shape-1".to_string()),
                biz_id: None,
                ext: None,
            }],
        );

        let vertices = polygon
            .iter()
            .enumerate()
            .map(|(index, point)| MapShapeVertex {
                id: format!("g-{index}"),
                x: point[0],
                y: point[1],
            })
            .collect::<Vec<_>>();

        assert!(find_polygon_self_intersections(&vertices).is_empty());
        assert!(is_point_in_polygon(
            &MapShapeVertex {
                id: "loc-1".to_string(),
                x: 260.0,
                y: 180.0,
            },
            &vertices
        ));
    }
}
