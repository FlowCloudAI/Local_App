import {useCallback, useMemo, useState} from 'react'
import {
    Button,
    type LayoutFunction,
    type LayoutRequest,
    type LayoutResponse,
    RelationGraph,
    type RelationLayoutState,
    type RelationNodeInput,
} from 'flowcloudai-ui'
import {compute_layout, type LayoutParamsPayload} from '../../../api'
import {
    countTwoWayRelations,
    DEMO_ENTRIES,
    DEMO_RELATIONS,
    type RelationDemoNode,
    toRelationEdges,
    toRelationNodes,
} from '../fixtures/relationGraphFixture'
import './RelationDemo.css'

const DEFAULT_LAYOUT_PARAMS: LayoutParamsPayload = {
    collisionPadding: 20,
    nodeGap: 28,
    collisionPassesPerIteration: 5,
    finalCollisionPasses: 40,
    edgeLengthAlphaRho: 0.7,
    edgeLengthAlphaCv: 0.5,
    edgeLengthMin: 84,
    edgeLengthMax: 320,
    twoWayEdgeLengthFactor: 0.84,
    twoWayAttractionWeight: 1.26,
    initialTemperatureGamma: 0.26,
    minTemperatureGamma: 0.08,
    minTemperatureRatio: 1.5,
    iterationBase: 54,
    iterationSqrtScale: 28,
    iterationRhoScale: 150,
    iterationMin: 72,
    iterationMax: 360,
    initRadiusBetaRmax: 1.0,
    estimatedAreaBetaRho: 0.9,
    estimatedAreaBetaCv: 0.65,
    pathishEdgeLengthReduction: 0.32,
    pathishInitRadiusReduction: 0.34,
    pathishAxisCompactionMax: 0.36,
    pathishRadialPullMax: 0.2,
    pathishLeafPullMax: 0.34,
    pathishBranchSmoothingMax: 0.28,
    postLayoutCompactionPasses: 5,
    earlyStopThreshold: 0.14,
    earlyStopStreak: 12,
    componentGap: 84,
    shelfRowMaxWidth: 1800,
    isolatedNodeHorizontalGap: 56,
    clusterBoxGap: 56,
    clusterLinkDistanceBase: 110,
    clusterRepulsionSoft: 14,
    clusterCenterPull: 0.015,
    clusterTemperatureInitial: 42,
    clusterTemperatureDecay: 0.92,
    clusterIterations: 80,
    clusterTwoWayBonus: 0.35,
    minDistance: 1e-6,
}

interface RelationDemoProps {
    embedded?: boolean
    title?: string
    description?: string
    onBack?: () => void
}

const INITIAL_LAYOUT_STATE: RelationLayoutState = {
    layoutReady: false,
    layoutLoading: false,
    layoutError: null,
}

