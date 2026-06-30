// app_main/src/features/relation-graph/components/RelationGraph/RelationGraph.tsx

import {
    createContext,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useRef,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type ForwardedRef,
    type RefObject,
    type ReactNode,
} from 'react';
import {
    Background,
    BackgroundVariant,
    MarkerType,
    ReactFlow,
    ReactFlowProvider,
    getViewportForBounds,
    useReactFlow,
    useEdgesState,
    useNodesState,
    type Edge,
    type EdgeTypes,
    type Node,
    type NodeProps,
    type NodeTypes,
    Handle,
    Position,
} from '@xyflow/react';
import { toCanvas } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import './RelationGraph.css';

import { useRelationLayout } from './useRelationLayout';
import { BidirectionalEdge } from './BidirectionalEdge';
import type {
    LayoutFunction,
    RelationEdgeInput,
    RelationLayoutState,
    RelationNodeInput,
} from './types';

// ─── renderNode context ───────────────────────────────────────────────────────
// 存储在模块级别，使 NODE_TYPES 引用不变 — 防止
// React Flow 在 prop 更新时卸载/重新挂载所有节点。

type RenderNodeFn = (data: RelationNodeInput, selected: boolean) => ReactNode;

const RenderNodeCtx = createContext<RenderNodeFn | undefined>(undefined);

// ─── 节点组件 ───────────────────────────────────────────────────────────

interface RGNodeData extends Record<string, unknown> {
    label?: string;
}

const EXPORT_MIN_ZOOM = 0.05;
const EXPORT_MAX_ZOOM = 4;
const DEFAULT_EXPORT_SCALE = 2;
const DEFAULT_EXPORT_PADDING = 24;
const DEFAULT_EXPORT_BACKGROUND = '#ffffff';
const DEFAULT_EXPORT_FILENAME = 'relation-graph';
const TRANSPARENT_PIXEL_DATA_URL =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

type RelationGraphImageFormat = 'png' | 'jpeg';

export interface RelationGraphExportBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface RelationGraphExportOptions {
    /** 导出格式，默认 `png`。 */
    format?: RelationGraphImageFormat;
    /** 节点 AABB 四周扩展的像素留白，默认 `24`。 */
    padding?: number;
    /** 清晰度倍率，默认 `2`。 */
    scale?: number;
    /** 导出背景色，默认白色。 */
    backgroundColor?: string;
    /** JPEG 质量，仅 `format='jpeg'` 时生效，范围 0–1。 */
    quality?: number;
    /** 下载文件名（不含扩展名时自动补后缀）。 */
    fileName?: string;
}

export interface RelationGraphExportResult {
    blob: Blob;
    bounds: RelationGraphExportBounds;
    width: number;
    height: number;
    fileName: string;
}

export interface RelationGraphRef {
    exportImage: (options?: RelationGraphExportOptions) => Promise<RelationGraphExportResult>;
    downloadImage: (options?: RelationGraphExportOptions) => Promise<RelationGraphExportResult>;
}

function clampPositiveNumber(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
    return value;
}

function clampUnitInterval(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function normalizeFileName(fileName: string | undefined, format: RelationGraphImageFormat): string {
    const base = fileName?.trim() || DEFAULT_EXPORT_FILENAME;
    const suffix = `.${format}`;
    return base.toLowerCase().endsWith(suffix) ? base : `${base}${suffix}`;
}

function waitForNextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function waitForImages(container: HTMLElement): Promise<void> {
    const images = Array.from(container.querySelectorAll('img'));
    if (images.length === 0) return;

    await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>(resolve => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
        });
    }));
}

