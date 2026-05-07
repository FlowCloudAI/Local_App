import type {
    MapPreviewKeyLocation,
    MapPreviewScene,
    MapPreviewShape,
    MapRgbaColor,
    MapShapeEditorApi,
    MapShapeSaveRequest,
    MapShapeSaveResponse,
    MapShapeSubmitErrorKind,
} from './types';
import {MAP_SHAPE_PROTOCOL_VERSION as PROTOCOL_VERSION} from './types';

const SHAPE_FILL_PALETTE: MapRgbaColor[] = [
    [55, 138, 221, 88],
    [99, 153, 34, 88],
    [232, 113, 26, 88],
    [124, 92, 232, 88],
];

const SHAPE_LINE_PALETTE: MapRgbaColor[] = [
    [24, 95, 165, 255],
    [66, 104, 21, 255],
    [170, 78, 12, 255],
    [80, 56, 176, 255],
];

const LOCATION_COLOR_PALETTE: Record<string, MapRgbaColor> = {
    '出入口': [226, 75, 74, 255],
    '补给点': [99, 153, 34, 255],
    '观察点': [0, 163, 163, 255],
    '设备点': [124, 92, 232, 255],
};

function hexToRgbaColor(value: string | undefined, fallback: MapRgbaColor): MapRgbaColor {
    if (!value) return fallback;
    const normalized = value.trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback;

    const color = normalized.toLowerCase();
    return [
        Number.parseInt(color.slice(0, 2), 16),
        Number.parseInt(color.slice(2, 4), 16),
        Number.parseInt(color.slice(4, 6), 16),
        fallback[3],
    ];
}

function buildPreviewShapes(request: MapShapeSaveRequest): MapPreviewShape[] {
    return request.shapes.map((shape, index) => ({
        id: shape.id,
        name: shape.name,
        polygon: shape.vertices.map(vertex => [vertex.x, vertex.y] as [number, number]),
        fillColor: hexToRgbaColor(shape.fill, SHAPE_FILL_PALETTE[index % SHAPE_FILL_PALETTE.length]),
        lineColor: hexToRgbaColor(shape.stroke, SHAPE_LINE_PALETTE[index % SHAPE_LINE_PALETTE.length]),
        bizId: shape.bizId ?? null,
        kind: shape.kind ?? 'coastline',
        ext: shape.ext,
    }));
}

function buildPreviewKeyLocations(request: MapShapeSaveRequest): MapPreviewKeyLocation[] {
    return request.keyLocations.map(location => ({
        id: location.id,
        name: location.name,
        type: location.type,
        position: [location.x, location.y],
        shapeId: location.shapeId ?? null,
        color: LOCATION_COLOR_PALETTE[location.type] ?? [212, 48, 106, 255],
        bizId: location.bizId ?? null,
        ext: location.ext,
    }));
}

export function buildPreviewSceneFromDraft(request: MapShapeSaveRequest): MapPreviewScene {
    return {
        canvas: request.canvas,
        shapes: buildPreviewShapes(request),
        keyLocations: buildPreviewKeyLocations(request),
        ext: request.meta?.ext,
    };
}

export function createMockMapShapeEditorApi(options?: { delayMs?: number }): MapShapeEditorApi {
    const delayMs = Math.max(0, options?.delayMs ?? 320);

    return {
        async saveScene(request: MapShapeSaveRequest): Promise<MapShapeSaveResponse> {
            if (delayMs > 0) {
                await new Promise(resolve => {
                    window.setTimeout(resolve, delayMs);
                });
            }

            return {
                scene: buildPreviewSceneFromDraft(request),
                savedAt: new Date().toISOString(),
                message: '已通过 mock 接口同步到 deck 展示层。',
                meta: {
                    protocolVersion: request.meta?.protocolVersion ?? PROTOCOL_VERSION,
                    scenario: request.meta?.scenario ?? 'coastline_mvp',
                    requestId: request.meta?.requestId,
                    persisted: false,
                    ext: request.meta?.ext,
                },
            };
        },
    };
}

export const defaultMapShapeEditorApi = createMockMapShapeEditorApi();

export class MapShapeSubmitError extends Error {
    kind: MapShapeSubmitErrorKind;

    constructor(kind: MapShapeSubmitErrorKind, message: string) {
        super(message);
        this.name = 'MapShapeSubmitError';
        this.kind = kind;
    }
}

function isValidPreviewScene(value: unknown): value is MapPreviewScene {
    if (!value || typeof value !== 'object') return false;

    const scene = value as MapPreviewScene;
    return !!scene.canvas
        && Array.isArray(scene.shapes)
        && Array.isArray(scene.keyLocations);
}

function normalizeSaveResponse(value: unknown): MapShapeSaveResponse {
    if (!value || typeof value !== 'object') {
        throw new MapShapeSubmitError('invalid_response', '后端返回结构异常，无法解析地图结果。');
    }

    const response = value as Partial<MapShapeSaveResponse>;
    if (!isValidPreviewScene(response.scene) || typeof response.savedAt !== 'string') {
        throw new MapShapeSubmitError('invalid_response', '后端返回结构异常，缺少有效的 scene 或 savedAt 字段。');
    }

    return {
        scene: response.scene,
        savedAt: response.savedAt,
        message: response.message,
        meta: response.meta,
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timerId = window.setTimeout(() => {
            reject(new MapShapeSubmitError('timeout', `后端处理超时（>${timeoutMs}ms），请稍后重试。`));
        }, timeoutMs);

        promise
            .then(value => {
                window.clearTimeout(timerId);
                resolve(value);
            })
            .catch(error => {
                window.clearTimeout(timerId);
                reject(error);
            });
    });
}

export async function submitMapShapeScene(
    api: MapShapeEditorApi,
    request: MapShapeSaveRequest,
    options?: { timeoutMs?: number },
): Promise<MapShapeSaveResponse> {
    const timeoutMs = Math.max(1, options?.timeoutMs ?? 6000);

    try {
        const response = await withTimeout(api.saveScene(request), timeoutMs);
        return normalizeSaveResponse(response);
    } catch (error) {
        if (error instanceof MapShapeSubmitError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new MapShapeSubmitError('transport', `后端处理失败：${message}`);
    }
}
