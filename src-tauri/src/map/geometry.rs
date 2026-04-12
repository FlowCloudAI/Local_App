use crate::map::constants::GEOMETRY_EPSILON;
use crate::map::types::MapShapeVertex;

#[derive(Debug, Clone, PartialEq)]
pub struct PolygonIntersection {
    pub first_edge_index: usize,
    pub second_edge_index: usize,
}

fn cross(a: &MapShapeVertex, b: &MapShapeVertex, c: &MapShapeVertex) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn is_between(value: f64, start: f64, end: f64) -> bool {
    value >= start.min(end) - GEOMETRY_EPSILON && value <= start.max(end) + GEOMETRY_EPSILON
}

pub fn get_distance_squared(first: &MapShapeVertex, second: &MapShapeVertex) -> f64 {
    let dx = first.x - second.x;
    let dy = first.y - second.y;
    dx * dx + dy * dy
}

pub fn is_point_on_segment(
    point: &MapShapeVertex,
    start: &MapShapeVertex,
    end: &MapShapeVertex,
) -> bool {
    cross(start, end, point).abs() <= GEOMETRY_EPSILON
        && is_between(point.x, start.x, end.x)
        && is_between(point.y, start.y, end.y)
}

pub fn segments_intersect(
    first_start: &MapShapeVertex,
    first_end: &MapShapeVertex,
    second_start: &MapShapeVertex,
    second_end: &MapShapeVertex,
) -> bool {
    let d1 = cross(first_start, first_end, second_start);
    let d2 = cross(first_start, first_end, second_end);
    let d3 = cross(second_start, second_end, first_start);
    let d4 = cross(second_start, second_end, first_end);

    if ((d1 > GEOMETRY_EPSILON && d2 < -GEOMETRY_EPSILON)
        || (d1 < -GEOMETRY_EPSILON && d2 > GEOMETRY_EPSILON))
        && ((d3 > GEOMETRY_EPSILON && d4 < -GEOMETRY_EPSILON)
        || (d3 < -GEOMETRY_EPSILON && d4 > GEOMETRY_EPSILON))
    {
        return true;
    }

    (d1.abs() <= GEOMETRY_EPSILON && is_point_on_segment(second_start, first_start, first_end))
        || (d2.abs() <= GEOMETRY_EPSILON && is_point_on_segment(second_end, first_start, first_end))
        || (d3.abs() <= GEOMETRY_EPSILON
        && is_point_on_segment(first_start, second_start, second_end))
        || (d4.abs() <= GEOMETRY_EPSILON
        && is_point_on_segment(first_end, second_start, second_end))
}

pub fn find_polygon_self_intersections(vertices: &[MapShapeVertex]) -> Vec<PolygonIntersection> {
    let total = vertices.len();
    let mut intersections = Vec::new();
    if total < 4 {
        return intersections;
    }

    for first_index in 0..total {
        let first_start = &vertices[first_index];
        let first_end = &vertices[(first_index + 1) % total];

        for second_index in (first_index + 1)..total {
            let is_same_edge = first_index == second_index;
            let is_adjacent = first_index.abs_diff(second_index) == 1
                || (first_index == 0 && second_index == total - 1);
            if is_same_edge || is_adjacent {
                continue;
            }

            let second_start = &vertices[second_index];
            let second_end = &vertices[(second_index + 1) % total];
            if segments_intersect(first_start, first_end, second_start, second_end) {
                intersections.push(PolygonIntersection {
                    first_edge_index: first_index,
                    second_edge_index: second_index,
                });
            }
        }
    }

    intersections
}

pub fn is_point_in_polygon(point: &MapShapeVertex, vertices: &[MapShapeVertex]) -> bool {
    if vertices.len() < 3 {
        return false;
    }

    let mut inside = false;
    let mut previous = vertices.len() - 1;
    for index in 0..vertices.len() {
        let current_vertex = &vertices[index];
        let previous_vertex = &vertices[previous];

        if is_point_on_segment(point, previous_vertex, current_vertex) {
            return true;
        }

        let intersects = (current_vertex.y > point.y) != (previous_vertex.y > point.y)
            && point.x
            < (previous_vertex.x - current_vertex.x) * (point.y - current_vertex.y)
            / (previous_vertex.y - current_vertex.y)
            + current_vertex.x;
        if intersects {
            inside = !inside;
        }

        previous = index;
    }

    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vertex(id: &str, x: f64, y: f64) -> MapShapeVertex {
        MapShapeVertex {
            id: id.to_string(),
            x,
            y,
        }
    }

    #[test]
    fn point_inside_polygon_returns_true() {
        let polygon = vec![
            vertex("v1", 0.0, 0.0),
            vertex("v2", 10.0, 0.0),
            vertex("v3", 10.0, 10.0),
            vertex("v4", 0.0, 10.0),
        ];
        let point = vertex("p", 5.0, 5.0);
        assert!(is_point_in_polygon(&point, &polygon));
    }

    #[test]
    fn point_on_edge_counts_as_inside() {
        let polygon = vec![
            vertex("v1", 0.0, 0.0),
            vertex("v2", 10.0, 0.0),
            vertex("v3", 10.0, 10.0),
            vertex("v4", 0.0, 10.0),
        ];
        let point = vertex("p", 10.0, 5.0);
        assert!(is_point_in_polygon(&point, &polygon));
    }

    #[test]
    fn detects_self_intersection() {
        let polygon = vec![
            vertex("v1", 0.0, 0.0),
            vertex("v2", 10.0, 10.0),
            vertex("v3", 0.0, 10.0),
            vertex("v4", 10.0, 0.0),
        ];
        let intersections = find_polygon_self_intersections(&polygon);
        assert_eq!(intersections.len(), 1);
        assert_eq!(intersections[0].first_edge_index, 0);
        assert_eq!(intersections[0].second_edge_index, 2);
    }
}