function applyCloneExportStyles(
    cloneRoot: HTMLElement,
    exportWidth: number,
    exportHeight: number,
    backgroundColor: string,
    viewportTransform: { x: number; y: number; zoom: number },
): void {
    cloneRoot.style.position = 'fixed';
    cloneRoot.style.left = '-100000px';
    cloneRoot.style.top = '0';
    cloneRoot.style.width = `${exportWidth}px`;
    cloneRoot.style.height = `${exportHeight}px`;
    cloneRoot.style.maxWidth = 'none';
    cloneRoot.style.maxHeight = 'none';
    cloneRoot.style.pointerEvents = 'none';
    cloneRoot.style.zIndex = '-1';
    cloneRoot.style.opacity = '1';
    cloneRoot.style.backgroundColor = backgroundColor;

    const canvas = cloneRoot.querySelector<HTMLElement>('.fc-rg__canvas');
    if (canvas) {
        canvas.style.width = `${exportWidth}px`;
        canvas.style.height = `${exportHeight}px`;
        canvas.style.backgroundColor = backgroundColor;
        canvas.style.overflow = 'hidden';
    }

    const reactFlowRoot = cloneRoot.querySelector<HTMLElement>('.react-flow');
    if (reactFlowRoot) {
        reactFlowRoot.style.width = `${exportWidth}px`;
        reactFlowRoot.style.height = `${exportHeight}px`;
        reactFlowRoot.style.backgroundColor = backgroundColor;
    }

    cloneRoot.querySelectorAll<HTMLElement>('.fc-rg__overlay').forEach(node => {
        node.style.display = 'none';
    });

    const viewport = cloneRoot.querySelector<HTMLElement>('.react-flow__viewport');
    if (viewport) {
        viewport.style.transform = `translate(${viewportTransform.x}px, ${viewportTransform.y}px) scale(${viewportTransform.zoom})`;
        viewport.style.transformOrigin = '0 0';
    }
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 立即 revoke 在部分 WebView 中会中断下载，延迟释放更稳妥。
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

async function renderCloneToBlob(
    cloneRoot: HTMLElement,
    format: RelationGraphImageFormat,
    backgroundColor: string,
    scale: number,
    quality: number,
): Promise<Blob> {
    let canvas: HTMLCanvasElement;
    try {
        canvas = await toCanvas(cloneRoot, {
            backgroundColor,
            cacheBust: true,
            pixelRatio: scale,
            // 远程图片/字体跨域失败时使用占位图，避免整个导出流程直接 reject。
            imagePlaceholder: TRANSPARENT_PIXEL_DATA_URL,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`图片渲染失败：${reason}。请检查节点内远程图片/字体是否允许跨域访问。`);
    }

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, mimeType, format === 'jpeg' ? quality : undefined);
    });

    if (!blob) {
        throw new Error('图片导出失败，未生成有效的 Blob。');
    }

    return blob;
}

function RelationNode({ data, selected }: NodeProps<Node<RGNodeData>>) {
    const renderNode = useContext(RenderNodeCtx);
    const isCustom = renderNode !== undefined;

    return (
        <div
            className={[
                'fc-rg-node',
                isCustom          ? 'fc-rg-node--custom'   : '',
                selected && !isCustom ? 'fc-rg-node--selected' : '',
            ].filter(Boolean).join(' ')}
        >
            {/* Ghost handles：零尺寸、不可见 — 实际边坐标由
                BidirectionalEdge 中的浮动边算法计算。 */}
            <Handle type="target" position={Position.Top}    id="t" className="fc-rg-handle--ghost" />
            <Handle type="source" position={Position.Bottom} id="s" className="fc-rg-handle--ghost" />

            {isCustom
                ? renderNode(data as RelationNodeInput, selected ?? false)
                : <div className="fc-rg-node__label">{data.label ?? ''}</div>
            }
        </div>
    );
}

const NODE_TYPES: NodeTypes = { relationNode: RelationNode as NodeTypes['relationNode'] };
const EDGE_TYPES: EdgeTypes = { relationEdge: BidirectionalEdge };

// ─── 边/节点构建器 ─────────────────────────────────────────────────────

function buildRFEdges(inputEdges: RelationEdgeInput[]): Edge[] {
    const edgeKeySet = new Set(inputEdges.map(e => `${e.source}|${e.target}`));

    return inputEdges.map((e, index) => {
        const kind = e.kind ?? 'one_way';
        const hasReverseEdge = edgeKeySet.has(`${e.target}|${e.source}`);
        const marker = {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: 'var(--fc-rg-edge-color, var(--fc-gray-400))',
        };

        return {
            id: e.id ?? `rg-edge-${e.source}-${e.target}-${index}`,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            type: 'relationEdge',
            markerStart: kind === 'two_way' ? marker : undefined,
            markerEnd: marker,
            data: {
                label: e.label,
                kind,
                bidirectional: kind === 'two_way' || hasReverseEdge,
                pairedBidirectional: hasReverseEdge,
            },
        };
    });
}

function buildRFNodes(
    inputNodes: RelationNodeInput[],
    prevNodes?: Node<RGNodeData>[],
): Node<RGNodeData>[] {
    const prevMap = new Map(prevNodes?.map(n => [n.id, n]) ?? []);

    return inputNodes.map(n => {
        const existing = prevMap.get(n.id);
        const node: Node<RGNodeData> = {
            id: n.id,
            type: 'relationNode',
            position: existing?.position ?? { x: 0, y: 0 },
            data: { label: n.label ?? n.id, ...n } as RGNodeData,
        };
        if (existing?.measured) node.measured = existing.measured;
        return node;
    });
}

// ─── 内部组件 ──────────────────────────────────────────────────────────

