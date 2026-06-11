//! 海岸线 v2 算法的公开 API 集成测试。
//!
//! 放集成测试而非 lib 单元测试的原因：app_main 的 lib 测试二进制缺
//! common-controls v6 清单，加载即报 STATUS_ENTRYPOINT_NOT_FOUND；
//! 集成测试经 build.rs 的 `rustc-link-arg-tests` 嵌入清单后可正常运行。
//! 私有内部函数（谐波带、角点系数等）的单测保留在 coastline_v2.rs 模块内。

use app_lib::map::coastline_v2::build_natural_coastline_polygon_v2;
use app_lib::map::geometry::{find_polygon_self_intersections, is_point_in_polygon};
use app_lib::map::types::{
    MapEditorCanvas, MapKeyLocationDraft, MapShapeDraft, MapShapeKind, MapShapeVertex,
};

fn vertex(id: &str, x: f64, y: f64) -> MapShapeVertex {
    MapShapeVertex {
        id: id.to_string(),
        x,
        y,
    }
}

fn shape_with_vertices(vertices: Vec<MapShapeVertex>) -> MapShapeDraft {
    MapShapeDraft {
        id: "shape-v2".to_string(),
        name: "大陆".to_string(),
        vertices,
        fill: None,
        stroke: None,
        biz_id: None,
        kind: Some(MapShapeKind::Coastline),
        ext: None,
    }
}

fn square_shape() -> MapShapeDraft {
    shape_with_vertices(vec![
        vertex("v1", 100.0, 100.0),
        vertex("v2", 500.0, 100.0),
        vertex("v3", 500.0, 500.0),
        vertex("v4", 100.0, 500.0),
    ])
}

/// 与 square_shape 同一轮廓，但每条边插入了共线中点。
fn subdivided_square_shape() -> MapShapeDraft {
    shape_with_vertices(vec![
        vertex("v1", 100.0, 100.0),
        vertex("m1", 300.0, 100.0),
        vertex("v2", 500.0, 100.0),
        vertex("m2", 500.0, 300.0),
        vertex("v3", 500.0, 500.0),
        vertex("m3", 300.0, 500.0),
        vertex("v4", 100.0, 500.0),
        vertex("m4", 100.0, 300.0),
    ])
}

fn narrow_shape() -> MapShapeDraft {
    shape_with_vertices(vec![
        vertex("n1", 100.0, 100.0),
        vertex("n2", 420.0, 100.0),
        vertex("n3", 420.0, 210.0),
        vertex("n4", 260.0, 210.0),
        vertex("n5", 260.0, 270.0),
        vertex("n6", 420.0, 270.0),
        vertex("n7", 420.0, 420.0),
        vertex("n8", 100.0, 420.0),
    ])
}

fn canvas() -> MapEditorCanvas {
    MapEditorCanvas {
        width: 1000.0,
        height: 640.0,
    }
}

fn to_vertices(polygon: &[[f64; 2]]) -> Vec<MapShapeVertex> {
    polygon
        .iter()
        .enumerate()
        .map(|(index, point)| MapShapeVertex {
            id: format!("g-{index}"),
            x: point[0],
            y: point[1],
        })
        .collect()
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
    let px = x - (start.x + dx * t);
    let py = y - (start.y + dy * t);
    (px * px + py * py).sqrt()
}

fn directed_hausdorff(from: &[MapShapeVertex], to: &[MapShapeVertex]) -> f64 {
    let total = to.len();
    from.iter()
        .map(|point| {
            (0..total)
                .map(|index| {
                    point_to_segment_distance(point.x, point.y, &to[index], &to[(index + 1) % total])
                })
                .fold(f64::INFINITY, f64::min)
        })
        .fold(0.0f64, f64::max)
}

fn symmetric_hausdorff(a: &[MapShapeVertex], b: &[MapShapeVertex]) -> f64 {
    directed_hausdorff(a, b).max(directed_hausdorff(b, a))
}

