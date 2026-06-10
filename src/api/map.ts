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

/** v2 海岸线算法（全周长弧长参数化）参数，未提供字段走后端 COASTLINE_V2_* 默认值。
 * 波长/振幅均为绝对像素单位，与图形大小无关。 */
export interface CoastlineV2ParamsPayload {
    maxPoints?: number
    bandAWavelengthMin?: number
    bandAWavelengthMax?: number
    bandBWavelengthMin?: number
    bandBWavelengthMax?: number
    bandCWavelengthMin?: number
    bandCWavelengthMax?: number
    bandAAmplitude?: number
    bandBAmplitude?: number
    bandCAmplitude?: number
    bandAWeight?: number
    bandBWeight?: number
    bandCWeight?: number
    amplitudeScale?: number
    spectralBeta?: number
    cornerWindowPx?: number
    concaveCornerFactor?: number
    smoothPasses?: number
    taubinLambda?: number
    taubinMu?: number
}

export type CoastlineAlgorithm = 'v1' | 'v2'

export interface CoastlineParamsPayload {
    uiMode?: 'simple' | 'advanced'
    /** 海岸线算法选择：v1 逐边扰动（默认）/ v2 全周长噪声（实验）。 */
    algorithm?: CoastlineAlgorithm
    /** algorithm 为 v2 时生效的参数覆盖。 */
    v2?: CoastlineV2ParamsPayload
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
        coastlineAlgorithm?: CoastlineAlgorithm
        coastlineV2Params?: CoastlineV2ParamsPayload
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
        ext: coastlineParams
            ? {
                coastlineParams,
                ...(coastlineParams.algorithm === 'v2'
                    ? {coastlineAlgorithm: 'v2' as const, coastlineV2Params: coastlineParams.v2}
                    : {}),
            }
            : undefined,
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
