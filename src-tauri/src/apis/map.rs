use crate::map::service::save_map_shape_scene;
use crate::map::types::{MapShapeSaveErrorResponse, MapShapeSaveRequest, MapShapeSaveResponse};

#[tauri::command]
pub async fn map_save_scene(
    request: MapShapeSaveRequest,
) -> Result<MapShapeSaveResponse, MapShapeSaveErrorResponse> {
    // 海岸线生成是 O(S·N²) 的 CPU 密集工作（geometry::find_polygon_self_intersections 等）。
    // 原来是同步命令，直接跑在主线程上，大地图会让整个窗口假死数秒。
    // 放到阻塞线程池执行，保持事件循环/UI 响应（算法本身的 O(N²) 仍可后续用空间索引优化）。
    let request_id = request
        .meta
        .as_ref()
        .and_then(|meta| meta.request_id.clone());
    tokio::task::spawn_blocking(move || save_map_shape_scene(request))
        .await
        .unwrap_or_else(|join_err| {
            Err(MapShapeSaveErrorResponse {
                code: "internal".to_string(),
                message: format!("地图保存任务异常: {join_err}"),
                request_id,
                retryable: Some(true),
                field_errors: None,
                ext: None,
            })
        })
}
