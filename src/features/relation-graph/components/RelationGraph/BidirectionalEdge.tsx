// app_main/src/features/relation-graph/components/RelationGraph/BidirectionalEdge.tsx
//
// 浮动边渲染组件。附着点、路径与标签位置不在这里计算——
// RelationGraphInner 通过 EdgeGeometryCtx 下发全图统一计算的几何结果
// （见 edgeGeometry.ts：附着点按「节点 × 侧边」聚合并做最小间距分离，
// 避免同一枢纽的多条边挤在同一个像素点上）。
//
// 双向配对 (A→B 和 B→A) 的垂直偏移同样在几何层处理。

import { useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

import { EdgeGeometryCtx } from './edgeGeometry';

export interface RelationEdgeData extends Record<string, unknown> {
    label?: string;
    kind?: 'one_way' | 'two_way';
    bidirectional?: boolean;
    pairedBidirectional?: boolean;
}

export function BidirectionalEdge({
    id,
    data,
    markerStart,
    markerEnd,
    style,
    selected,
}: EdgeProps) {
    const geometries = useContext(EdgeGeometryCtx);
    const geometry = geometries.get(id);

    // 端点尚未测量（或缺失）时几何层不产出条目 — 跳过渲染直到布局就绪
    if (!geometry) return null;

    const label = ((data ?? {}) as RelationEdgeData).label;

    return (
        <>
            <BaseEdge
                id={id}
                path={geometry.path}
                markerStart={markerStart}
                markerEnd={markerEnd}
                style={{
                    stroke: selected
                        ? 'var(--fc-rg-edge-selected-color, var(--fc-color-primary))'
                        : 'var(--fc-rg-edge-color, var(--fc-gray-400))',
                    strokeWidth: selected ? 2.75 : 2,
                    ...style,
                }}
            />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        className="fc-rg-edge-label nodrag nopan"
                        style={{
                            transform: `translate(-50%,-50%) translate(${geometry.labelX}px,${geometry.labelY}px)`,
                        }}
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
