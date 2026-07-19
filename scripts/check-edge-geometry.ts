import assert from 'node:assert/strict';

import { computeEdgeGeometries } from '../src/features/relation-graph/components/RelationGraph/edgeGeometry.ts';

type Cubic = [number, number, number, number, number, number, number, number];

function parseCubic(path: string): Cubic {
    const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
    assert.equal(values.length, 8, `预期单段三次贝塞尔，实际路径为：${path}`);
    return values as Cubic;
}

function cubicPointAt(cubic: Cubic, t: number): [number, number] {
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = cubic;
    const u = 1 - t;
    return [
        u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
        u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty,
    ];
}

function curveTouchesRect(cubic: Cubic, rect: { x: number; y: number; w: number; h: number }): boolean {
    const clearance = 4;
    for (let sample = 0; sample <= 240; sample += 1) {
        const [x, y] = cubicPointAt(cubic, sample / 240);
        if (
            x >= rect.x - clearance
            && x <= rect.x + rect.w + clearance
            && y >= rect.y - clearance
            && y <= rect.y + rect.h + clearance
        ) {
            return true;
        }
    }
    return false;
}

function isStraight(cubic: Cubic): boolean {
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = cubic;
    const dx = tx - sx;
    const dy = ty - sy;
    return Math.abs((c1x - sx) * dy - (c1y - sy) * dx) < 0.001
        && Math.abs((c2x - sx) * dy - (c2y - sy) * dx) < 0.001;
}

const obstacle = { x: 273, y: 189, w: 10, h: 10 };
const nodes = [
    { id: 'source', position: { x: 0, y: 0 }, measured: { width: 100, height: 100 }, data: {} },
    { id: 'target', position: { x: 700, y: 700 }, measured: { width: 100, height: 100 }, data: {} },
    {
        id: 'obstacle',
        position: { x: obstacle.x, y: obstacle.y },
        measured: { width: obstacle.w, height: obstacle.h },
        data: {},
    },
];
const edges = [{ id: 'source-target', source: 'source', target: 'target', data: {} }];
const geometry = computeEdgeGeometries(nodes, edges).get('source-target');
const unobstructedGeometry = computeEdgeGeometries(nodes.slice(0, 2), edges).get('source-target');

assert.ok(geometry, '应为已测量端点生成边路径');
assert.ok(unobstructedGeometry, '应为无障碍边生成路径');
assert.equal(isStraight(parseCubic(unobstructedGeometry.path)), false, '无障碍边应保留原有曲率');
assert.equal(
    curveTouchesRect(parseCubic(geometry.path), obstacle),
    false,
    '边路径不得蹭到非端点节点',
);

console.log('边几何回归检查通过');
