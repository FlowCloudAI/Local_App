import {findPolygonSelfIntersections, getDistanceSquared, isPointInPolygon} from './geometry';
import type {
    MapKeyLocationDraft,
    MapShapeDraft,
    MapShapeEditorDraft,
    MapValidationIssue,
    MapValidationResult,
} from './types';

const MIN_SHAPE_VERTEX_COUNT = 3;
const DUPLICATE_VERTEX_DISTANCE = 1;
const MIN_VERTEX_DISTANCE = 12;

function createIssue(issue: MapValidationIssue): MapValidationIssue {
    return issue;
}

function validateShape(shape: MapShapeDraft) {
    const issues: MapValidationIssue[] = [];

    if (shape.vertices.length < MIN_SHAPE_VERTEX_COUNT) {
        issues.push(createIssue({
            code: 'shape_too_few_vertices',
            severity: 'error',
            source: 'shape',
            shapeId: shape.id,
            message: `图形「${shape.name}」至少需要 ${MIN_SHAPE_VERTEX_COUNT} 个点才能构成闭合图形。`,
        }));
    }

    for (let firstIndex = 0; firstIndex < shape.vertices.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < shape.vertices.length; secondIndex += 1) {
            const distanceSquared = getDistanceSquared(shape.vertices[firstIndex], shape.vertices[secondIndex]);

            if (distanceSquared <= DUPLICATE_VERTEX_DISTANCE * DUPLICATE_VERTEX_DISTANCE) {
                issues.push(createIssue({
                    code: 'shape_duplicate_vertices',
                    severity: 'error',
                    source: 'shape',
                    shapeId: shape.id,
                    message: `图形「${shape.name}」的第 ${firstIndex + 1} 个点与第 ${secondIndex + 1} 个点重复，请删除或移动其中一个点。`,
                }));
                continue;
            }

            if (distanceSquared < MIN_VERTEX_DISTANCE * MIN_VERTEX_DISTANCE) {
                issues.push(createIssue({
                    code: 'shape_close_vertices',
                    severity: 'error',
                    source: 'shape',
                    shapeId: shape.id,
                    message: `图形「${shape.name}」的第 ${firstIndex + 1} 个点与第 ${secondIndex + 1} 个点过近，可能导致轮廓异常。`,
                }));
            }
        }
    }

    const intersections = findPolygonSelfIntersections(shape.vertices);
    intersections.forEach(intersection => {
        issues.push(createIssue({
            code: 'shape_self_intersection',
            severity: 'error',
            source: 'shape',
            shapeId: shape.id,
            message: `图形「${shape.name}」的第 ${intersection.firstEdgeIndex + 1} 条边与第 ${intersection.secondEdgeIndex + 1} 条边相交，当前图形存在自交。`,
        }));
    });

    return {
        shapeId: shape.id,
        issues,
        isValid: issues.length === 0,
    };
}

function validateKeyLocation(
    location: MapKeyLocationDraft,
    shapes: MapShapeDraft[],
) {
    const issues: MapValidationIssue[] = [];
    const safeName = location.name.trim() || '未命名关键地点';
    const relatedShape = shapes.find(shape => shape.id === location.shapeId);

    if (!location.name.trim()) {
        issues.push(createIssue({
            code: 'key_location_name_required',
            severity: 'error',
            source: 'keyLocation',
            keyLocationId: location.id,
            message: `关键地点「${safeName}」缺少名称。`,
        }));
    }

    if (!location.type.trim()) {
        issues.push(createIssue({
            code: 'key_location_type_required',
            severity: 'error',
            source: 'keyLocation',
            keyLocationId: location.id,
            message: `关键地点「${safeName}」缺少类型。`,
        }));
    }

    if (!location.shapeId) {
        issues.push(createIssue({
            code: 'key_location_shape_required',
            severity: 'error',
            source: 'keyLocation',
            keyLocationId: location.id,
            message: `关键地点「${safeName}」必须关联一个图形。`,
        }));
    } else if (!relatedShape) {
        issues.push(createIssue({
            code: 'key_location_shape_missing',
            severity: 'error',
            source: 'keyLocation',
            keyLocationId: location.id,
            message: `关键地点「${safeName}」关联的图形不存在，请重新选择关联图形。`,
        }));
    } else if (!isPointInPolygon({x: location.x, y: location.y}, relatedShape.vertices)) {
        issues.push(createIssue({
            code: 'key_location_outside_shape',
            severity: 'error',
            source: 'keyLocation',
            keyLocationId: location.id,
            shapeId: relatedShape.id,
            message: `关键地点「${safeName}」未落在关联图形「${relatedShape.name}」内，请调整位置或关联关系。`,
        }));
    }

    return {
        keyLocationId: location.id,
        issues,
        isValid: issues.length === 0,
    };
}

export function validateMapEditorDraft(
    draft: MapShapeEditorDraft,
    options?: { hasDrawingShapeInProgress?: boolean },
): MapValidationResult {
    const shapeResults = draft.shapes.map(shape => validateShape(shape));
    const keyLocationResults = draft.keyLocations.map(location => validateKeyLocation(location, draft.shapes));
    const draftIssues: MapValidationIssue[] = [];

    if (draft.shapes.length === 0) {
        draftIssues.push(createIssue({
            code: 'draft_no_shape',
            severity: 'error',
            source: 'draft',
            message: '当前至少需要一个合法图形后才能提交。',
        }));
    }

    if (options?.hasDrawingShapeInProgress) {
        draftIssues.push(createIssue({
            code: 'draft_shape_drawing_in_progress',
            severity: 'error',
            source: 'draft',
            message: '当前仍有图形处于绘制中，请先完成或取消绘制后再提交。',
        }));
    }

    const issues = [
        ...draftIssues,
        ...shapeResults.flatMap(result => result.issues),
        ...keyLocationResults.flatMap(result => result.issues),
    ];

    return {
        issues,
        shapeResults,
        keyLocationResults,
        draftResult: {
            issues: draftIssues,
            isValid: draftIssues.length === 0,
        },
        isValid: issues.length === 0,
    };
}
