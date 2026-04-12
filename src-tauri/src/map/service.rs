use crate::map::coastline::build_natural_coastline_polygon;
use crate::map::color::{location_color, shape_fill_color, shape_line_color};
use crate::map::constants::{
    DUPLICATE_VERTEX_DISTANCE, MIN_SHAPE_VERTEX_COUNT, MIN_VERTEX_DISTANCE, SECS_PER_DAY,
};
use crate::map::geometry::{
    find_polygon_self_intersections, get_distance_squared, is_point_in_polygon,
};
use crate::map::types::{
    MapEditorCanvas, MapKeyLocationDraft, MapPreviewKeyLocation, MapPreviewScene, MapPreviewShape,
    MapProtocolVersion, MapSaveMeta, MapScenario, MapShapeDraft, MapShapeFieldError, MapShapeKind,
    MapShapeSaveErrorResponse, MapShapeSaveRequest, MapShapeSaveResponse, MapShapeVertex,
};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub fn save_map_shape_scene(
    request: MapShapeSaveRequest,
) -> Result<MapShapeSaveResponse, MapShapeSaveErrorResponse> {
    let request_id = request
        .meta
        .as_ref()
        .and_then(|meta| meta.request_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    validate_request(&request, &request_id)?;

    let meta_ext = request.meta.as_ref().and_then(|meta| meta.ext.clone());

    let scene = MapPreviewScene {
        canvas: request.canvas.clone(),
        shapes: build_preview_shapes(&request.canvas, &request.shapes, &request.key_locations),
        key_locations: build_preview_key_locations(&request.key_locations),
        ext: None,
    };

    Ok(MapShapeSaveResponse {
        scene,
        saved_at: now_as_iso_utc(),
        message: Some("已按海岸线 MVP v1 完成后端计算，并同步 deck 展示场景。".to_string()),
        meta: Some(MapSaveMeta {
            protocol_version: Some(MapProtocolVersion::MapShapeMvpV1),
            scenario: Some(MapScenario::CoastlineMvp),
            request_id: Some(request_id),
            persisted: Some(false),
            ext: meta_ext,
        }),
    })
}

fn validate_request(
    request: &MapShapeSaveRequest,
    request_id: &str,
) -> Result<(), MapShapeSaveErrorResponse> {
    let mut field_errors = Vec::new();

    validate_canvas(&request.canvas, &mut field_errors);
    validate_meta(request.meta.as_ref(), &mut field_errors);
    validate_id_uniqueness(request, &mut field_errors);

    let shape_index = request
        .shapes
        .iter()
        .enumerate()
        .map(|(index, shape)| (shape.id.clone(), index))
        .collect::<HashMap<_, _>>();

    if request.shapes.is_empty() {
        field_errors.push(field_error(
            "shapes",
            "draft_no_shape",
            "当前至少需要一个合法图形后才能提交。",
        ));
    }

    for (shape_index_value, shape) in request.shapes.iter().enumerate() {
        validate_shape(shape, shape_index_value, &mut field_errors);
    }

    for (location_index, location) in request.key_locations.iter().enumerate() {
        validate_key_location(
            location,
            location_index,
            &request.shapes,
            &shape_index,
            &mut field_errors,
        );
    }

    if field_errors.is_empty() {
        Ok(())
    } else {
        Err(MapShapeSaveErrorResponse {
            code: "MAP_SHAPE_VALIDATION_FAILED".to_string(),
            message: "地图草稿校验失败，请根据字段提示修正后再提交。".to_string(),
            request_id: Some(request_id.to_string()),
            retryable: Some(false),
            field_errors: Some(field_errors),
            ext: None,
        })
    }
}

fn validate_canvas(canvas: &MapEditorCanvas, field_errors: &mut Vec<MapShapeFieldError>) {
    if !(canvas.width.is_finite() && canvas.width > 0.0) {
        field_errors.push(field_error(
            "canvas.width",
            "canvas_width_invalid",
            "编辑画布宽度必须是大于 0 的有效数字。",
        ));
    }
    if !(canvas.height.is_finite() && canvas.height > 0.0) {
        field_errors.push(field_error(
            "canvas.height",
            "canvas_height_invalid",
            "编辑画布高度必须是大于 0 的有效数字。",
        ));
    }
}

fn validate_meta(meta: Option<&MapSaveMeta>, field_errors: &mut Vec<MapShapeFieldError>) {
    let Some(meta) = meta else {
        return;
    };

    if let Some(protocol_version) = &meta.protocol_version {
        if protocol_version != &MapProtocolVersion::MapShapeMvpV1 {
            field_errors.push(field_error(
                "meta.protocolVersion",
                "protocol_version_unsupported",
                "当前后端仅支持 map_shape_mvp_v1 协议版本。",
            ));
        }
    }

    if let Some(scenario) = &meta.scenario {
        if scenario != &MapScenario::CoastlineMvp {
            field_errors.push(field_error(
                "meta.scenario",
                "scenario_unsupported",
                "当前后端仅支持 coastline_mvp 场景。",
            ));
        }
    }
}

fn validate_id_uniqueness(
    request: &MapShapeSaveRequest,
    field_errors: &mut Vec<MapShapeFieldError>,
) {
    push_duplicate_id_errors(
        request.shapes.iter().map(|shape| shape.id.as_str()),
        "shapes",
        "shape_id_duplicate",
        "图形 ID 不允许重复。",
        field_errors,
    );
    push_duplicate_id_errors(
        request
            .key_locations
            .iter()
            .map(|location| location.id.as_str()),
        "keyLocations",
        "key_location_id_duplicate",
        "关键地点 ID 不允许重复。",
        field_errors,
    );

    for (shape_index, shape) in request.shapes.iter().enumerate() {
        push_duplicate_id_errors(
            shape.vertices.iter().map(|vertex| vertex.id.as_str()),
            &format!("shapes[{shape_index}].vertices"),
            "vertex_id_duplicate",
            "同一图形内顶点 ID 不允许重复。",
            field_errors,
        );
    }
}

fn push_duplicate_id_errors<'a>(
    ids: impl Iterator<Item=&'a str>,
    field: &str,
    code: &str,
    message: &str,
    field_errors: &mut Vec<MapShapeFieldError>,
) {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.to_string()) {
            field_errors.push(field_error(field, code, message));
            break;
        }
    }
}