interface RelationGraphInnerProps {
    inputNodes: RelationNodeInput[];
    inputEdges: RelationEdgeInput[];
    layoutFn: LayoutFunction;
    nodeOrigin: [number, number];
    fitPadding: number;
    fitDuration: number;
    renderNode?: RenderNodeFn;
    onLayoutStateChange?: (state: RelationLayoutState) => void;
    selectedEdgeId?: string | null;
    onSelectedEdgeChange?: (edgeId: string | null) => void;
    rootRef: RefObject<HTMLDivElement | null>;
    exportRef?: ForwardedRef<RelationGraphRef>;
}

function RelationGraphInner({
    inputNodes,
    inputEdges,
    layoutFn,
    nodeOrigin,
    fitPadding,
    fitDuration,
    renderNode,
    onLayoutStateChange,
    selectedEdgeId,
    onSelectedEdgeChange,
    rootRef,
    exportRef,
}: RelationGraphInnerProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<RGNodeData>>(
        buildRFNodes(inputNodes),
    );
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
        buildRFEdges(inputEdges),
    );

    const prevInputRef = useRef({ nodes: inputNodes, edges: inputEdges });
    useEffect(() => {
        const prev = prevInputRef.current;
        if (inputNodes === prev.nodes && inputEdges === prev.edges) return;
        prevInputRef.current = { nodes: inputNodes, edges: inputEdges };
        setNodes(prev => buildRFNodes(inputNodes, prev));
        setEdges(buildRFEdges(inputEdges));
    }, [inputNodes, inputEdges, setNodes, setEdges]);

    useEffect(() => {
        setEdges(prev => prev.map(edge => ({
            ...edge,
            selected: edge.id === selectedEdgeId,
        })));
    }, [selectedEdgeId, setEdges]);

    const layoutState = useRelationLayout({ nodes, edges, layoutFn, nodeOrigin, fitPadding, fitDuration });
    const reactFlow = useReactFlow<Node<RGNodeData>, Edge>();

    useImperativeHandle(exportRef, () => {
        const exportImage = async (options: RelationGraphExportOptions = {}) => {
            if (layoutState.layoutLoading) {
                throw new Error('图谱仍在布局中，暂时无法导出图片。');
            }

            if (layoutState.layoutError) {
                throw new Error(`图谱布局失败，无法导出图片：${layoutState.layoutError.message}`);
            }

            const rootElement = rootRef.current;
            if (!rootElement) {
                throw new Error('图谱根节点不存在，无法导出图片。');
            }

            const currentNodes = reactFlow.getNodes();
            if (currentNodes.length === 0) {
                throw new Error('当前图谱没有节点，无法导出图片。');
            }

            const measuredNodes = currentNodes.filter(node => {
                const width = node.measured?.width ?? node.width ?? 0;
                const height = node.measured?.height ?? node.height ?? 0;
                return width > 0 && height > 0;
            });

            if (measuredNodes.length === 0) {
                throw new Error('当前节点尚未完成尺寸测量，无法导出图片。');
            }

            const format = options.format ?? 'png';
            const padding = clampPositiveNumber(options.padding, DEFAULT_EXPORT_PADDING);
            const scale = clampPositiveNumber(options.scale, DEFAULT_EXPORT_SCALE);
            const backgroundColor = options.backgroundColor ?? DEFAULT_EXPORT_BACKGROUND;
            const quality = clampUnitInterval(options.quality, 0.92);

            const bounds = reactFlow.getNodesBounds(measuredNodes);
            const exportWidth = Math.max(1, Math.ceil(bounds.width + padding * 2));
            const exportHeight = Math.max(1, Math.ceil(bounds.height + padding * 2));
            const viewport = getViewportForBounds(bounds, exportWidth, exportHeight, EXPORT_MIN_ZOOM, EXPORT_MAX_ZOOM, 0);
            const fileName = normalizeFileName(options.fileName, format);

            const cloneRoot = rootElement.cloneNode(true) as HTMLDivElement;
            applyCloneExportStyles(cloneRoot, exportWidth, exportHeight, backgroundColor, viewport);

            document.body.appendChild(cloneRoot);

            try {
                await waitForNextFrame();
                await waitForImages(cloneRoot);

                const blob = await renderCloneToBlob(
                    cloneRoot,
                    format,
                    backgroundColor,
                    scale,
                    quality,
                );

                return {
                    blob,
                    bounds,
                    width: exportWidth,
                    height: exportHeight,
                    fileName,
                };
            } finally {
                cloneRoot.remove();
            }
        };

        return {
            exportImage,
            downloadImage: async (options: RelationGraphExportOptions = {}) => {
                const result = await exportImage(options);
                triggerBlobDownload(result.blob, result.fileName);
                return result;
            },
        };
    }, [layoutState.layoutError, layoutState.layoutLoading, reactFlow, rootRef]);

    const prevStateRef = useRef<RelationLayoutState>({ layoutReady: false, layoutLoading: false, layoutError: null });
    useEffect(() => {
        const p = prevStateRef.current;
        if (
            p.layoutReady   !== layoutState.layoutReady   ||
            p.layoutLoading !== layoutState.layoutLoading ||
            p.layoutError   !== layoutState.layoutError
        ) {
            prevStateRef.current = layoutState;
            onLayoutStateChange?.(layoutState);
        }
    }, [layoutState, onLayoutStateChange]);

    const handleEdgeClick = useCallback((_: ReactMouseEvent, edge: Edge) => {
        onSelectedEdgeChange?.(edge.id);
    }, [onSelectedEdgeChange]);

    const handlePaneClick = useCallback(() => {
        onSelectedEdgeChange?.(null);
    }, [onSelectedEdgeChange]);

    return (
        <RenderNodeCtx.Provider value={renderNode}>
            <div className="fc-rg__canvas">
                {layoutState.layoutLoading && (
                    <div className="fc-rg__overlay fc-rg__overlay--loading" role="status">
                        <span className="fc-rg__spinner" aria-hidden="true" />
                        <span>布局计算中…</span>
                    </div>
                )}
                {layoutState.layoutError && !layoutState.layoutLoading && (
                    <div className="fc-rg__overlay fc-rg__overlay--error" role="alert">
                        <span>布局失败：{layoutState.layoutError.message}</span>
                    </div>
                )}
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onEdgeClick={handleEdgeClick}
                    onPaneClick={handlePaneClick}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    nodeOrigin={nodeOrigin}
                    fitView={false}
                    minZoom={0.05}
                    maxZoom={4}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                </ReactFlow>
            </div>
        </RenderNodeCtx.Provider>
    );
}

