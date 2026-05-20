// ui/src/components/RelationGraph/BidirectionalEdge.tsx
//
// 浮动边实现：附着点计算为从节点中心到对侧中心的射线与节点
// 边界矩形相交的点，因此边总是从几何上最近的边界点
// 出发/到达，而非固定锚点。
//
// 对于双向配对 (A→B 和 B→A)，共享的垂直偏移
// 自然地将两条线分离到相反两侧——无需额外标记。

import {
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    useReactFlow,
    Position,
    type EdgeProps,
} from '@xyflow/react';

export interface RelationEdgeData extends Record<string, unknown> {
    label?: string;
    kind?: 'one_way' | 'two_way';
    bidirectional?: boolean;
    pairedBidirectional?: boolean;
}

const BIDIR_OFFSET = 8;

// ─── 几何辅助函数 ─────────────────────────────────────────────────────────

/**
 * 找到从矩形中心朝向 `toward` 的射线与矩形边界相交的出射点。
 */
function getRectBorderPoint(
    rx: number, ry: number, rw: number, rh: number,
    toward: { x: number; y: number },
): { x: number; y: number } {
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
        // 退化情况：同一点 — 返回右边缘中点作为回退
        return { x: cx + rw / 2, y: cy };
    }

    const hw = rw / 2;
    const hh = rh / 2;
    const scaleX = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * 将边界出射点转换为 React Flow `Position` 枚举值
 *（边从节点的哪一侧穿出）。
 * 用于为 getBezierPath 提供正确的控制点方向。
 */
function getBorderSide(
    bp: { x: number; y: number },
    rx: number, ry: number, rw: number, rh: number,
): Position {
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const dx = bp.x - cx;
    const dy = bp.y - cy;

    // 比较归一化距离以确定哪一侧占主导
    const normX = rw > 0 ? Math.abs(dx) / (rw / 2) : 0;
    const normY = rh > 0 ? Math.abs(dy) / (rh / 2) : 0;

    if (normX >= normY) {
        return dx >= 0 ? Position.Right : Position.Left;
    } else {
        return dy >= 0 ? Position.Bottom : Position.Top;
    }
}

// ─── 边组件 ───────────────────────────────────────────────────────────

export function BidirectionalEdge({
    id,
    source,
    target,
    data,
    markerStart,
    markerEnd,
    style,
    selected,
}: EdgeProps) {
    const { getNode } = useReactFlow();

    const edgeData = (data ?? {}) as RelationEdgeData;
    const shouldOffset = edgeData.pairedBidirectional ?? false;
    const label = edgeData.label;

    const sNode = getNode(source);
    const tNode = getNode(target);

    // 节点尚未测量 — 跳过渲染直到布局就绪
    if (
        !sNode?.measured?.width  || !sNode.measured.height  ||
        !tNode?.measured?.width  || !tNode.measured.height
    ) {
        return null;
    }

    const sw = sNode.measured.width;
    const sh = sNode.measured.height;
    const tw = tNode.measured.width;
    const th = tNode.measured.height;

    // 画布空间中的节点中心
    const scx = sNode.position.x + sw / 2;
    const scy = sNode.position.y + sh / 2;
    const tcx = tNode.position.x + tw / 2;
    const tcy = tNode.position.y + th / 2;

    // 双向配对的垂直偏移
    // (A→B 和 B→A 的 dx/dy 互为镜像 → 垂直方向相反 → 自然分离)
    const ddx = tcx - scx;
    const ddy = tcy - scy;
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const perpX = shouldOffset ? (-ddy / dlen) * BIDIR_OFFSET : 0;
    const perpY = shouldOffset ? ( ddx / dlen) * BIDIR_OFFSET : 0;

    // 边界交点：通过偏移量偏置"朝向"方向，使出射点
    // 产生轻微偏移，避免节点轴对齐时两条线从
    // 完全相同的像素点穿出。
    const sp = getRectBorderPoint(
        sNode.position.x, sNode.position.y, sw, sh,
        { x: tcx + perpX, y: tcy + perpY },
    );
    const tp = getRectBorderPoint(
        tNode.position.x, tNode.position.y, tw, th,
        { x: scx + perpX, y: scy + perpY },
    );

    // 最终附着点（应用垂直平移）
    const ex1 = sp.x + perpX;
    const ey1 = sp.y + perpY;
    const ex2 = tp.x + perpX;
    const ey2 = tp.y + perpY;

    // 根据边穿出/进入的方向推导贝塞尔手柄方向
    const srcSide = getBorderSide(sp, sNode.position.x, sNode.position.y, sw, sh);
    const tgtSide = getBorderSide(tp, tNode.position.x, tNode.position.y, tw, th);

    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX: ex1,
        sourceY: ey1,
        sourcePosition: srcSide,
        targetX: ex2,
        targetY: ey2,
        targetPosition: tgtSide,
    });

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                markerStart={markerStart}
                markerEnd={markerEnd}
                style={{
                    stroke: selected
                        ? 'var(--fc-rg-edge-selected-color, var(--fc-color-primary))'
                        : 'var(--fc-rg-edge-color, var(--fc-gray-400))',
                    strokeWidth: selected ? 2 : 1.5,
                    ...style,
                }}
            />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        className="fc-rg-edge-label nodrag nopan"
                        style={{
                            transform: `translate(-50%,-50%) translate(${shouldOffset ? labelX - perpX : labelX}px,${shouldOffset ? labelY - perpY : labelY}px)`,
                        }}
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