export default function RelationDemo({
                                         embedded = false,
                                         title,
                                         description,
                                         onBack,
                                     }: RelationDemoProps) {
    const [graphKey, setGraphKey] = useState(0)
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)
    const [layoutHash, setLayoutHash] = useState<string | null>(null)
    const [layoutParams, setLayoutParams] = useState<LayoutParamsPayload>(DEFAULT_LAYOUT_PARAMS)

    const entries = useMemo(() => DEMO_ENTRIES, [])
    const relations = useMemo(() => DEMO_RELATIONS, [])

    const nodes = useMemo(() => toRelationNodes(entries), [entries])
    const nodeIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries])
    const edges = useMemo(() => toRelationEdges(relations, nodeIds), [nodeIds, relations])
    const twoWayCount = useMemo(() => countTwoWayRelations(relations), [relations])

    const layoutFn = useCallback<LayoutFunction>(async (request: LayoutRequest): Promise<LayoutResponse> => {
        const response = await compute_layout({
            nodeOrigin: request.nodeOrigin ?? null,
            nodes: request.nodes,
            edges: request.edges,
            params: layoutParams,
        })
        setLayoutHash(response.layoutHash ?? null)

        return {
            positions: response.positions,
            bounds: response.bounds ?? undefined,
            layoutHash: response.layoutHash ?? undefined,
        }
    }, [layoutParams])

    const handleRelayout = useCallback(() => {
        setLayoutHash(null)
        setLayoutState(INITIAL_LAYOUT_STATE)
        setGraphKey((prev) => prev + 1)
    }, [])

    const updateLayoutParam = useCallback(<K extends keyof LayoutParamsPayload>(
        key: K,
        value: LayoutParamsPayload[K],
    ) => {
        setLayoutParams((prev) => ({...prev, [key]: value}))
    }, [])

    const resetLayoutParams = useCallback(() => {
        setLayoutParams(DEFAULT_LAYOUT_PARAMS)
    }, [])

    const renderNumberField = useCallback((
        label: string,
        key: keyof LayoutParamsPayload,
        step: number | string = 1,
        min?: number,
        max?: number,
        hint?: string,
    ) => {
        const value = layoutParams[key]
        return (
            <div className="relation-demo__field">
                <label htmlFor={`rd-param-${key}`}>{label}</label>
                {hint && <span className="relation-demo__field-hint">{hint}</span>}
                <input
                    id={`rd-param-${key}`}
                    type="number"
                    step={step}
                    min={min}
                    max={max}
                    value={value ?? ''}
                    onChange={(e) => {
                        const v = e.target.value
                        if (v === '') {
                            updateLayoutParam(key, undefined)
                            return
                        }
                        const num = Number(v)
                        updateLayoutParam(key, Number.isFinite(num) ? num : undefined)
                    }}
                />
            </div>
        )
    }, [layoutParams, updateLayoutParam])

    const viewTitle = title ?? '关系图谱 RelationGraph'
    const viewDescription = description ?? '这个页面现在按真实宿主数据结构工作：先使用 `EntryBrief[] / EntryRelation[]` 组装业务数据，再映射成 `RelationGraph` 需要的 `nodes / edges` 协议，`layoutFn` 只负责调用 Tauri `compute_layout`。'
    const eyebrow = embedded ? 'ProjectEditor 内嵌视图' : '临时测试入口'

    const renderNode = useCallback((data: RelationNodeInput, selected: boolean) => {
        const node = data as RelationDemoNode

        return (
            <div className={selected ? 'relation-demo-node relation-demo-node--selected' : 'relation-demo-node'}>
                <div className="relation-demo-node__cover-wrap">
                    <img
                        className="relation-demo-node__cover"
                        src={node.cover_image}
                        alt={node.title}
                    />
                </div>
                <div className="relation-demo-node__body">
                    <div className="relation-demo-node__title" title={node.title}>
                        {node.title}
                    </div>
                    <div className="relation-demo-node__summary" title={node.summary}>
                        {node.summary}
                    </div>
                </div>
            </div>
        )
    }, [])

    return (
        <div className={embedded ? 'relation-demo relation-demo--embedded' : 'relation-demo'}>
            <div className="relation-demo__header">
                <div>
                    <p className="relation-demo__eyebrow">{eyebrow}</p>
                    <h1 className="relation-demo__title">{viewTitle}</h1>
                    <p className="relation-demo__description">
                        {viewDescription}
                    </p>
                </div>
                <div className="relation-demo__actions">
                    {onBack && (
                        <Button size="sm" variant="ghost" onClick={onBack}>
                            返回概览
                        </Button>
                    )}
                </div>
            </div>

            <div className="relation-demo__meta">
                <div className="relation-demo__meta-card">
                    <span className="relation-demo__meta-label">布局状态</span>
                    <span className="relation-demo__meta-value">
                        {layoutState.layoutLoading
                            ? '计算中'
                            : layoutState.layoutError
                                ? '失败'
                                : layoutState.layoutReady
                                    ? '已完成'
                                    : '待开始'}
                    </span>
                </div>
                <div className="relation-demo__meta-card">
                    <span className="relation-demo__meta-label">业务数据</span>
                    <span className="relation-demo__meta-value">
                        {entries.length} 个词条 / {relations.length} 条关系
                    </span>
                </div>
                <div className="relation-demo__meta-card">
                    <span className="relation-demo__meta-label">双向关系</span>
                    <span className="relation-demo__meta-value">
                        {twoWayCount} 条边记录
                    </span>
                </div>
                <div className="relation-demo__meta-card relation-demo__meta-card--wide">
                    <span className="relation-demo__meta-label">layoutHash</span>
                    <span className="relation-demo__meta-value relation-demo__meta-value--mono">
                        {layoutHash ?? '尚未返回'}
                    </span>
                </div>
            </div>

            {layoutState.layoutError && (
                <div className="relation-demo__error">
                    布局失败：{layoutState.layoutError.message}
                </div>
            )}

            <div className="relation-demo__workspace">
                <div className="relation-demo__graph-shell">
                    <RelationGraph
                        key={graphKey}
                        nodes={nodes}
                        edges={edges}
                        layoutFn={layoutFn}
                        renderNode={renderNode}
                        nodeOrigin={[0, 0]}
                        height="100%"
                        fitPadding={0.12}
                        fitDuration={500}
                        onLayoutStateChange={setLayoutState}
                    />
                </div>
                <div className="relation-demo__sidebar">
                    <section className="relation-demo__panel">
                        <div className="relation-demo__panel-header">
                            <h3 className="relation-demo__panel-title">布局参数</h3>
                            <Button size="sm" onClick={handleRelayout}>重新布局</Button>
                        </div>
                        <div className="relation-demo__panel-body">
                            <div className="relation-demo__field-row">
                                {renderNumberField('碰撞间距', 'collisionPadding', 1, undefined, undefined, '节点之间的最小间距，避免节点重叠。调大：节点分布更松散；调小：允许更紧密的排列。')}
                                {renderNumberField('节点间隙', 'nodeGap', 1, undefined, undefined, '节点之间的基础间隙。调大：整体节点间距增大；调小：节点更紧凑。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('每轮碰撞修正', 'collisionPassesPerIteration', 1, 0, undefined, '每轮迭代中碰撞检测的修正次数。调大：重叠减少得更积极，但计算量增加；调小：可能出现轻微重叠。')}
                                {renderNumberField('最终碰撞修正', 'finalCollisionPasses', 1, 0, undefined, '最终额外的碰撞修正轮数。调大：布局结果更干净，无重叠；调小：收尾更快，但可能残留重叠。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('边长密度系数', 'edgeLengthAlphaRho', 0.1, undefined, undefined, '边长目标与图密度的关联系数。调大：高密度图边长更短；调小：边长受密度影响减弱。')}
                                {renderNumberField('边长离散系数', 'edgeLengthAlphaCv', 0.1, undefined, undefined, '边长目标与节点度数差异的关联系数。调大：度数差异对边长影响更大；调小：边长更均匀。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('最小边长', 'edgeLengthMin', 1, 0, undefined, '单边长度的下限。调大：短边被拉长，节点更分散；调小：允许节点非常接近。')}
                                {renderNumberField('最大边长', 'edgeLengthMax', 1, 0, undefined, '单边长度的上限。调大：长边可以更长，图更舒展；调小：长边被压缩，图更紧凑。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('双向边长因子', 'twoWayEdgeLengthFactor', 0.01, undefined, undefined, '双向关系边长的缩放因子。调大：双向关系节点距离更远；调小：双向节点更贴近。')}
                                {renderNumberField('双向吸引权重', 'twoWayAttractionWeight', 0.01, undefined, undefined, '双向关系额外吸引权重。调大：双向节点被拉得更近；调小：与普通边差异减小。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('初始温度系数', 'initialTemperatureGamma', 0.01, undefined, undefined, '初始退火温度系数。调大：初始阶段节点移动更剧烈；调小：收敛更慢但更稳定。')}
                                {renderNumberField('最低温度系数', 'minTemperatureGamma', 0.01, undefined, undefined, '最低温度系数。调大：后期仍有一定扰动，可能跳出局部最优；调小：后期更稳定，可能陷入局部最优。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('温度倍数下限', 'minTemperatureRatio', 0.1, undefined, undefined, '温度相对于初始温度的最小倍数。调大：冷却更早停止；调小：冷却更彻底。')}
                                {renderNumberField('迭代基数', 'iterationBase', 1, 0, undefined, '迭代次数基数。调大：整体迭代更多，布局更精细；调小：计算更快但可能欠优化。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('迭代 sqrt 系数', 'iterationSqrtScale', 1, 0, undefined, '基于节点数开方的迭代增量。调大：大图获得更多迭代；调小：迭代数随规模增长更慢。')}
                                {renderNumberField('迭代密度系数', 'iterationRhoScale', 1, 0, undefined, '基于图密度的迭代增量。调大：复杂图获得更多迭代；调小：密度对迭代数影响减弱。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('最小迭代次数', 'iterationMin', 1, 0, undefined, '最小迭代次数。调大：保证足够的优化轮数；调小：小图可能过早结束。')}
                                {renderNumberField('最大迭代次数', 'iterationMax', 1, 0, undefined, '最大迭代次数上限。调大：允许更充分的优化；调小：限制计算时间。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('初始化半径系数', 'initRadiusBetaRmax', 0.1, undefined, undefined, '节点初始分布半径系数。调大：节点初始位置更分散；调小：初始更集中，可能增加收敛时间。')}
                                {renderNumberField('面积密度系数', 'estimatedAreaBetaRho', 0.1, undefined, undefined, '估算布局面积与图密度的系数。调大：预估面积更大，节点更稀疏；调小：布局更紧凑。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('面积离散系数', 'estimatedAreaBetaCv', 0.1, undefined, undefined, '估算布局面积与度数差异的系数。调大：度数差异大时面积膨胀更明显；调小：面积更均匀。')}
                                {renderNumberField('链式边长回缩', 'pathishEdgeLengthReduction', 0.01, undefined, undefined, '链式结构边长回缩比例。调大：链式节点被压得更短；调小：链式结构更舒展。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('链式半径回缩', 'pathishInitRadiusReduction', 0.01, undefined, undefined, '链式结构初始半径回缩。调大：链式节点初始分布更紧凑；调小：链式初始更分散。')}
                                {renderNumberField('链式主轴压缩', 'pathishAxisCompactionMax', 0.01, undefined, undefined, '链式主轴压缩上限。调大：链式结构被压得更扁；调小：链式保持更自然的弯曲。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('链式径向回收', 'pathishRadialPullMax', 0.01, undefined, undefined, '链式径向回收力度。调大：链式节点向中心聚拢更明显；调小：链式更自由伸展。')}
                                {renderNumberField('链式叶子回拽', 'pathishLeafPullMax', 0.01, undefined, undefined, '链式叶子节点回拽力度。调大：叶子节点更贴近主干；调小：叶子伸展更自由。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('链式分支平滑', 'pathishBranchSmoothingMax', 0.01, undefined, undefined, '链式分支平滑上限。调大：分支过渡更圆润；调小：分支角度更尖锐。')}
                                {renderNumberField('后压迭代轮数', 'postLayoutCompactionPasses', 1, 0, undefined, '布局完成后压缩迭代轮数。调大：整体更紧凑但可能引入重叠；调小：保持原始舒展度。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('早停阈值', 'earlyStopThreshold', 0.01, undefined, undefined, '能量变化低于此值时触发早停。调大：更容易早停，节省时间；调小：优化更充分。')}
                                {renderNumberField('早停连续轮数', 'earlyStopStreak', 1, 0, undefined, '连续多轮低于阈值才早停。调大：避免误判收敛；调小：更早结束。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('分量间距', 'componentGap', 1, 0, undefined, '不连通分量之间的间距。调大：各分量分布更开；调小：分量更紧凑。')}
                                {renderNumberField('Shelf 最大宽度', 'shelfRowMaxWidth', 1, 0, undefined, 'Shelf 布局单行最大宽度。调大：每行容纳更多孤立节点；调小：行数增加，更竖长。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('孤立节点水平间距', 'isolatedNodeHorizontalGap', 1, 0, undefined, '孤立节点之间的水平间距。调大：孤立节点排列更稀疏；调小：更紧凑。')}
                                {renderNumberField('簇盒子间距', 'clusterBoxGap', 1, 0, undefined, '簇与簇（或簇边界）之间的间距。调大：簇之间更松散；调小：簇更密集。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('簇连接距离', 'clusterLinkDistanceBase', 1, 0, undefined, '簇内节点连接的基础距离。调大：簇内节点更分散；调小：簇内更紧凑。')}
                                {renderNumberField('簇软斥力', 'clusterRepulsionSoft', 0.1, undefined, undefined, '簇内软斥力强度。调大：簇内节点相互推开更明显；调小：簇内节点可以更近。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('簇中心拉力', 'clusterCenterPull', 0.001, undefined, undefined, '簇中心对节点的拉力。调大：节点更向簇中心聚拢；调小：簇内分布更自由。')}
                                {renderNumberField('簇初始温度', 'clusterTemperatureInitial', 0.1, undefined, undefined, '簇布局初始温度。调大：簇初始阶段更活跃；调小：簇收敛更慢但更稳定。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('簇温度衰减', 'clusterTemperatureDecay', 0.001, undefined, undefined, '簇温度衰减率。调大：冷却更快；调小：优化过程更长。')}
                                {renderNumberField('簇迭代次数', 'clusterIterations', 1, 0, undefined, '簇布局迭代次数。调大：簇结构更精细；调小：簇布局更快但可能欠优化。')}
                            </div>
                            <div className="relation-demo__field-row">
                                {renderNumberField('簇双向奖励', 'clusterTwoWayBonus', 0.01, undefined, undefined, '簇内双向关系的额外奖励。调大：双向节点在簇内更靠近；调小：与普通边差异减小。')}
                                {renderNumberField('最小距离', 'minDistance', 'any', undefined, undefined, '数值计算中的最小距离，防止除零。通常无需调整。')}
                            </div>
                            <div className="relation-demo__button-row">
                                <Button size="sm" variant="ghost" onClick={resetLayoutParams}>
                                    重置默认值
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
