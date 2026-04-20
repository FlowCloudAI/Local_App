import type {MapPreviewBackgroundImage, MapShapeSaveRequest, MapShapeSaveResponse} from 'flowcloudai-ui'
import {command} from './base'

export type MapBackgroundImagePayload = MapPreviewBackgroundImage

type MapShapeKind = 'coastline'
type MapProtocolVersion = 'map_shape_mvp_v1'
type MapScenario = 'coastline_mvp'

export interface CoastlineParamsPayload {
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
    waveBWeight?: number
    waveCWeight?: number
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