// ─── 公开组件 ─────────────────────────────────────────────────────────

export interface RelationGraphProps {
    nodes: RelationNodeInput[];
    edges: RelationEdgeInput[];
    layoutFn: LayoutFunction;
    /**
     * 自定义节点内容渲染函数。
     * 接收节点原始数据和选中状态，返回 ReactNode 作为节点的完整视觉内容。
     * 传入后组件不渲染任何默认样式，由调用方全权控制外观。
     *
     * @example
     * renderNode={(data, selected) => (
     *   <div className={selected ? 'my-node selected' : 'my-node'}>
     *     <img src={data.cover} />
     *     <span>{data.title}</span>
     *   </div>
     * )}
     */
    renderNode?: (data: RelationNodeInput, selected: boolean) => ReactNode;
    nodeOrigin?: [number, number];
    /** fitBounds 视口边距（0–1），默认 0.1 */
    fitPadding?: number;
    /** fitBounds 动画时长（ms），默认 500 */
    fitDuration?: number;
    onLayoutStateChange?: (state: RelationLayoutState) => void;
    selectedEdgeId?: string | null;
    onSelectedEdgeChange?: (edgeId: string | null) => void;
    height?: string | number;
    width?: string | number;
    className?: string;
    style?: CSSProperties;
}

export const RelationGraph = forwardRef<RelationGraphRef, RelationGraphProps>(function RelationGraph({
    nodes,
    edges,
    layoutFn,
    renderNode,
    nodeOrigin = [0, 0],
    fitPadding = 0.1,
    fitDuration = 500,
    onLayoutStateChange,
    selectedEdgeId,
    onSelectedEdgeChange,
    height = '100%',
    width = '100%',
    className,
    style,
}: RelationGraphProps, ref) {
    const rootRef = useRef<HTMLDivElement>(null);

    return (
        <div
            className={`fc-rg${className ? ` ${className}` : ''}`}
            ref={rootRef}
            style={{ width, height, ...style }}
        >
            <ReactFlowProvider>
                <RelationGraphInner
                    inputNodes={nodes}
                    inputEdges={edges}
                    layoutFn={layoutFn}
                    renderNode={renderNode}
                    nodeOrigin={nodeOrigin}
                    fitPadding={fitPadding}
                    fitDuration={fitDuration}
                    onLayoutStateChange={onLayoutStateChange}
                    selectedEdgeId={selectedEdgeId}
                    onSelectedEdgeChange={onSelectedEdgeChange}
                    rootRef={rootRef}
                    exportRef={ref}
                />
            </ReactFlowProvider>
        </div>
    );
});

RelationGraph.displayName = 'RelationGraph';
