use crate::map::constants::{
    COASTLINE_AMPLITUDE_BASE, COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX, COASTLINE_AMPLITUDE_MIN,
    COASTLINE_DEDUPLICATE_DISTANCE_SQUARED, COASTLINE_FALLBACK_RELAX_PASSES,
    COASTLINE_FALLBACK_RELAX_WEIGHT, COASTLINE_MAX_SEGMENTS, COASTLINE_MIN_SEGMENTS,
    COASTLINE_NOISE_SALT_A, COASTLINE_NOISE_SALT_B, COASTLINE_NOISE_SALT_C,
    COASTLINE_NORMALIZED_LENGTH_MAX, COASTLINE_NORMALIZED_LENGTH_MIN, COASTLINE_RELAX_PASSES,
    COASTLINE_RELAX_WEIGHT, COASTLINE_SEGMENT_BASE, COASTLINE_SEGMENT_EDGE_RATIO_FACTOR,
    COASTLINE_SEGMENT_LENGTH_FACTOR, COASTLINE_WAVE_A_BASE, COASTLINE_WAVE_A_SPAN,
    COASTLINE_WAVE_A_STRENGTH, COASTLINE_WAVE_A_WEIGHT, COASTLINE_WAVE_B_BASE,
    COASTLINE_WAVE_B_SPAN, COASTLINE_WAVE_B_STRENGTH, COASTLINE_WAVE_B_WEIGHT,
    COASTLINE_WAVE_C_BASE, COASTLINE_WAVE_C_SPAN, COASTLINE_WAVE_C_STRENGTH,
    COASTLINE_WAVE_C_WEIGHT, HASH_TEXT_OFFSET_BASIS, HASH_TEXT_PRIME, HASH_UNIT_INCREMENT,
    HASH_UNIT_MULTIPLIER, TAU,
};
use crate::map::geometry::{find_polygon_self_intersections, is_point_in_polygon};
use crate::map::types::{
    CoastlineParams, MapEditorCanvas, MapKeyLocationDraft, MapShapeDraft, MapShapeVertex,
};
use std::time::Instant;

const COASTLINE_EDGE_SAFE_OFFSET_FACTOR: f64 = 0.35;
const COASTLINE_NEAR_EDGE_SAFE_OFFSET_FACTOR: f64 = 0.38;
const COASTLINE_CORNER_SAFE_OFFSET_FACTOR: f64 = 0.75;
const COASTLINE_LOCATION_SAFE_OFFSET_FACTOR: f64 = 0.50;
const COASTLINE_CONCAVE_CORNER_FACTOR: f64 = 0.45;
const COASTLINE_SHARP_CORNER_FACTOR_MIN: f64 = 0.35;

macro_rules! param {
    ($params:expr, $field:ident, $default:expr) => {
        $params.and_then(|p| p.$field).unwrap_or($default)
    };
}

