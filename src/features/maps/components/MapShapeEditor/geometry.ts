import type {MapShapeVertex} from './types';

const GEOMETRY_EPSILON = 1e-6;

function cross(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isBetween(value: number, start: number, end: number): boolean {
    return value >= Math.min(start, end) - GEOMETRY_EPSILON && value <= Math.max(start, end) + GEOMETRY_EPSILON;
}

export function getDistanceSquared(
    first: { x: number; y: number },
    second: { x: number; y: number },
): number {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    return dx * dx + dy * dy;
}

export function isPointOnSegment(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
): boolean {
    return Math.abs(cross(start, end, point)) <= GEOMETRY_EPSILON
        && isBetween(point.x, start.x, end.x)
        && isBetween(point.y, start.y, end.y);
}

export function segmentsIntersect(
    firstStart: { x: number; y: number },
    firstEnd: { x: number; y: number },
    secondStart: { x: number; y: number },
    secondEnd: { x: number; y: number },
): boolean {
    const d1 = cross(firstStart, firstEnd, secondStart);
    const d2 = cross(firstStart, firstEnd, secondEnd);
    const d3 = cross(secondStart, secondEnd, firstStart);
    const d4 = cross(secondStart, secondEnd, firstEnd);

    if (((d1 > GEOMETRY_EPSILON && d2 < -GEOMETRY_EPSILON) || (d1 < -GEOMETRY_EPSILON && d2 > GEOMETRY_EPSILON))
        && ((d3 > GEOMETRY_EPSILON && d4 < -GEOMETRY_EPSILON) || (d3 < -GEOMETRY_EPSILON && d4 > GEOMETRY_EPSILON))) {
        return true;
    }

    return (
        (Math.abs(d1) <= GEOMETRY_EPSILON && isPointOnSegment(secondStart, firstStart, firstEnd))
        || (Math.abs(d2) <= GEOMETRY_EPSILON && isPointOnSegment(secondEnd, firstStart, firstEnd))
        || (Math.abs(d3) <= GEOMETRY_EPSILON && isPointOnSegment(firstStart, secondStart, secondEnd))
        || (Math.abs(d4) <= GEOMETRY_EPSILON && isPointOnSegment(firstEnd, secondStart, secondEnd))
    );
}

export function findPolygonSelfIntersections(vertices: MapShapeVertex[]) {
    const intersections: Array<{ firstEdgeIndex: number; secondEdgeIndex: number }> = [];
    const total = vertices.length;

    if (total < 4) return intersections;

    for (let firstIndex = 0; firstIndex < total; firstIndex += 1) {
        const firstStart = vertices[firstIndex];
        const firstEnd = vertices[(firstIndex + 1) % total];

        for (let secondIndex = firstIndex + 1; secondIndex < total; secondIndex += 1) {
            const isSameEdge = firstIndex === secondIndex;
            const isAdjacent = Math.abs(firstIndex - secondIndex) === 1 || (firstIndex === 0 && secondIndex === total - 1);
            if (isSameEdge || isAdjacent) continue;

            const secondStart = vertices[secondIndex];
            const secondEnd = vertices[(secondIndex + 1) % total];

            if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
                intersections.push({
                    firstEdgeIndex: firstIndex,
                    secondEdgeIndex: secondIndex,
                });
            }
        }
    }

    return intersections;
}

export function isPointInPolygon(
    point: { x: number; y: number },
    vertices: MapShapeVertex[],
): boolean {
    if (vertices.length < 3) return false;

    let inside = false;

    for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
        const currentVertex = vertices[index];
        const previousVertex = vertices[previous];

        if (isPointOnSegment(point, previousVertex, currentVertex)) {
            return true;
        }

        const intersects = ((currentVertex.y > point.y) !== (previousVertex.y > point.y))
            && (point.x < ((previousVertex.x - currentVertex.x) * (point.y - currentVertex.y)) / (previousVertex.y - currentVertex.y) + currentVertex.x);

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}
