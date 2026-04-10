import { useCallback, useMemo, useState } from 'react'
import {
    Button,
    RelationGraph,
    type LayoutFunction,
    type LayoutRequest,
    type LayoutResponse,
    type RelationLayoutState,
    type RelationNodeInput,
} from 'flowcloudai-ui'
import { compute_layout } from '../api'
import {
    countTwoWayRelations,
    DEMO_ENTRIES,
    DEMO_RELATIONS,
    type RelationDemoNode,
    toRelationEdges,
    toRelationNodes,
} from './relationGraphFixture'
import './RelationDemo.css'

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
    const [nodeOrigin, setNodeOrigin] = useState<[number, number]>([0, 0])
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)
    const [layoutHash, setLayoutHash] = useState<string | null>(null)

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
        })
        setLayoutHash(response.layoutHash ?? null)

        return {
            positions: response.positions,
            bounds: response.bounds ?? undefined,
            layoutHash: response.layoutHash ?? undefined,
        }
    }, [])

    const handleRelayout = useCallback(() => {
        setLayoutHash(null)
        setLayoutState(INITIAL_LAYOUT_STATE)
        setGraphKey((prev) => prev + 1)
    }, [])

    const originLabel = nodeOrigin[0] === 0.5 && nodeOrigin[1] === 0.5
        ? '中心点 [0.5, 0.5]'
        : '左上角 [0, 0]'
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
                    <Button
                        size="sm"
                        variant={nodeOrigin[0] === 0 ? 'outline' : 'ghost'}
                        onClick={() => setNodeOrigin([0, 0])}
                    >
                        左上角原点
                    </Button>
                    <Button
                        size="sm"
                        variant={nodeOrigin[0] === 0.5 ? 'outline' : 'ghost'}
                        onClick={() => setNodeOrigin([0.5, 0.5])}
                    >
                        中心点原点
                    </Button>
                    <Button size="sm" onClick={handleRelayout}>
                        重新布局
                    </Button>
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
                    <span className="relation-demo__meta-label">节点原点</span>
                    <span className="relation-demo__meta-value">{originLabel}</span>
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

            <div className="relation-demo__graph-shell">
                <RelationGraph
                    key={`${graphKey}-${nodeOrigin.join('-')}`}
                    nodes={nodes}
                    edges={edges}
                    layoutFn={layoutFn}
                    renderNode={renderNode}
                    nodeOrigin={nodeOrigin}
                    height={embedded ? 720 : 640}
                    fitPadding={0.12}
                    fitDuration={500}
                    onLayoutStateChange={setLayoutState}
                />
            </div>
        </div>
    )
}
