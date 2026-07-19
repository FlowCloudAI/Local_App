// app_main/src/features/relation-graph/components/RelationGraph/edgeGeometry.ts
//
// 全图共享的边几何计算（浮动边 + 附着点扇形分散）。
//
// 之前每条边在自己的组件里独立计算附着点：从节点中心向对端中心引射线，
// 取射线与边框的交点。当多个邻居的方位角接近时，这些交点会挤在几乎同
// 一个像素上，箭头和线堆成一束。本模块把全图的边按「节点 × 侧边」聚合，
// 对同一侧的多个附着点做一维最小间距分离；再基于分离后的端点自建三次
// 贝塞尔——标签需要在任意 t 处取点，必须自己掌握控制点，因此不再使用
// getBezierPath。
//
// 除 createContext 外不依赖 React 运行时。计算是确定性的：所有分离都
// 按稳定键排序，相同输入产出相同输出。

import { createContext } from 'react';
import type { Edge, Node } from '@xyflow/react';

// ─── 常量 ─────────────────────────────────────────────────────────────

/** 同一节点同一侧相邻附着点的目标最小间距（px）。 */
const MIN_PORT_GAP = 18;
/** 附着点距离节点角落的保留边距（px），避免箭头贴角。 */
const PORT_CORNER_MARGIN = 10;
/** 双向配对边（A→B 与 B→A 并存）的垂直分离偏移（px）。 */
const BIDIR_OFFSET = 8;
/** 对端位于出射方向后方时的弯曲系数（对齐 @xyflow 默认 curvature=0.25 的 25·c·√d）。 */
const REVERSE_CURVATURE_SCALE = 6.25;
/** 边路径与非端点节点的最小视觉净距（px）。 */
const EDGE_NODE_CLEARANCE = 6;
/** 曲线折线化后的检测段数；节点尺寸远大于单段误差。 */
const EDGE_COLLISION_SEGMENTS = 24;
/** 直线仍受阻时，依次尝试两侧弧线的法向偏移（px）。 */
const EDGE_REROUTE_OFFSETS = [0, 24, -24, 48, -48, 72, -72];

/** 标签字体，与 RelationGraph.css 的 .fc-rg-edge-label 对齐（--fc-font-size-xs, 11px）。 */
const LABEL_FONT = '11px sans-serif';
/** 标签水平内边距 + 边框（8×2 + 1×2）。 */
const LABEL_H_PADDING = 18;
/** 标签胶囊估算高度：11px × 1.5 行高 + 上下 padding 2×2 + 边框 1×2。 */
const LABEL_HEIGHT = 23;
/** 标签沿边的候选参数：中点优先，向两端交替展开。 */
const LABEL_T_CANDIDATES = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
/** 标签与节点的最小净距（px）。 */
const LABEL_NODE_CLEARANCE = 4;
/** 标签与标签的最小净距（px）。 */
const LABEL_LABEL_CLEARANCE = 2;

// ─── 类型 ─────────────────────────────────────────────────────────────

export interface EdgeGeometry {
    /** SVG 路径（单段三次贝塞尔）。 */
    path: string;
    /** 标签中心点（画布坐标）。 */
    labelX: number;
    labelY: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';

interface NodeRect {
    x: number;
    y: number;
    w: number;
    h: number;
    cx: number;
    cy: number;
}

/** 端点的「侧边 + 沿侧坐标」表示：top/bottom 侧 along 为 x，left/right 侧 along 为 y。 */
interface EndpointGeom {
    side: Side;
    along: number;
    fixed: number;
}

interface WorkingEdge {
    edge: Edge;
    s: EndpointGeom;
    t: EndpointGeom;
}

// ─── 几何辅助 ─────────────────────────────────────────────────────────

/** 从矩形中心朝 `toward` 的射线与矩形边框的交点。 */
function getRectBorderPoint(rect: NodeRect, toward: { x: number; y: number }): { x: number; y: number } {
    const dx = toward.x - rect.cx;
    const dy = toward.y - rect.cy;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
        // 退化情况：两节点同心 — 回退到右边缘中点
        return { x: rect.cx + rect.w / 2, y: rect.cy };
    }

