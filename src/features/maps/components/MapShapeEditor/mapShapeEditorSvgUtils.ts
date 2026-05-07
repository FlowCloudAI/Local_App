import type {
    MapEditorCanvas,
    MapKeyLocationDraft,
    MapShapeDraft,
    MapShapeEditorDraft,
    MapShapeEditorViewBox,
    MapShapeVertex,
} from './types';

const MIN_VIEWBOX_SCALE = 0.18;
const MAX_VIEWBOX_SCALE = 2;

export interface CoordinateSnapshot {
    id: string;
    x: number;
    y: number;
}

export interface ShapeTranslationDelta {
    x: number;
    y: number;
}

export interface ShapeTranslationOptions {
    canvas: MapEditorCanvas;
    currentPoint: { x: number; y: number };
    originVertices: CoordinateSnapshot[];
    startPoint: { x: number; y: number };
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function createInitialMapShapeEditorViewBox(canvas: MapEditorCanvas): MapShapeEditorViewBox {
    return {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
    };
}

export function clampMapShapeEditorViewBox(
    viewBox: MapShapeEditorViewBox,
    canvas: MapEditorCanvas,
): MapShapeEditorViewBox {
    const width = clamp(viewBox.width, canvas.width * MIN_VIEWBOX_SCALE, canvas.width * MAX_VIEWBOX_SCALE);
    const height = clamp(viewBox.height, canvas.height * MIN_VIEWBOX_SCALE, canvas.height * MAX_VIEWBOX_SCALE);
    const xMargin = canvas.width - width;
    const yMargin = canvas.height - height;

    return {
        width,
        height,
        x: clamp(viewBox.x, Math.min(0, xMargin), Math.max(0, xMargin)),
        y: clamp(viewBox.y, Math.min(0, yMargin), Math.max(0, yMargin)),
    };
}

export function cloneMapShapeEditorDraft(draft: MapShapeEditorDraft): MapShapeEditorDraft {
    return {
        shapes: draft.shapes.map(shape => ({
            ...shape,
            vertices: shape.vertices.map(vertex => ({...vertex})),
        })),
        keyLocations: draft.keyLocations.map(location => ({...location})),
    };
}

export function moveShapeInOrder(
    shapes: MapShapeDraft[],
    shapeId: string,
    targetIndex: number,
): MapShapeDraft[] {
    const currentIndex = shapes.findIndex(shape => shape.id === shapeId);
    if (currentIndex === -1) {
        return shapes;
    }

    const boundedTargetIndex = clamp(targetIndex, 0, shapes.length - 1);
    if (currentIndex === boundedTargetIndex) {
        return shapes;
    }

    const nextShapes = [...shapes];
    const [targetShape] = nextShapes.splice(currentIndex, 1);
    nextShapes.splice(boundedTargetIndex, 0, targetShape);
    return nextShapes;
}

export function createMapShapeEditorLocalId(prefix: string): string {
    const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return `${prefix}-${randomPart}`;
}

export function buildDefaultShapeName(shapes: MapShapeDraft[]): string {
    return `图形 ${shapes.length + 1}`;
}

export function buildDefaultLocationName(locations: MapKeyLocationDraft[]): string {
    return `关键地点 ${locations.length + 1}`;
}

export function createEmptyShapeDraft(existingShapes: MapShapeDraft[]): MapShapeDraft {
    const fillPalette = ['#d8ecff', '#eaf5d7', '#fdf0de', '#eee9fd'];
    const strokePalette = ['#185fa5', '#426815', '#aa4e0c', '#5038b0'];
    const index = existingShapes.length;

    return {
        id: createMapShapeEditorLocalId('shape'),
        name: buildDefaultShapeName(existingShapes),
        fill: fillPalette[index % fillPalette.length],
        stroke: strokePalette[index % strokePalette.length],
        vertices: [],
    };
}

export function getShapeCenter(
    shape: MapShapeDraft,
    fallbackCanvas: MapEditorCanvas,
): { x: number; y: number } {
    if (shape.vertices.length === 0) {
        return {
            x: fallbackCanvas.width / 2,
            y: fallbackCanvas.height / 2,
        };
    }

    const summary = shape.vertices.reduce((accumulator, vertex) => ({
        x: accumulator.x + vertex.x,
        y: accumulator.y + vertex.y,
    }), {x: 0, y: 0});

    return {
        x: summary.x / shape.vertices.length,
        y: summary.y / shape.vertices.length,
    };
}

export function toSvgPoint(
    svgElement: SVGSVGElement,
    clientX: number,
    clientY: number,
    canvas: MapEditorCanvas,
) {
    const point = svgElement.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const screenMatrix = svgElement.getScreenCTM();
    if (screenMatrix) {
        const localPoint = point.matrixTransform(screenMatrix.inverse());
        return {
            x: clamp(localPoint.x, 0, canvas.width),
            y: clamp(localPoint.y, 0, canvas.height),
        };
    }

    const rect = svgElement.getBoundingClientRect();
    return {
        x: clamp(((clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
        y: clamp(((clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height),
    };
}

export function projectPointToSegment(
    point: { x: number; y: number },
    start: MapShapeVertex,
    end: MapShapeVertex,
) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return {x: start.x, y: start.y};
    }

    const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    return {
        x: start.x + dx * ratio,
        y: start.y + dy * ratio,
    };
}

export function buildShapePoints(shape: MapShapeDraft): string {
    return shape.vertices.map(vertex => `${vertex.x},${vertex.y}`).join(' ');
}

export function getClampedShapeDelta({
                                         canvas,
                                         currentPoint,
                                         originVertices,
                                         startPoint,
                                     }: ShapeTranslationOptions): ShapeTranslationDelta {
    const xs = originVertices.map(vertex => vertex.x);
    const ys = originVertices.map(vertex => vertex.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rawDeltaX = currentPoint.x - startPoint.x;
    const rawDeltaY = currentPoint.y - startPoint.y;

    return {
        x: clamp(rawDeltaX, -minX, canvas.width - maxX),
        y: clamp(rawDeltaY, -minY, canvas.height - maxY),
    };
}

export function updateVertex(
    draft: MapShapeEditorDraft,
    shapeId: string,
    vertexId: string,
    point: { x: number; y: number },
): MapShapeEditorDraft {
    return {
        ...draft,
        shapes: draft.shapes.map(shape => {
            if (shape.id !== shapeId) return shape;

            return {
                ...shape,
                vertices: shape.vertices.map(vertex => (
                    vertex.id === vertexId ? {...vertex, x: point.x, y: point.y} : vertex
                )),
            };
        }),
    };
}

export function updateKeyLocation(
    draft: MapShapeEditorDraft,
    locationId: string,
    updater: (location: MapKeyLocationDraft) => MapKeyLocationDraft,
): MapShapeEditorDraft {
    return {
        ...draft,
        keyLocations: draft.keyLocations.map(location => (
            location.id === locationId ? updater(location) : location
        )),
    };
}

export function updateShapeTranslation(
    draft: MapShapeEditorDraft,
    shapeId: string,
    delta: ShapeTranslationDelta,
    originVertices: CoordinateSnapshot[],
    originLocations: CoordinateSnapshot[],
): MapShapeEditorDraft {
    const vertexMap = new Map(originVertices.map(vertex => [vertex.id, vertex]));
    const locationMap = new Map(originLocations.map(location => [location.id, location]));

    return {
        ...draft,
        shapes: draft.shapes.map(shape => {
            if (shape.id !== shapeId) return shape;

            return {
                ...shape,
                vertices: shape.vertices.map(vertex => {
                    const originVertex = vertexMap.get(vertex.id);
                    if (!originVertex) return vertex;

                    return {
                        ...vertex,
                        x: originVertex.x + delta.x,
                        y: originVertex.y + delta.y,
                    };
                }),
            };
        }),
        keyLocations: draft.keyLocations.map(location => {
            const originLocation = locationMap.get(location.id);
            if (!originLocation) return location;

            return {
                ...location,
                x: originLocation.x + delta.x,
                y: originLocation.y + delta.y,
            };
        }),
    };
}

export function getShapeEdge(shape: MapShapeDraft, index: number) {
    const start = shape.vertices[index];
    const end = shape.vertices[(index + 1) % shape.vertices.length];
    return {start, end};
}
