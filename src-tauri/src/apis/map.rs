use crate::map::service::save_map_shape_scene;
use crate::map::types::{MapShapeSaveErrorResponse, MapShapeSaveRequest, MapShapeSaveResponse};

#[tauri::command]
pub fn map_save_scene(
    request: MapShapeSaveRequest,
) -> Result<MapShapeSaveResponse, MapShapeSaveErrorResponse> {
    save_map_shape_scene(request)
}