    const hw = rect.w / 2;
    const hh = rect.h / 2;
    const scaleX = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    return { x: rect.cx + dx * scale, y: rect.cy + dy * scale };
}

/** 判断边框点位于矩形的哪一侧（按归一化偏移取主导轴）。 */
function sideOf(point: { x: number; y: number }, rect: NodeRect): Side {
    const normX = rect.w > 0 ? Math.abs(point.x - rect.cx) / (rect.w / 2) : 0;
    const normY = rect.h > 0 ? Math.abs(point.y - rect.cy) / (rect.h / 2) : 0;

    if (normX >= normY) {
        return point.x >= rect.cx ? 'right' : 'left';
    }
    return point.y >= rect.cy ? 'bottom' : 'top';
}

/** 把（自然交点 + 双向偏移）折算成贴着边框的 EndpointGeom。 */
function toEndpointGeom(
    borderPoint: { x: number; y: number },
    rect: NodeRect,
    perpX: number,
    perpY: number,
): EndpointGeom {
    const side = sideOf(borderPoint, rect);
    if (side === 'top' || side === 'bottom') {
        return {
            side,
            // 垂直偏移只保留沿侧分量，端点始终贴在边框上
            along: borderPoint.x + perpX,
            fixed: side === 'top' ? rect.y : rect.y + rect.h,
        };
    }
    return {
        side,
        along: borderPoint.y + perpY,
        fixed: side === 'left' ? rect.x : rect.x + rect.w,
    };
}

function endpointXY(geom: EndpointGeom): [number, number] {
    if (geom.side === 'top' || geom.side === 'bottom') {
        return [geom.along, geom.fixed];
    }
    return [geom.fixed, geom.along];
}

/** 贝塞尔控制点伸出距离：对端在前方取半程，在后方取 √ 弯曲。 */
function controlOffset(side: Side, x: number, y: number, ox: number, oy: number): number {
    let dist: number;
    switch (side) {
        case 'right':
            dist = ox - x;
            break;
        case 'left':
            dist = x - ox;
            break;
        case 'bottom':
            dist = oy - y;
            break;
        case 'top':
            dist = y - oy;
            break;
    }
    return dist >= 0 ? 0.5 * dist : REVERSE_CURVATURE_SCALE * Math.sqrt(-dist);
}

function controlPoint(side: Side, x: number, y: number, offset: number): [number, number] {
    switch (side) {
        case 'right':
            return [x + offset, y];
        case 'left':
            return [x - offset, y];
        case 'bottom':
            return [x, y + offset];
        case 'top':
            return [x, y - offset];
    }
}

/** 三次贝塞尔：起点、两个控制点、终点。 */
type Cubic = [number, number, number, number, number, number, number, number];

/** 三次贝塞尔在参数 t 处的取点。 */
function cubicPointAt(cubic: Cubic, t: number): [number, number] {
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = cubic;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
        a * sx + b * c1x + c * c2x + d * tx,
        a * sy + b * c1y + c * c2y + d * ty,
    ];
}

