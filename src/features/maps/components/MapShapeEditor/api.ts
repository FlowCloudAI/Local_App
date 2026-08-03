import type {
    MapPreviewKeyLocation,
    MapPreviewScene,
    MapPreviewShape,
    MapRgbaColor,
    MapKeyLocationDraft,
    MapShapeDraft,
    MapShapeSaveRequest,
} from './types';

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

export function buildPreviewShapes(shapes: MapShapeDraft[]): MapPreviewShape[] {
    return shapes.map((shape, index) => ({
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

export function buildPreviewKeyLocations(keyLocations: MapKeyLocationDraft[]): MapPreviewKeyLocation[] {
    return keyLocations.map(location => ({
        id: location.id,
        name: location.name,
        type: location.type,
        position: [location.x, location.y],
        markerClass: location.markerClass ?? null,
        shapeId: location.shapeId ?? null,
        color: LOCATION_COLOR_PALETTE[location.type] ?? [212, 48, 106, 255],
        bizId: location.bizId ?? null,
        ext: location.ext,
    }));
}

export function buildPreviewSceneFromDraft(request: MapShapeSaveRequest): MapPreviewScene {
    return {
        canvas: request.canvas,
        shapes: buildPreviewShapes(request.shapes),
        keyLocations: buildPreviewKeyLocations(request.keyLocations),
        terrainStrokes: request.terrainStrokes ?? [],
        ext: request.meta?.ext,
    };
}