#[test]
fn v2_adds_points_and_stays_valid() {
    let polygon = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);

    assert!(polygon.len() > 4);
    assert!(find_polygon_self_intersections(&to_vertices(&polygon)).is_empty());
}

#[test]
fn v2_is_deterministic() {
    let first = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);
    let second = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);

    assert_eq!(first, second);
}

/// 核心回归判据：插入共线顶点（形状不变）不得改变输出。
/// v1 的逐边参数化在此必然大幅失败；v2 的弧长参数化应通过。
#[test]
fn v2_vertex_insertion_invariance() {
    let coarse = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);
    let dense =
        build_natural_coastline_polygon_v2(&canvas(), &subdivided_square_shape(), &[], None);

    let distance = symmetric_hausdorff(&to_vertices(&coarse), &to_vertices(&dense));
    assert!(
        distance < 0.5,
        "顶点细分不变性被破坏：Hausdorff 距离 = {distance}"
    );
}

#[test]
fn v2_keeps_key_location_inside() {
    let location = MapKeyLocationDraft {
        id: "loc-1".to_string(),
        name: "主入口".to_string(),
        r#type: "入口".to_string(),
        x: 200.0,
        y: 180.0,
        shape_id: Some("shape-v2".to_string()),
        biz_id: None,
        ext: None,
    };
    let polygon = build_natural_coastline_polygon_v2(
        &canvas(),
        &square_shape(),
        std::slice::from_ref(&location),
        None,
    );
    let vertices = to_vertices(&polygon);

    assert!(find_polygon_self_intersections(&vertices).is_empty());
    assert!(is_point_in_polygon(
        &MapShapeVertex {
            id: "loc-1".to_string(),
            x: 200.0,
            y: 180.0,
        },
        &vertices
    ));
}

#[test]
fn v2_narrow_shape_stays_safe() {
    let polygon = build_natural_coastline_polygon_v2(&canvas(), &narrow_shape(), &[], None);

    assert!(polygon.len() > 8);
    assert!(find_polygon_self_intersections(&to_vertices(&polygon)).is_empty());
}

fn max_deviation_from_draft(shape: &MapShapeDraft) -> f64 {
    let polygon = build_natural_coastline_polygon_v2(&canvas(), shape, &[], None);
    let original = &shape.vertices;
    polygon
        .iter()
        .map(|point| {
            (0..original.len())
                .map(|index| {
                    point_to_segment_distance(
                        point[0],
                        point[1],
                        &original[index],
                        &original[(index + 1) % original.len()],
                    )
                })
                .fold(f64::INFINITY, f64::min)
        })
        .fold(0.0f64, f64::max)
}

/// 局部特征尺寸保形：同周长（1760）下，细长条（80px 宽）上宏观带自动熄火、
/// 偏离受限；宽阔方块腹地允许大湾——证明限幅跟随局部肢体宽度而非全局一刀切。
#[test]
fn v2_thin_limb_keeps_identity_while_wide_body_stays_bold() {
    let thin = shape_with_vertices(vec![
        vertex("l1", 100.0, 300.0),
        vertex("l2", 900.0, 300.0),
        vertex("l3", 900.0, 380.0),
        vertex("l4", 100.0, 380.0),
    ]);
    let square = shape_with_vertices(vec![
        vertex("s1", 100.0, 100.0),
        vertex("s2", 540.0, 100.0),
        vertex("s3", 540.0, 540.0),
        vertex("s4", 100.0, 540.0),
    ]);

    let thin_deviation = max_deviation_from_draft(&thin);
    let square_deviation = max_deviation_from_draft(&square);

    assert!(
        thin_deviation < 40.0,
        "细长条偏离草稿过大：{thin_deviation}"
    );
    assert!(
        square_deviation > thin_deviation + 15.0,
        "宽阔形状应保留更大宏观自由度：square={square_deviation} thin={thin_deviation}"
    );
}