pub fn build_natural_coastline_polygon(
    canvas: &MapEditorCanvas,
    shape: &MapShapeDraft,
    related_locations: &[MapKeyLocationDraft],
    params: Option<&CoastlineParams>,
) -> Vec<[f64; 2]> {
    let started_at = Instant::now();
    log::info!(
        "开始海岸线计算：shape_id={}，name={}，原始顶点数={}，关联关键地点数={}",
        shape.id,
        shape.name,
        shape.vertices.len(),
        related_locations.len()
    );

    if shape.vertices.len() < 3 {
        log::warn!(
            "海岸线计算直接返回原始轮廓：shape_id={}，原因=顶点数不足，顶点数={}",
            shape.id,
            shape.vertices.len()
        );
        return to_polygon(&shape.vertices);
    }

    let naturalized = naturalize_vertices(canvas, shape, related_locations, params);
    if coastline_is_usable(&naturalized, related_locations) {
        log::info!(
            "海岸线计算成功：shape_id={}，分支=自然化，输出顶点数={}，耗时={}ms",
            shape.id,
            naturalized.len(),
            started_at.elapsed().as_millis()
        );
        return to_polygon(&naturalized);
    }

    let naturalized_intersections = find_polygon_self_intersections(&naturalized);
    if !naturalized_intersections.is_empty() {
        log::warn!(
            "海岸线自然化结果不可用：shape_id={}，原因=自交，交叉数={}，输出顶点数={}",
            shape.id,
            naturalized_intersections.len(),
            naturalized.len()
        );
    } else {
        let outside_count = related_locations
            .iter()
            .filter(|location| {
                let point = MapShapeVertex {
                    id: location.id.clone(),
                    x: location.x,
                    y: location.y,
                };
                !is_point_in_polygon(&point, &naturalized)
            })
            .count();
        if outside_count > 0 {
            log::warn!(
                "海岸线自然化结果不可用：shape_id={}，原因=关键地点落到轮廓外，数量={}",
                shape.id,
                outside_count
            );
        }
    }

    let smoothed = relax_polygon(
        &shape.vertices,
        param!(
            params,
            fallback_relax_passes,
            COASTLINE_FALLBACK_RELAX_PASSES
        ),
        param!(
            params,
            fallback_relax_weight,
            COASTLINE_FALLBACK_RELAX_WEIGHT
        ),
    );
    if coastline_is_usable(&smoothed, related_locations) {
        log::info!(
            "海岸线计算成功：shape_id={}，分支=回退平滑，输出顶点数={}，耗时={}ms",
            shape.id,
            smoothed.len(),
            started_at.elapsed().as_millis()
        );
        return to_polygon(&smoothed);
    }

    log::warn!(
        "海岸线计算失败并返回原始轮廓：shape_id={}，原始顶点数={}，耗时={}ms",
        shape.id,
        shape.vertices.len(),
        started_at.elapsed().as_millis()
    );
    to_polygon(&shape.vertices)
}

fn naturalize_vertices(
    canvas: &MapEditorCanvas,
    shape: &MapShapeDraft,
    related_locations: &[MapKeyLocationDraft],
    params: Option<&CoastlineParams>,
) -> Vec<MapShapeVertex> {
    let vertices = &shape.vertices;
    let perimeter = polygon_perimeter(vertices).max(1.0);
    let average_edge_length = perimeter / vertices.len() as f64;
    let canvas_scale = canvas.width.min(canvas.height).max(1.0);
    let outward_sign = if signed_area(vertices) >= 0.0 {
        -1.0
    } else {
        1.0
    };
    let seed = hash_text(&format!("{}:{}", shape.id, shape.name), params);

    let mut refined = Vec::new();
    refined.push(vertices[0].clone());

    let mut skipped_zero_length = 0usize;
    let mut constrained_offsets = 0usize;
    for edge_index in 0..vertices.len() {
        let start = &vertices[edge_index];
        let end = &vertices[(edge_index + 1) % vertices.len()];
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let edge_length = (dx * dx + dy * dy).sqrt();
        if edge_length <= f64::EPSILON {
            skipped_zero_length += 1;
            refined.push(end.clone());
            continue;
        }

        let normalized_length = (edge_length / average_edge_length).clamp(
            param!(
                params,
                normalized_length_min,
                COASTLINE_NORMALIZED_LENGTH_MIN
            ),
            param!(
                params,
                normalized_length_max,
                COASTLINE_NORMALIZED_LENGTH_MAX
            ),
        );
        let segment_count =
            segment_count_for_edge(edge_length, perimeter, normalized_length, params);
        let amplitude =
            displacement_amplitude(edge_length, canvas_scale, normalized_length, params);
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
            let signed_noise = layered_edge_noise(seed, edge_index, t, params);
            let requested_offset = amplitude * envelope * signed_noise;
            let offset = constrain_coastline_offset(
                vertices,
                related_locations,
                edge_index,
                base_x,
                base_y,
                edge_length,
                t,
                requested_offset,
            );
            if offset.abs() + f64::EPSILON < requested_offset.abs() {
                constrained_offsets += 1;
            }

            refined.push(MapShapeVertex {
                id: format!("{}-coast-{}-{}", start.id, edge_index, segment_index),
                x: base_x + outward_normal.0 * offset,
                y: base_y + outward_normal.1 * offset,
            });
        }
    }

    let raw_refined_len = refined.len();
    let refined = dedupe_adjacent_vertices(
        refined,
        param!(
            params,
            deduplicate_distance_squared,
            COASTLINE_DEDUPLICATE_DISTANCE_SQUARED
        ),
    );
    let relaxed = relax_polygon(
        &refined,
        param!(params, relax_passes, COASTLINE_RELAX_PASSES),
        param!(params, relax_weight, COASTLINE_RELAX_WEIGHT),
    );
    log::info!(
        "自然化细节：shape_id={}，原始顶点数={}，细分后顶点数={}，去重后顶点数={}，平滑后顶点数={}，跳过零长度边数={}",
        shape.id,
        vertices.len(),
        raw_refined_len,
        refined.len(),
        relaxed.len(),
        skipped_zero_length
    );
    if constrained_offsets > 0 {
        log::info!(
            "自然化安全约束：shape_id={}，受限位移点数={}，细分点数={}",
            shape.id,
            constrained_offsets,
            raw_refined_len
        );
    }
    relaxed
}

