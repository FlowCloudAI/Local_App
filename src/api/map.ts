import type {MapShapeSaveRequest, MapShapeSaveResponse} from 'flowcloudai-ui'
import {command} from './base'

type MapShapeKind = 'coastline'
type MapProtocolVersion = 'map_shape_mvp_v1'
type MapScenario = 'coastline_mvp'

interface MapSaveMetaPayload {
    protocolVersion: MapProtocolVersion
    scenario: MapScenario
    requestId: string
}

type MapShapePayload = MapShapeSaveRequest['shapes'][number] & {
    kind: MapShapeKind
}

interface MapShapeSaveRequestPayload extends Omit<MapShapeSaveRequest, 'shapes'> {
    shapes: MapShapePayload[]
    meta: MapSaveMetaPayload
}

const createRequestId = () => `map-demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const normalizeMapSaveRequest = (request: MapShapeSaveRequest): MapShapeSaveRequestPayload => ({
    ...request,
    shapes: request.shapes.map((shape) => ({
        ...shape,
        kind: 'coastline',
    })),
    meta: {
        protocolVersion: 'map_shape_mvp_v1',
        scenario: 'coastline_mvp',
        requestId: createRequestId(),
    },
})

export const map_save_scene = (request: MapShapeSaveRequest) =>
    command<MapShapeSaveResponse>('map_save_scene', {
        request: normalizeMapSaveRequest(request),
    })
