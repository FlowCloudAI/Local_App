import type {
    MapEditorCanvas,
    MapPreviewBackgroundImage,
    MapShapeSaveRequest,
    MapShapeSaveResponse,
} from '../features/maps/components/MapShapeEditor'
import {command} from './base'

export type MapBackgroundImagePayload = MapPreviewBackgroundImage

type MapShapeKind = 'coastline'
type MapProtocolVersion = 'map_shape_mvp_v1'
type MapScenario = 'coastline_mvp'

export interface CoastlineParamsPayload {
    uiMode?: 'simple' | 'advanced'
    qualityPreset?: 'preview' | 'rough' | 'balanced' | 'fine' | 'print'
    scaleFactor?: number
    macroNoise?: number
    midNoise?: number
    microNoise?: number
    minSegments?: number
    maxSegments?: number
    normalizedLengthMin?: number
    normalizedLengthMax?: number
    segmentBase?: number
    segmentLengthFactor?: number
    segmentEdgeRatioFactor?: number
    amplitudeBase?: number
    amplitudeMin?: number
    amplitudeCanvasRatioMax?: number
    relaxPasses?: number
    relaxWeight?: number
    fallbackRelaxPasses?: number
    fallbackRelaxWeight?: number
    deduplicateDistanceSquared?: number
    waveABase?: number
    waveASpan?: number
    waveBBase?: number
    waveBSpan?: number
    waveCBase?: number
    waveCSpan?: number
    waveAWeight?: number
    waveAStrength?: number
    waveBWeight?: number
    waveBStrength?: number
    waveCWeight?: number
    waveCStrength?: number
    noiseSaltA?: string | number
    noiseSaltB?: string | number
    noiseSaltC?: string | number
    hashTextOffsetBasis?: string | number
    hashTextPrime?: string | number
    hashUnitMultiplier?: string | number
    hashUnitIncrement?: string | number
}

interface MapSaveMetaPayload {
    protocolVersion: MapProtocolVersion
    scenario: MapScenario
    requestId: string
    ext?: {
        coastlineParams?: CoastlineParamsPayload
    }
}

type MapShapePayload = MapShapeSaveRequest['shapes'][number] & {
    kind: MapShapeKind
}

interface MapShapeSaveRequestPayload extends Omit<MapShapeSaveRequest, 'shapes'> {
    shapes: MapShapePayload[]
    meta: MapSaveMetaPayload
}

const createRequestId = () => `map-demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const normalizeMapSaveRequest = (
    request: MapShapeSaveRequest,
    coastlineParams?: CoastlineParamsPayload
): MapShapeSaveRequestPayload => ({
    ...request,
    shapes: request.shapes.map((shape) => ({
        ...shape,
        kind: 'coastline',
    })),
    meta: {
        protocolVersion: 'map_shape_mvp_v1',
        scenario: 'coastline_mvp',
        requestId: createRequestId(),
        ext: coastlineParams ? {coastlineParams} : undefined,
    },
})

export const map_save_scene = (request: MapShapeSaveRequest, coastlineParams?: CoastlineParamsPayload) =>
    command<MapShapeSaveResponse>('map_save_scene', {
        request: normalizeMapSaveRequest(request, coastlineParams),
    })

// ── 多地图持久化 ─────────────────────────────────────────────────────

export interface MapEntry {
    id: string
    name: string
    draftJson: string
    sceneJson: string | null
    coastlineParamsJson: string | null
    style: string
    canvas?: MapEditorCanvas | null
    renderer?: string | null
    /** data: URL 或 null */
    backgroundImageUrl: string | null
    createdAt: string
    updatedAt: string
}

export const map_list_project_maps = (projectId: string) =>
    command<MapEntry[]>('map_list_project_maps', {projectId})

/** 创建或更新地图条目。返回保存后的条目（含服务端分配的 id/时间戳）。 */
export const map_save_map_entry = (projectId: string, entry: MapEntry) =>
    command<MapEntry>('map_save_map_entry', {projectId, entry})

export const map_delete_map_entry = (projectId: string, mapId: string) =>
    command<void>('map_delete_map_entry', {projectId, mapId})