fn validate_shape(
    shape: &MapShapeDraft,
    shape_index: usize,
    field_errors: &mut Vec<MapShapeFieldError>,
) {
    if shape.id.trim().is_empty() {
        field_errors.push(field_error(
            &format!("shapes[{shape_index}].id"),
            "shape_id_required",
            "图形 ID 不能为空。",
        ));
    }

    if let Some(kind) = &shape.kind {
        if kind != &MapShapeKind::Coastline {
            field_errors.push(field_error(
                &format!("shapes[{shape_index}].kind"),
                "shape_kind_unsupported",
                "当前 MVP 仅支持 coastline 图形。",
            ));
        }
    }

    if shape.vertices.len() < MIN_SHAPE_VERTEX_COUNT {
        field_errors.push(field_error(
            &format!("shapes[{shape_index}].vertices"),
            "shape_too_few_vertices",
            &format!(
                "图形「{}」至少需要 {} 个点才能构成闭合图形。",
                safe_shape_name(shape),
                MIN_SHAPE_VERTEX_COUNT
            ),
        ));
    }

    for first_index in 0..shape.vertices.len() {
        for second_index in (first_index + 1)..shape.vertices.len() {
            let distance_squared =
                get_distance_squared(&shape.vertices[first_index], &shape.vertices[second_index]);

            if distance_squared <= DUPLICATE_VERTEX_DISTANCE * DUPLICATE_VERTEX_DISTANCE {
                field_errors.push(field_error(
                    &format!("shapes[{shape_index}].vertices"),
                    "shape_duplicate_vertices",
                    &format!(
                        "图形「{}」的第 {} 个点与第 {} 个点重复，请删除或移动其中一个点。",
                        safe_shape_name(shape),
                        first_index + 1,
                        second_index + 1
                    ),
                ));
                continue;
            }

            if distance_squared < MIN_VERTEX_DISTANCE * MIN_VERTEX_DISTANCE {
                field_errors.push(field_error(
                    &format!("shapes[{shape_index}].vertices"),
                    "shape_close_vertices",
                    &format!(
                        "图形「{}」的第 {} 个点与第 {} 个点过近，可能导致轮廓异常。",
                        safe_shape_name(shape),
                        first_index + 1,
                        second_index + 1
                    ),
                ));
            }
        }
    }

    let intersections = find_polygon_self_intersections(&shape.vertices);
    for intersection in intersections {
        field_errors.push(field_error(
            &format!("shapes[{shape_index}].vertices"),
            "shape_self_intersection",
            &format!(
                "图形「{}」的第 {} 条边与第 {} 条边相交，当前图形存在自交。",
                safe_shape_name(shape),
                intersection.first_edge_index + 1,
                intersection.second_edge_index + 1
            ),
        ));
    }
}

