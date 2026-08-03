/**
 * 在地图预览边界合并临时标记；只生成派生场景，不修改持久化场景数据。
 */
import type {MapPreviewKeyLocation, MapPreviewScene} from './types';

export function appendMapPreviewMarkers(
    scene: MapPreviewScene | null,
    markers?: readonly MapPreviewKeyLocation[],
): MapPreviewScene | null {
    if (!scene || !markers?.length) return scene;

    return {
        ...scene,
        keyLocations: [...scene.keyLocations, ...markers],
    };
}
