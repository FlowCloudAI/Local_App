// app_main/src/features/relation-graph/components/RelationGraph/types.ts
// 前端组件与宿主提供的布局函数之间共享的固定协议类型。
// 字段名称不可更改 — 它们构成公开约定。

// ─── 布局协议 ──────────────────────────────────────────────────────────

/** 发送给布局后端的节点描述符。宽度/高度必须来自真实的 DOM 测量值。 */
export interface LayoutNode {
    id: string;
    width: number;
    height: number;
}

/** 发送给布局后端的边描述符。 */
export interface LayoutEdge {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    /** 方向提示：'one_way'（默认）或 'two_way'。 */
    kind?: 'one_way' | 'two_way';
}

/** 布局请求负载 — 前端 → 后端。 */
export interface LayoutRequest {
    /** React Flow nodeOrigin。默认 [0, 0] 表示节点位置为左上角。 */
    nodeOrigin?: [number, number];
    nodes: LayoutNode[];
    edges: LayoutEdge[];
    /** 可选布局参数，由宿主决定是否转发给具体布局实现。 */
    params?: RelationLayoutParams;
}

/** 后端布局算法支持的可选参数。字段为 camelCase，对应 Rust 侧 LayoutParamsPayload。 */
export interface RelationLayoutParams {
    collisionPadding?: number;
    nodeGap?: number;
    collisionPassesPerIteration?: number;
    finalCollisionPasses?: number;
    edgeLengthAlphaRho?: number;
    edgeLengthAlphaCv?: number;
    edgeLengthMin?: number;
    edgeLengthMax?: number;
    twoWayEdgeLengthFactor?: number;
    twoWayAttractionWeight?: number;
    initialTemperatureGamma?: number;
    minTemperatureGamma?: number;
    minTemperatureRatio?: number;
    iterationBase?: number;
    iterationSqrtScale?: number;
    iterationRhoScale?: number;
    iterationMin?: number;
    iterationMax?: number;
    initRadiusBetaRmax?: number;
    estimatedAreaBetaRho?: number;
    estimatedAreaBetaCv?: number;
    pathishEdgeLengthReduction?: number;
    pathishInitRadiusReduction?: number;
    pathishAxisCompactionMax?: number;
    pathishRadialPullMax?: number;
    pathishLeafPullMax?: number;
    pathishBranchSmoothingMax?: number;
    postLayoutCompactionPasses?: number;
    earlyStopThreshold?: number;
    earlyStopStreak?: number;
    componentGap?: number;
    shelfRowMaxWidth?: number;
    isolatedNodeHorizontalGap?: number;
    clusterBoxGap?: number;
    clusterLinkDistanceBase?: number;
    clusterRepulsionSoft?: number;
    clusterCenterPull?: number;
    clusterTemperatureInitial?: number;
    clusterTemperatureDecay?: number;
    clusterIterations?: number;
    clusterTwoWayBonus?: number;
    fixedRandomSeed?: number;
    minDistance?: number;
    attractiveDirectionSalt?: number;
    finalCollisionSalt?: number;
    collisionDirectionSalt?: number;
}

/** 布局后端返回的单个节点位置。 */
export interface LayoutPosition {
    x: number;
    y: number;
}

/**
 * 已布局图的包围盒。
 * 坐标使用包围矩形左上角。
 */
export interface LayoutBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 布局响应负载 — 后端 → 前端。 */
export interface LayoutResponse {
    /** 以节点 id 为键。映射表中缺失的节点保持当前位置。 */
    positions: Record<string, LayoutPosition>;
    /** 若存在，组件将在首次成功布局后 fitBounds 到此矩形。 */
    bounds?: LayoutBounds;
    /** 可选不透明哈希；前端未使用，但可能在后续请求中转发。 */
    layoutHash?: string;
}

/**
 * 宿主注入 RelationGraph 的异步布局函数。
 * 组件从不直接发起网络调用或 `invoke()` — 仅调用此函数。
 */
export type LayoutFunction = (request: LayoutRequest) => Promise<LayoutResponse>;

/** 可复用的布局提供者包装类型，适合在 demo 或宿主侧组织多套布局实现。 */
export interface LayoutProvider {
    computeLayout: LayoutFunction;
}

// ─── 组件输入类型 ────────────────────────────────────────────────────

/** 宿主应用程序提供的节点数据。 */
export interface RelationNodeInput {
    id: string;
    /** 显示为节点标签。缺失时回退到 id。 */
    label?: string;
    [key: string]: unknown;
}

/** 宿主应用程序提供的边数据。 */
export interface RelationEdgeInput {
    /** 若省略，将从 source + target + index 生成 id。 */
    id?: string;
    source: string;
    target: string;
    /** 存在时显示为边标签。 */
    label?: string;
    /** 'one_way'（默认）或 'two_way'。 */
    kind?: 'one_way' | 'two_way';
    sourceHandle?: string;
    targetHandle?: string;
}

// ─── 布局状态 ─────────────────────────────────────────────────────────────

/** 布局生命周期的当前状态，通过 onLayoutStateChange 暴露。 */
export interface RelationLayoutState {
    /** 首次成功布局应用后为 true。 */
    layoutReady: boolean;
    /** 布局请求进行中时为 true。 */
    layoutLoading: boolean;
    /** 最近一次布局调用抛出异常或拒绝时设置。 */
    layoutError: Error | null;
}