/** 线段是否与按 clearance 膨胀后的矩形相交。 */
function segmentTouchesRect(
    start: [number, number],
    end: [number, number],
    rect: NodeRect,
    clearance: number,
): boolean {
    let entry = 0;
    let exit = 1;
    const axes = [
        [start[0], end[0], rect.x - clearance, rect.x + rect.w + clearance],
        [start[1], end[1], rect.y - clearance, rect.y + rect.h + clearance],
    ];

    for (const [from, to, min, max] of axes) {
        const delta = to - from;
        if (Math.abs(delta) < 0.001) {
            if (from < min || from > max) return false;
            continue;
        }

        const first = (min - from) / delta;
        const second = (max - from) / delta;
        entry = Math.max(entry, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (entry > exit) return false;
    }

    return true;
}

/** 曲线是否蹭到任一非端点节点。 */
function cubicTouchesOtherNode(
    cubic: Cubic,
    rects: Map<string, NodeRect>,
    sourceId: string,
    targetId: string,
): boolean {
    const xs = [cubic[0], cubic[2], cubic[4], cubic[6]];
    const ys = [cubic[1], cubic[3], cubic[5], cubic[7]];
    const curveMinX = Math.min(...xs);
    const curveMaxX = Math.max(...xs);
    const curveMinY = Math.min(...ys);
    const curveMaxY = Math.max(...ys);

    for (const [nodeId, rect] of rects) {
        if (nodeId === sourceId || nodeId === targetId) continue;
        if (
            curveMaxX < rect.x - EDGE_NODE_CLEARANCE
            || curveMinX > rect.x + rect.w + EDGE_NODE_CLEARANCE
            || curveMaxY < rect.y - EDGE_NODE_CLEARANCE
            || curveMinY > rect.y + rect.h + EDGE_NODE_CLEARANCE
        ) {
            continue;
        }

        let previous = cubicPointAt(cubic, 0);
        for (let segment = 1; segment <= EDGE_COLLISION_SEGMENTS; segment += 1) {
            const current = cubicPointAt(cubic, segment / EDGE_COLLISION_SEGMENTS);
            if (segmentTouchesRect(previous, current, rect, EDGE_NODE_CLEARANCE)) return true;
            previous = current;
        }
    }

    return false;
}

// ─── 附着点一维分离 ────────────────────────────────────────────────────

interface PortSlot {
    /** 稳定排序键：along 优先，退化时按边 id + 端点角色。 */
    key: string;
    geom: EndpointGeom;
}

/**
 * 同一节点同一侧的附着点做最小间距分离。
 * 排序后一遍前向推挤 + 一遍后向回收，全部钳位在 [lo, hi] 内；
 * gap 取 MIN_PORT_GAP 与可用跨度的较小值，保证一定放得下。
 */
function separatePorts(slots: PortSlot[], lo: number, hi: number): void {
    if (slots.length === 0) return;

    if (hi <= lo) {
        const middle = (lo + hi) / 2;
        for (const slot of slots) slot.geom.along = middle;
        return;
    }

    slots.sort((left, right) => (left.geom.along - right.geom.along) || left.key.localeCompare(right.key));

    for (const slot of slots) {
        slot.geom.along = Math.min(Math.max(slot.geom.along, lo), hi);
    }

    if (slots.length === 1) return;

    const gap = Math.min(MIN_PORT_GAP, (hi - lo) / (slots.length - 1));

    for (let index = 1; index < slots.length; index += 1) {
        slots[index].geom.along = Math.max(slots[index].geom.along, slots[index - 1].geom.along + gap);
    }
    if (slots[slots.length - 1].geom.along > hi) {
        slots[slots.length - 1].geom.along = hi;
        for (let index = slots.length - 2; index >= 0; index -= 1) {
            slots[index].geom.along = Math.min(slots[index].geom.along, slots[index + 1].geom.along - gap);
        }
    }
}

// ─── 标签避让 ─────────────────────────────────────────────────────────

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
const labelWidthCache = new Map<string, number>();

/** canvas measureText 估算标签胶囊宽度；非 DOM 环境按字符宽粗估。 */
function measureLabelWidth(text: string): number {
    const cached = labelWidthCache.get(text);
    if (cached !== undefined) return cached;

    if (measureCtx === undefined) {
        measureCtx = typeof document !== 'undefined'
            ? document.createElement('canvas').getContext('2d')
            : null;
    }

    let width: number;
    if (measureCtx) {
        measureCtx.font = LABEL_FONT;
        width = measureCtx.measureText(text).width + LABEL_H_PADDING;
    } else {
        width = text.length * 11 + LABEL_H_PADDING;
    }

    if (labelWidthCache.size > 2048) labelWidthCache.clear();
    labelWidthCache.set(text, width);
    return width;
}

/** a 按 clearance 膨胀后与 b 的重叠面积；不相交返回 0。 */
function inflatedOverlapArea(a: Rect, b: Rect, clearance: number): number {
    const overlapW = Math.min(a.x + a.w + clearance, b.x + b.w) - Math.max(a.x - clearance, b.x);
    const overlapH = Math.min(a.y + a.h + clearance, b.y + b.h) - Math.max(a.y - clearance, b.y);
    if (overlapW <= 0 || overlapH <= 0) return 0;
    return overlapW * overlapH;
}

interface LabeledCurve {
    edgeId: string;
    label: string;
    cubic: Cubic;
}

/**
 * 全局标签贪心避让：按边 id 稳定排序，逐个沿自己的边路径试候选 t，
 * 取第一个既不压节点也不压已放标签的位置；全部冲突时取重叠面积最小者。
 */
function placeLabels(
    labeled: LabeledCurve[],
    rects: Map<string, NodeRect>,
    result: Map<string, EdgeGeometry>,
): void {
    if (labeled.length === 0) return;

    const nodeObstacles: Rect[] = [];
    for (const rect of rects.values()) {
        nodeObstacles.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    const placed: Rect[] = [];
    const ordered = labeled.slice().sort((left, right) => left.edgeId.localeCompare(right.edgeId));

    for (const item of ordered) {
        const width = measureLabelWidth(item.label);
        let bestX = 0;
        let bestY = 0;
        let bestRect: Rect | null = null;
        let bestScore = Infinity;

        for (const t of LABEL_T_CANDIDATES) {
            const [px, py] = cubicPointAt(item.cubic, t);
            const rect: Rect = {
                x: px - width / 2,
                y: py - LABEL_HEIGHT / 2,
                w: width,
                h: LABEL_HEIGHT,
            };

            let score = 0;
            for (const obstacle of nodeObstacles) {
                score += inflatedOverlapArea(rect, obstacle, LABEL_NODE_CLEARANCE);
            }
            for (const obstacle of placed) {
                score += inflatedOverlapArea(rect, obstacle, LABEL_LABEL_CLEARANCE);
            }

            if (score < bestScore) {
                bestScore = score;
                bestX = px;
                bestY = py;
                bestRect = rect;
            }
            if (score <= 0) break;
        }

        if (!bestRect) continue;
        placed.push(bestRect);
        const entry = result.get(item.edgeId);
        if (entry) {
            entry.labelX = bestX;
            entry.labelY = bestY;
        }
    }
}

// ─── 主入口 ───────────────────────────────────────────────────────────

/**
 * 计算全图每条边的路径与标签位置。
 * 端点未测量或缺失的边不产出条目（调用方跳过渲染）。
 */
export function computeEdgeGeometries(nodes: Node[], edges: Edge[]): Map<string, EdgeGeometry> {
    const rects = new Map<string, NodeRect>();
    for (const node of nodes) {
        const w = node.measured?.width ?? 0;
        const h = node.measured?.height ?? 0;
        if (w <= 0 || h <= 0) continue;
        rects.set(node.id, {
            x: node.position.x,
            y: node.position.y,
            w,
            h,
            cx: node.position.x + w / 2,
            cy: node.position.y + h / 2,
        });
    }

    // 第一步：每条边的自然附着点（含双向配对的垂直偏移）
    const working: WorkingEdge[] = [];
    for (const edge of edges) {
        const sRect = rects.get(edge.source);
        const tRect = rects.get(edge.target);
        if (!sRect || !tRect) continue;

        const shouldOffset = ((edge.data ?? {}) as { pairedBidirectional?: boolean }).pairedBidirectional ?? false;
        const ddx = tRect.cx - sRect.cx;
        const ddy = tRect.cy - sRect.cy;
        const dlen = Math.hypot(ddx, ddy) || 1;
        const perpX = shouldOffset ? (-ddy / dlen) * BIDIR_OFFSET : 0;
        const perpY = shouldOffset ? (ddx / dlen) * BIDIR_OFFSET : 0;

        const sp = getRectBorderPoint(sRect, { x: tRect.cx + perpX, y: tRect.cy + perpY });
        const tp = getRectBorderPoint(tRect, { x: sRect.cx + perpX, y: sRect.cy + perpY });

        working.push({
            edge,
            s: toEndpointGeom(sp, sRect, perpX, perpY),
            t: toEndpointGeom(tp, tRect, perpX, perpY),
        });
    }

    // 第二步：按「节点 × 侧边」聚合，做附着点分离
    const portGroups = new Map<string, PortSlot[]>();
    for (const item of working) {
        const sKey = `${item.edge.source}|${item.s.side}`;
        const tKey = `${item.edge.target}|${item.t.side}`;
        let sGroup = portGroups.get(sKey);
        if (!sGroup) portGroups.set(sKey, (sGroup = []));
        sGroup.push({ key: `${item.edge.id}#s`, geom: item.s });
        let tGroup = portGroups.get(tKey);
        if (!tGroup) portGroups.set(tKey, (tGroup = []));
        tGroup.push({ key: `${item.edge.id}#t`, geom: item.t });
    }

    for (const [groupKey, slots] of portGroups) {
        const nodeId = groupKey.slice(0, groupKey.lastIndexOf('|'));
        const side = groupKey.slice(groupKey.lastIndexOf('|') + 1) as Side;
        const rect = rects.get(nodeId);
        if (!rect) continue;

        const horizontal = side === 'top' || side === 'bottom';
        const min = horizontal ? rect.x : rect.y;
        const max = horizontal ? rect.x + rect.w : rect.y + rect.h;
        separatePorts(slots, min + PORT_CORNER_MARGIN, max - PORT_CORNER_MARGIN);
    }

    // 第三步：构建路径，标签先放在中点
    const result = new Map<string, EdgeGeometry>();
    const labeledCurves: LabeledCurve[] = [];
    for (const item of working) {
        const [sx, sy] = endpointXY(item.s);
        const [tx, ty] = endpointXY(item.t);
        const sOffset = controlOffset(item.s.side, sx, sy, tx, ty);
        const tOffset = controlOffset(item.t.side, tx, ty, sx, sy);
        const [c1x, c1y] = controlPoint(item.s.side, sx, sy, sOffset);
        const [c2x, c2y] = controlPoint(item.t.side, tx, ty, tOffset);

        let cubic: Cubic = [sx, sy, c1x, c1y, c2x, c2y, tx, ty];
        if (cubicTouchesOtherNode(cubic, rects, item.edge.source, item.edge.target)) {
            const dx = tx - sx;
            const dy = ty - sy;
            const length = Math.hypot(dx, dy) || 1;
            const normalX = -dy / length;
            const normalY = dx / length;
            // ponytail: 稀疏关系图只试固定双侧弧线；候选全被挡住时再升级为障碍物寻路。
            for (const offset of EDGE_REROUTE_OFFSETS) {
                const candidate: Cubic = [
                    sx,
                    sy,
                    sx + dx / 3 + normalX * offset,
                    sy + dy / 3 + normalY * offset,
                    sx + (2 * dx) / 3 + normalX * offset,
                    sy + (2 * dy) / 3 + normalY * offset,
                    tx,
                    ty,
                ];
                if (offset === 0) cubic = candidate;
                if (cubicTouchesOtherNode(candidate, rects, item.edge.source, item.edge.target)) continue;
                cubic = candidate;
                break;
            }
        }
        const path = `M ${cubic[0]},${cubic[1]} C ${cubic[2]},${cubic[3]} ${cubic[4]},${cubic[5]} ${cubic[6]},${cubic[7]}`;
        const [labelX, labelY] = cubicPointAt(cubic, 0.5);
        result.set(item.edge.id, { path, labelX, labelY });

        const label = ((item.edge.data ?? {}) as { label?: unknown }).label;
        if (typeof label === 'string' && label.length > 0) {
            labeledCurves.push({ edgeId: item.edge.id, label, cubic });
        }
    }

    // 第四步：标签全局避让（标签×节点、标签×标签）
    placeLabels(labeledCurves, rects, result);

    return result;
}

// ─── 共享上下文 ────────────────────────────────────────────────────────

/** RelationGraphInner 统一计算后下发；BidirectionalEdge 按边 id 消费。 */
export const EdgeGeometryCtx = createContext<ReadonlyMap<string, EdgeGeometry>>(new Map());
