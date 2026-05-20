// ui/src/components/RelationGraph/graphSignature.ts
// 计算当前图状态的稳定字符串签名。
// 签名仅捕获节点尺寸和边拓扑结构 — 从不包含节点位置。
// 签名变化意味着需要重新执行布局。

import type { Edge, Node } from '@xyflow/react';

/**
 * 计算确定性的图签名字符串。
 *
 * 包含的字段：
 *  - 节点: id + measured.width + measured.height
 *  - 边: source + target + kind + sourceHandle + targetHandle
 *
 * 两个列表在拼接前均会排序，因此签名与顺序无关。
 *
 * 尚未测量尺寸的节点贡献 `id:?x?` — 此签名
 * 与测量后的版本不同，从而确保所有节点测量完成后
 * 触发布局。
 */
export function computeGraphSignature(nodes: Node[], edges: Edge[]): string {
    const nodePart = nodes
        .map(n => {
            const w = n.measured?.width ?? '?';
            const h = n.measured?.height ?? '?';
            return `${n.id}:${w}x${h}`;
        })
        .sort()
        .join(';');

    const edgePart = edges
        .map(e => {
            const kind = (e.data as { kind?: string } | undefined)?.kind ?? '';
            const sh = e.sourceHandle ?? '';
            const th = e.targetHandle ?? '';
            return `${e.source}->${e.target}[${kind}](${sh},${th})`;
        })
        .sort()
        .join(';');

    return `N[${nodePart}]|E[${edgePart}]`;
}