fn validate_key_location(
    location: &MapKeyLocationDraft,
    location_index: usize,
    shapes: &[MapShapeDraft],
    shape_index: &HashMap<String, usize>,
    field_errors: &mut Vec<MapShapeFieldError>,
) {
    let safe_name = safe_location_name(location);

    if location.id.trim().is_empty() {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].id"),
            "key_location_id_required",
            "关键地点 ID 不能为空。",
        ));
    }

    if location.name.trim().is_empty() {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].name"),
            "key_location_name_required",
            &format!("关键地点「{safe_name}」缺少名称。"),
        ));
    }

    if location.r#type.trim().is_empty() {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].type"),
            "key_location_type_required",
            &format!("关键地点「{safe_name}」缺少类型。"),
        ));
    }

    let Some(shape_id) = location.shape_id.as_deref() else {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].shapeId"),
            "key_location_shape_required",
            &format!("关键地点「{safe_name}」必须关联一个图形。"),
        ));
        return;
    };

    let Some(index) = shape_index.get(shape_id) else {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].shapeId"),
            "key_location_shape_missing",
            &format!("关键地点「{safe_name}」关联的图形不存在，请重新选择关联图形。"),
        ));
        return;
    };

    let related_shape = &shapes[*index];
    let point = MapShapeVertex {
        id: location.id.clone(),
        x: location.x,
        y: location.y,
    };
    if !is_point_in_polygon(&point, &related_shape.vertices) {
        field_errors.push(field_error(
            &format!("keyLocations[{location_index}].shapeId"),
            "key_location_outside_shape",
            &format!(
                "关键地点「{safe_name}」未落在关联图形「{}」内，请调整位置或关联关系。",
                safe_shape_name(related_shape)
            ),
        ));
    }
}

fn build_preview_shapes(
    canvas: &MapEditorCanvas,
    shapes: &[MapShapeDraft],
    key_locations: &[MapKeyLocationDraft],
) -> Vec<MapPreviewShape> {
    shapes
        .iter()
        .enumerate()
        .map(|(index, shape)| {
            let related_locations = key_locations
                .iter()
                .filter(|location| location.shape_id.as_deref() == Some(shape.id.as_str()))
                .cloned()
                .collect::<Vec<_>>();

            MapPreviewShape {
                id: shape.id.clone(),
                name: shape.name.clone(),
                polygon: build_natural_coastline_polygon(canvas, shape, &related_locations),
                fill_color: shape_fill_color(index, shape.fill.as_deref()),
                line_color: shape_line_color(index, shape.stroke.as_deref()),
                biz_id: shape.biz_id.clone(),
                kind: Some(shape.kind.clone().unwrap_or(MapShapeKind::Coastline)),
                ext: shape.ext.clone(),
            }
        })
        .collect()
}