fn constrain_coastline_offset(
    vertices: &[MapShapeVertex],
    related_locations: &[MapKeyLocationDraft],
    edge_index: usize,
    base_x: f64,
    base_y: f64,
    edge_length: f64,
    t: f64,
    requested_offset: f64,
) -> f64 {
    if requested_offset.abs() <= f64::EPSILON || vertices.len() < 3 {
        return requested_offset;
    }

    let mut max_offset = edge_length * COASTLINE_EDGE_SAFE_OFFSET_FACTOR;
    let corner_distance = edge_length * t.min(1.0 - t);
    max_offset = max_offset.min(corner_distance * COASTLINE_CORNER_SAFE_OFFSET_FACTOR);
    max_offset *= edge_corner_offset_factor(vertices, edge_index, t);

    if let Some(distance) = nearest_non_adjacent_edge_distance(vertices, edge_index, base_x, base_y)
    {
        max_offset = max_offset.min(distance * COASTLINE_NEAR_EDGE_SAFE_OFFSET_FACTOR);
    }

    if let Some(distance) = nearest_related_location_distance(related_locations, base_x, base_y) {
        max_offset = max_offset.min(distance * COASTLINE_LOCATION_SAFE_OFFSET_FACTOR);
    }

    requested_offset.clamp(-max_offset.max(0.0), max_offset.max(0.0))
}

fn edge_corner_offset_factor(vertices: &[MapShapeVertex], edge_index: usize, t: f64) -> f64 {
    let total = vertices.len();
    if total < 3 {
        return 1.0;
    }

    let start_factor = vertex_corner_offset_factor(vertices, edge_index);
    let end_factor = vertex_corner_offset_factor(vertices, (edge_index + 1) % total);
    (start_factor * (1.0 - t) + end_factor * t).clamp(0.0, 1.0)
}

fn vertex_corner_offset_factor(vertices: &[MapShapeVertex], vertex_index: usize) -> f64 {
    let total = vertices.len();
    if total < 3 {
        return 1.0;
    }

    let previous = &vertices[(vertex_index + total - 1) % total];
    let current = &vertices[vertex_index];
    let next = &vertices[(vertex_index + 1) % total];
    let in_x = previous.x - current.x;
    let in_y = previous.y - current.y;
    let out_x = next.x - current.x;
    let out_y = next.y - current.y;
    let in_length = (in_x * in_x + in_y * in_y).sqrt();
    let out_length = (out_x * out_x + out_y * out_y).sqrt();
    if in_length <= f64::EPSILON || out_length <= f64::EPSILON {
        return COASTLINE_SHARP_CORNER_FACTOR_MIN;
    }

    let dot = ((in_x * out_x + in_y * out_y) / (in_length * out_length)).clamp(-1.0, 1.0);
    let angle = dot.acos();
    let sharp_factor = (angle / std::f64::consts::PI).clamp(COASTLINE_SHARP_CORNER_FACTOR_MIN, 1.0);

    let turn_cross = (current.x - previous.x) * (next.y - current.y)
        - (current.y - previous.y) * (next.x - current.x);
    let is_concave = turn_cross.signum() != signed_area(vertices).signum();
    if is_concave {
        sharp_factor * COASTLINE_CONCAVE_CORNER_FACTOR
    } else {
        sharp_factor
    }
}

