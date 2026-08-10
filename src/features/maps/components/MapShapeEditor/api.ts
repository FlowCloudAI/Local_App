import type {
    MapKeyLocationDraft,
    MapMarkerClass,
    MapPreviewKeyLocation,
    MapPreviewScene,
    MapPreviewShape,
    MapRgbaColor,
    MapShapeDraft,
    MapShapeEditorDraft,
    MapShapeSaveRequest,
} from './types';
import {MAP_MARKER_CLASS_OPTIONS} from './types.ts';

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

const DEFAULT_LOCATION_COLOR: MapRgbaColor = [212, 48, 106, 255];

type LegacyMapKeyLocationDraft = Omit<MapKeyLocationDraft, 'markerClass'> & {
    markerClass?: unknown;
    type?: unknown;
};

function isMapMarkerClass(value: unknown): value is MapMarkerClass {
    return MAP_MARKER_CLASS_OPTIONS.some(option => option.value === value);
}

function inferLegacyMapMarkerClass(value: unknown): MapMarkerClass {
    if (typeof value !== 'string') return 'marker';
    if (/首都|王都|都城|帝都|京/.test(value)) return 'major-city';
    if (/港|码头|渡口/.test(value)) return 'harbor';
    if (/村|镇|营地|聚落/.test(value)) return 'town';
    if (/遗迹|废墟|神殿/.test(value)) return 'ruin';
    if (/事件|战场|遭遇|任务/.test(value)) return 'event';
    if (/城|要塞/.test(value)) return 'city';
    if (/地标|塔|山|峰/.test(value)) return 'landmark';
    return 'marker';
}

/** 读取旧地图时把 type 一次性折叠进 markerClass；后续保存不再写回 type。 */
export function normalizeMapEditorDraft(draft: MapShapeEditorDraft): MapShapeEditorDraft {
    return {
        ...draft,
        keyLocations: draft.keyLocations.map(value => {
            const {type, markerClass, ...location} = value as unknown as LegacyMapKeyLocationDraft;
            return {
                ...location,
                markerClass: isMapMarkerClass(markerClass)
                    ? markerClass
                    : inferLegacyMapMarkerClass(type),
            };
        }),
    };
}

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
        position: [location.x, location.y],
        markerClass: location.markerClass,
        shapeId: location.shapeId ?? null,
        color: DEFAULT_LOCATION_COLOR,
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