fn build_preview_key_locations(
    key_locations: &[MapKeyLocationDraft],
) -> Vec<MapPreviewKeyLocation> {
    key_locations
        .iter()
        .map(|location| MapPreviewKeyLocation {
            id: location.id.clone(),
            name: location.name.clone(),
            r#type: location.r#type.clone(),
            position: [location.x, location.y],
            shape_id: location.shape_id.clone(),
            color: location_color(&location.r#type),
            biz_id: location.biz_id.clone(),
            ext: location.ext.clone(),
        })
        .collect()
}

fn field_error(field: &str, code: &str, message: &str) -> MapShapeFieldError {
    MapShapeFieldError {
        field: field.to_string(),
        code: code.to_string(),
        message: message.to_string(),
        ext: None,
    }
}

fn safe_shape_name(shape: &MapShapeDraft) -> &str {
    let trimmed = shape.name.trim();
    if trimmed.is_empty() {
        "未命名图形"
    } else {
        trimmed
    }
}

fn safe_location_name(location: &MapKeyLocationDraft) -> &str {
    let trimmed = location.name.trim();
    if trimmed.is_empty() {
        "未命名关键地点"
    } else {
        trimmed
    }
}

fn now_as_iso_utc() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let nanos = now.subsec_nanos();

    let days = secs.div_euclid(SECS_PER_DAY);
    let seconds_of_day = secs.rem_euclid(SECS_PER_DAY);

    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z",
        millis = nanos / 1_000_000
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::types::{MapEditorCanvas, MapShapeVertex};

    fn build_request() -> MapShapeSaveRequest {
        MapShapeSaveRequest {
            canvas: MapEditorCanvas {
                width: 1000.0,
                height: 640.0,
            },
            shapes: vec![MapShapeDraft {
                id: "shape-1".to_string(),
                name: "园区 A".to_string(),
                vertices: vec![
                    MapShapeVertex {
                        id: "v-1".to_string(),
                        x: 180.0,
                        y: 120.0,
                    },
                    MapShapeVertex {
                        id: "v-2".to_string(),
                        x: 420.0,
                        y: 140.0,
                    },
                    MapShapeVertex {
                        id: "v-3".to_string(),
                        x: 460.0,
                        y: 340.0,
                    },
                    MapShapeVertex {
                        id: "v-4".to_string(),
                        x: 220.0,
                        y: 360.0,
                    },
                ],
                fill: Some("#d8ecff".to_string()),
                stroke: Some("#185fa5".to_string()),
                biz_id: None,
                kind: Some(MapShapeKind::Coastline),
                ext: None,
            }],
            key_locations: vec![MapKeyLocationDraft {
                id: "loc-1".to_string(),
                name: "主入口".to_string(),
                r#type: "入口".to_string(),
                x: 260.0,
                y: 180.0,
                shape_id: Some("shape-1".to_string()),
                biz_id: None,
                ext: None,
            }],
            meta: Some(MapSaveMeta {
                protocol_version: Some(MapProtocolVersion::MapShapeMvpV1),
                scenario: Some(MapScenario::CoastlineMvp),
                request_id: Some("req-1".to_string()),
                persisted: None,
                ext: None,
            }),
        }
    }

    #[test]
    fn save_map_shape_scene_builds_preview_response() {
        let response = save_map_shape_scene(build_request()).expect("should succeed");
        assert_eq!(response.scene.shapes.len(), 1);
        assert_eq!(response.scene.key_locations.len(), 1);
        assert_eq!(response.scene.shapes[0].fill_color, [216, 236, 255, 88]);
        assert_eq!(response.scene.key_locations[0].color, [226, 75, 74, 255]);
        assert_eq!(
            response.meta.as_ref().and_then(|meta| meta.persisted),
            Some(false)
        );
    }

    #[test]
    fn save_map_shape_scene_rejects_invalid_key_location() {
        let mut request = build_request();
        request.key_locations[0].x = 50.0;
        request.key_locations[0].y = 50.0;

        let error = save_map_shape_scene(request).expect_err("should fail");
        assert_eq!(error.code, "MAP_SHAPE_VALIDATION_FAILED");
        assert!(
            error
                .field_errors
                .unwrap_or_default()
                .iter()
                .any(|item| item.code == "key_location_outside_shape")
        );
    }
}