fn nearest_non_adjacent_edge_distance(
    vertices: &[MapShapeVertex],
    edge_index: usize,
    x: f64,
    y: f64,
) -> Option<f64> {
    let total = vertices.len();
    if total < 4 {
        return None;
    }

    let previous_edge = (edge_index + total - 1) % total;
    let next_edge = (edge_index + 1) % total;
    let mut nearest: Option<f64> = None;

    for candidate_index in 0..total {
        if candidate_index == edge_index
            || candidate_index == previous_edge
            || candidate_index == next_edge
        {
            continue;
        }

        let start = &vertices[candidate_index];
        let end = &vertices[(candidate_index + 1) % total];
        let distance = point_to_segment_distance(x, y, start, end);
        nearest = Some(nearest.map_or(distance, |current| current.min(distance)));
    }

    nearest
}

fn nearest_related_location_distance(
    related_locations: &[MapKeyLocationDraft],
    x: f64,
    y: f64,
) -> Option<f64> {
    related_locations
        .iter()
        .map(|location| {
            let dx = location.x - x;
            let dy = location.y - y;
            (dx * dx + dy * dy).sqrt()
        })
        .reduce(f64::min)
}

fn point_to_segment_distance(x: f64, y: f64, start: &MapShapeVertex, end: &MapShapeVertex) -> f64 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length_squared = dx * dx + dy * dy;
    if length_squared <= f64::EPSILON {
        let px = x - start.x;
        let py = y - start.y;
        return (px * px + py * py).sqrt();
    }

    let t = (((x - start.x) * dx + (y - start.y) * dy) / length_squared).clamp(0.0, 1.0);
    let projected_x = start.x + dx * t;
    let projected_y = start.y + dy * t;
    let px = x - projected_x;
    let py = y - projected_y;
    (px * px + py * py).sqrt()
}

