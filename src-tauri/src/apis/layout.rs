use crate::layout::cache::LayoutCacheState;
use crate::layout::engine::{
    cache_key, compute_layout as compute_layout_response, prepare_request,
};
use crate::layout::types::{LayoutRequest, LayoutResponse};
use tauri::State;

#[tauri::command]
pub fn compute_layout(
    request: LayoutRequest,
    cache_state: State<'_, LayoutCacheState>,
) -> LayoutResponse {
    compute_layout_with_cache(&cache_state, request)
}

pub fn compute_layout_with_cache(
    cache_state: &LayoutCacheState,
    request: LayoutRequest,
) -> LayoutResponse {
    let prepared = prepare_request(request);
    let key = cache_key(&prepared).to_string();

    if let Some(cached) = cache_state.get(&key) {
        return cached;
    }

    let response = compute_layout_response(&prepared);
    cache_state.put(key, response.clone());
    response
}
