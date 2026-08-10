/* 词条地图绑定解析：从项目地图草稿反查首个关联地点，并构造只突出该地点的轻量预览。 */
import type {MapEntry} from '../../../api'
import {buildPreviewKeyLocations, buildPreviewSceneFromDraft, normalizeMapEditorDraft} from './MapShapeEditor/api.ts'
import type {
    MapKeyLocationDraft,
    MapPreviewKeyLocation,
    MapPreviewScene,
    MapShapeEditorDraft,
} from './MapShapeEditor/types.ts'

export interface EntryMapBinding {
    mapId: string
    mapName: string
    locationId: string
    locationName: string
    scene: MapPreviewScene
    marker: MapPreviewKeyLocation
}

export function findEntryMapBinding(maps: readonly MapEntry[], entryId: string): EntryMapBinding | null {
    for (const map of maps) {
        let draft: MapShapeEditorDraft
        try {
            draft = normalizeMapEditorDraft(JSON.parse(map.draftJson) as MapShapeEditorDraft)
        } catch {
            continue
        }
        if (!Array.isArray(draft.keyLocations)) continue

        const location = draft.keyLocations.find((item: MapKeyLocationDraft) => (
            item.ext?.linkedEntryId === entryId
        ))
        if (!location) continue

        const canvas = map.canvas ?? {width: 1000, height: 1000}
        let scene = buildPreviewSceneFromDraft({
            canvas,
            shapes: Array.isArray(draft.shapes) ? draft.shapes : [],
            keyLocations: [],
            terrainStrokes: Array.isArray(draft.terrainStrokes) ? draft.terrainStrokes : [],
        })
        try {
            const savedScene = map.sceneJson ? JSON.parse(map.sceneJson) as MapPreviewScene : null
            if (savedScene?.canvas && Array.isArray(savedScene.shapes)) {
                scene = {...savedScene, keyLocations: []}
            }
        } catch {
            // 场景快照损坏时仍可用草稿轮廓定位。
        }
        if (map.backgroundImageUrl) {
            scene.backgroundImage = {url: map.backgroundImageUrl, fit: 'cover'}
        }

        // ponytail: 当前展示首个绑定地点；出现一对多产品需求时再返回列表并提供切换。
        return {
            mapId: map.id,
            mapName: map.name,
            locationId: location.id,
            locationName: location.name,
            scene,
            marker: buildPreviewKeyLocations([location])[0],
        }
    }
    return null
}
