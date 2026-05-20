// ui/src/components/RelationGraph/useRelationLayout.ts
// 管理完整的布局生命周期：
//  - 等待 React Flow 测量所有节点 (useNodesInitialized)
//  - 计算图签名以检测实际变化
//  - 触发宿主提供的异步布局函数
//  - 防止来自并发/已取代请求的过期响应
//  - 首次成功布局时执行一次性 fitBounds
//  - 处理空图而不调用布局函数

import {useCallback, useEffect, useRef, useState} from 'react';
import type {Edge, Node} from '@xyflow/react';
import {useNodesInitialized, useReactFlow} from '@xyflow/react';

import {computeGraphSignature} from './graphSignature';
import type {LayoutFunction, LayoutRequest, RelationLayoutState} from './types';

export interface UseRelationLayoutOptions {
    nodes: Node[];
    edges: Edge[];
    layoutFn: LayoutFunction;
    nodeOrigin?: [number, number];
    /** 传递给 fitBounds 的内边距（视口比例，例如 0.1 = 10%）。默认 0.1 */
    fitPadding?: number;
    /** fitBounds 动画持续时间（毫秒）。默认 500 */
    fitDuration?: number;
}

export function useRelationLayout({
    nodes,
    edges,
    layoutFn,
    nodeOrigin = [0, 0],
    fitPadding = 0.1,
    fitDuration = 500,
}: UseRelationLayoutOptions): RelationLayoutState {
    const nodesInitialized = useNodesInitialized();
    const { setNodes, fitBounds } = useReactFlow();

    const [layoutReady, setLayoutReady] = useState(false);
    const [layoutLoading, setLayoutLoading] = useState(false);
    const [layoutError, setLayoutError] = useState<Error | null>(null);

    // 上次成功应用的布局签名 — 相等时跳过重新布局
    const appliedSigRef = useRef<string | null>(null);
    // 最近一次派发的请求签名 — 用于过期响应检测
    const pendingSigRef = useRef<string | null>(null);
    // 是否已执行一次性初始 fitBounds
    const hasFitRef = useRef(false);

    const runLayout = useCallback(
        async (sig: string, snapshot: { nodes: Node[]; edges: Edge[] }) => {
            // 仅包含 React Flow 已测量的节点。
            // 无尺寸的节点被静默排除；布局后端必须
            // 优雅处理部分节点列表。
            const measuredNodes = snapshot.nodes.filter(
                n => (n.measured?.width ?? 0) > 0 && (n.measured?.height ?? 0) > 0,
            );

            const request: LayoutRequest = {
                nodeOrigin,
                nodes: measuredNodes.map(n => ({
                    id: n.id,
                    width: n.measured!.width!,
                    height: n.measured!.height!,
                })),
                edges: snapshot.edges.map(e => {
                    const d = (e.data ?? {}) as { kind?: 'one_way' | 'two_way' };
                    return {
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        sourceHandle: e.sourceHandle ?? undefined,
                        targetHandle: e.targetHandle ?? undefined,
                        kind: d.kind,
                    };
                }),
            };

            // 标记此为当前期望的响应
            pendingSigRef.current = sig;
            setLayoutLoading(true);
            setLayoutError(null);
            setLayoutReady(false);

            try {
                const response = await layoutFn(request);

                // ── 异步安全：若较新请求已取代此请求则丢弃 ──
                if (pendingSigRef.current !== sig) return;

                // 应用返回的位置；positions 中缺失的节点保持原坐标
                setNodes(prev =>
                    prev.map(node => {
                        const pos = response.positions[node.id];
                        if (!pos) return node;
                        return { ...node, position: { x: pos.x, y: pos.y } };
                    }),
                );

                appliedSigRef.current = sig;
                setLayoutReady(true);
                setLayoutLoading(false);

                // 首次成功布局后的一次性视口适配
                if (!hasFitRef.current && response.bounds) {
                    hasFitRef.current = true;
                    // 推迟到下一帧，使 React Flow 已刷新位置更新
                    setTimeout(() => {
                        fitBounds(response.bounds!, {
                            padding: fitPadding,
                            duration: fitDuration,
                        });
                    }, 0);
                }
            } catch (err) {
                // 丢弃已被取代的请求的错误
                if (pendingSigRef.current !== sig) return;
                setLayoutError(err instanceof Error ? err : new Error(String(err)));
                setLayoutLoading(false);
            }
        },
        // layoutFn, nodeOrigin, fitPadding, fitDuration 控制请求/适配行为；
        // setNodes 和 fitBounds 来自 useReactFlow 的稳定引用。
        [layoutFn, nodeOrigin, fitPadding, fitDuration, setNodes, fitBounds],
    );

    useEffect(() => {
        // ── 空图：标记就绪而不调用布局函数 ──
        if (nodes.length === 0) {
            pendingSigRef.current = 'empty';
            appliedSigRef.current = 'empty';
            setLayoutReady(true);
            setLayoutLoading(false);
            setLayoutError(null);
            return;
        }

        // ── 等待 React Flow 测量所有节点 ──
        if (!nodesInitialized) return;

        const sig = computeGraphSignature(nodes, edges);

        // ── 若图自上次布局以来未变化则跳过 ──
        if (sig === appliedSigRef.current) return;

        // 在新的布局回合开始前重置就绪状态
        setLayoutReady(false);
        void runLayout(sig, {nodes, edges});
    }, [nodesInitialized, nodes, edges, runLayout]);

    return { layoutReady, layoutLoading, layoutError };
}