fn coastline_is_usable(
    vertices: &[MapShapeVertex],
    related_locations: &[MapKeyLocationDraft],
) -> bool {
    if vertices.len() < 3 {
        return false;
    }

    let intersections = find_polygon_self_intersections(vertices);
    if !intersections.is_empty() {
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
    if vertices.len() < 3 || passes == 0 {
        return vertices.to_vec();
    }

    let total = vertices.len();
    let mut a = vertices.to_vec();
    let mut b = Vec::with_capacity(total);
    let w2 = weight * 2.0;

    for _ in 0..passes {
        let source = &a;
        b.clear();
        for index in 0..total {
            let previous = &source[(index + total - 1) % total];
            let current_vertex = &source[index];
            let following = &source[(index + 1) % total];
            b.push(MapShapeVertex {
                id: current_vertex.id.clone(),
                x: current_vertex.x * (1.0 - w2) + previous.x * weight + following.x * weight,
                y: current_vertex.y * (1.0 - w2) + previous.y * weight + following.y * weight,
            });
        }
        std::mem::swap(&mut a, &mut b);
    }
    a
}

fn segment_count_for_edge(
    edge_length: f64,
    perimeter: f64,
    normalized_length: f64,
    params: Option<&CoastlineParams>,
) -> usize {
    let edge_ratio = (edge_length / perimeter).clamp(0.02, 0.35);
    let desired = (param!(params, segment_base, COASTLINE_SEGMENT_BASE)
        + normalized_length
            * param!(
                params,
                segment_length_factor,
                COASTLINE_SEGMENT_LENGTH_FACTOR
            )
        + edge_ratio
            * param!(
                params,
                segment_edge_ratio_factor,
                COASTLINE_SEGMENT_EDGE_RATIO_FACTOR
            ))
    .round() as usize;
    desired.clamp(
        param!(params, min_segments, COASTLINE_MIN_SEGMENTS).max(1),
        param!(params, max_segments, COASTLINE_MAX_SEGMENTS),
    )
}

fn displacement_amplitude(
    edge_length: f64,
    canvas_scale: f64,
    normalized_length: f64,
    params: Option<&CoastlineParams>,
) -> f64 {
    let amplitude = edge_length
        * param!(params, amplitude_base, COASTLINE_AMPLITUDE_BASE)
        * normalized_length.sqrt();
    amplitude.clamp(
        param!(params, amplitude_min, COASTLINE_AMPLITUDE_MIN),
        canvas_scale
            * param!(
                params,
                amplitude_canvas_ratio_max,
                COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX
            ),
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

fn layered_edge_noise(
    seed: u64,
    edge_index: usize,
    t: f64,
    params: Option<&CoastlineParams>,
) -> f64 {
    let phase_a = hash_unit(
        seed ^ (edge_index as u64 + 1).wrapping_mul(param!(
            params,
            noise_salt_a,
            COASTLINE_NOISE_SALT_A
        )),
        params,
    );
    let phase_b = hash_unit(
        seed ^ (edge_index as u64 + 7).wrapping_mul(param!(
            params,
            noise_salt_b,
            COASTLINE_NOISE_SALT_B
        )),
        params,
    );
    let phase_c = hash_unit(
        seed ^ (edge_index as u64 + 17).wrapping_mul(param!(
            params,
            noise_salt_c,
            COASTLINE_NOISE_SALT_C
        )),
        params,
    );

    let wave_a = (TAU
        * (param!(params, wave_a_base, COASTLINE_WAVE_A_BASE)
            + phase_a * param!(params, wave_a_span, COASTLINE_WAVE_A_SPAN))
        * t
        + phase_b * TAU)
        .sin();
    let wave_b = (TAU
        * (param!(params, wave_b_base, COASTLINE_WAVE_B_BASE)
            + phase_b * param!(params, wave_b_span, COASTLINE_WAVE_B_SPAN))
        * t
        + phase_c * TAU)
        .sin();
    let wave_c = (TAU
        * (param!(params, wave_c_base, COASTLINE_WAVE_C_BASE)
            + phase_c * param!(params, wave_c_span, COASTLINE_WAVE_C_SPAN))
        * t
        + phase_a * TAU)
        .sin();

    let w_a = param!(params, wave_a_weight, COASTLINE_WAVE_A_WEIGHT);
    let w_b = param!(params, wave_b_weight, COASTLINE_WAVE_B_WEIGHT);
    let w_c = param!(params, wave_c_weight, COASTLINE_WAVE_C_WEIGHT);
    let s_a = param!(params, wave_a_strength, COASTLINE_WAVE_A_STRENGTH);
    let s_b = param!(params, wave_b_strength, COASTLINE_WAVE_B_STRENGTH);
    let s_c = param!(params, wave_c_strength, COASTLINE_WAVE_C_STRENGTH);
    let total = w_a + w_b + w_c;
    (wave_a * w_a * s_a + wave_b * w_b * s_b + wave_c * w_c * s_c) / total.max(f64::EPSILON)
}

fn dedupe_adjacent_vertices(
    vertices: Vec<MapShapeVertex>,
    distance_squared: f64,
) -> Vec<MapShapeVertex> {
    if vertices.len() < 3 {
        return vertices;
    }

    let mut deduped = Vec::new();
    for vertex in &vertices {
        let should_push = deduped.last().is_none_or(|previous: &MapShapeVertex| {
            let dx = previous.x - vertex.x;
            let dy = previous.y - vertex.y;
            dx * dx + dy * dy > distance_squared
        });
        if should_push {
            deduped.push(vertex.clone());
        }
    }

    if deduped.len() > 1 {
        let first = deduped.first().cloned();
        let last = deduped.last().cloned();
        if let (Some(first), Some(last)) = (first, last) {
            let dx = first.x - last.x;
            let dy = first.y - last.y;
            if dx * dx + dy * dy <= distance_squared {
                deduped.pop();
            }
        }
    }

    if deduped.len() < 3 {
        return vertices;
    }
    deduped
}

fn to_polygon(vertices: &[MapShapeVertex]) -> Vec<[f64; 2]> {
    vertices.iter().map(|vertex| [vertex.x, vertex.y]).collect()
}

fn hash_text(value: &str, params: Option<&CoastlineParams>) -> u64 {
    let mut hash = param!(params, hash_text_offset_basis, HASH_TEXT_OFFSET_BASIS);
    let prime = param!(params, hash_text_prime, HASH_TEXT_PRIME);
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(prime);
    }
    hash
}

fn hash_unit(seed: u64, params: Option<&CoastlineParams>) -> f64 {
    let mixed = seed
        .wrapping_mul(param!(params, hash_unit_multiplier, HASH_UNIT_MULTIPLIER))
        .rotate_left(17)
        .wrapping_add(param!(params, hash_unit_increment, HASH_UNIT_INCREMENT));
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

    fn build_narrow_shape() -> MapShapeDraft {
        MapShapeDraft {
            id: "shape-narrow".to_string(),
            name: "狭湾大陆".to_string(),
            vertices: vec![
                vertex("n1", 100.0, 100.0),
                vertex("n2", 420.0, 100.0),
                vertex("n3", 420.0, 210.0),
                vertex("n4", 260.0, 210.0),
                vertex("n5", 260.0, 270.0),
                vertex("n6", 420.0, 270.0),
                vertex("n7", 420.0, 420.0),
                vertex("n8", 100.0, 420.0),
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
            None,
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
            None,
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

    #[test]
    fn coastline_wave_strength_can_disable_all_noise() {
        let params = CoastlineParams {
            wave_a_strength: Some(0.0),
            wave_b_strength: Some(0.0),
            wave_c_strength: Some(0.0),
            ..Default::default()
        };

        let noise = layered_edge_noise(42, 3, 0.37, Some(&params));

        assert!(noise.abs() <= f64::EPSILON);
    }

    #[test]
    fn safe_offset_caps_displacement_near_non_adjacent_edge() {
        let shape = build_narrow_shape();
        let offset =
            constrain_coastline_offset(&shape.vertices, &[], 3, 260.0, 240.0, 60.0, 0.5, 50.0);

        assert!(offset.abs() < 25.0);
    }

    #[test]
    fn concave_corner_reduces_edge_offset_budget() {
        let shape = build_narrow_shape();
        let concave_factor = vertex_corner_offset_factor(&shape.vertices, 3);
        let convex_factor = vertex_corner_offset_factor(&shape.vertices, 1);

        assert!(concave_factor < convex_factor);
        assert!(concave_factor < 0.3);
    }

    #[test]
    fn high_detail_coastline_uses_safe_offsets_for_narrow_shapes() {
        let shape = build_narrow_shape();
        let params = CoastlineParams {
            min_segments: Some(10),
            max_segments: Some(80),
            segment_base: Some(34.0),
            segment_length_factor: Some(18.0),
            segment_edge_ratio_factor: Some(42.0),
            amplitude_base: Some(1.6),
            amplitude_min: Some(4.0),
            amplitude_canvas_ratio_max: Some(0.08),
            relax_passes: Some(1),
            relax_weight: Some(0.08),
            wave_a_strength: Some(1.8),
            wave_b_strength: Some(1.8),
            wave_c_strength: Some(1.8),
            ..Default::default()
        };

        let polygon = build_natural_coastline_polygon(
            &MapEditorCanvas {
                width: 600.0,
                height: 600.0,
            },
            &shape,
            &[],
            Some(&params),
        );
        let vertices = polygon
            .iter()
            .enumerate()
            .map(|(index, point)| MapShapeVertex {
                id: format!("n-generated-{index}"),
                x: point[0],
                y: point[1],
            })
            .collect::<Vec<_>>();

        assert!(polygon.len() > shape.vertices.len());
        assert!(find_polygon_self_intersections(&vertices).is_empty());
    }
}
