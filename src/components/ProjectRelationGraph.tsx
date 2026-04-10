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
    DEMO_ENTRIES,
    DEMO_RELATIONS,
    type RelationDemoNode,
    toRelationEdges,
    toRelationNodes,
} from './relationGraphFixture'
import './RelationDemo.css'
import './ProjectRelationGraph.css'

interface ProjectRelationGraphProps {
    onBack?: () => void
}

function BackArrowIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
                d="M8.6 3.25L4.1 7.75L8.6 12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M4.5 7.75H12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
}

const INITIAL_LAYOUT_STATE: RelationLayoutState = {
    layoutReady: false,
    layoutLoading: false,
    layoutError: null,
}

export default function ProjectRelationGraph({onBack}: ProjectRelationGraphProps) {
    const [graphKey, setGraphKey] = useState(0)
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)

    const entries = useMemo(() => DEMO_ENTRIES, [])
    const relations = useMemo(() => DEMO_RELATIONS, [])
    const nodes = useMemo(() => toRelationNodes(entries), [entries])
    const nodeIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries])
    const edges = useMemo(() => toRelationEdges(relations, nodeIds), [nodeIds, relations])

    const layoutFn = useCallback<LayoutFunction>(async (request: LayoutRequest): Promise<LayoutResponse> => {
        const response = await compute_layout({
            nodeOrigin: request.nodeOrigin ?? null,
            nodes: request.nodes,
            edges: request.edges,
        })

        return {
            positions: response.positions,
            bounds: response.bounds ?? undefined,
            layoutHash: response.layoutHash ?? undefined,
        }
    }, [])

    const handleRefresh = useCallback(() => {
        setLayoutState(INITIAL_LAYOUT_STATE)
        setGraphKey((prev) => prev + 1)
    }, [])

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
        <div className="project-relation-graph">
            <div className="project-relation-graph__toolbar">
                <div className="project-relation-graph__toolbar-left">
                    {onBack && (
                        <Button size="sm" variant="ghost" onClick={onBack}>
                            <span className="project-relation-graph__back-icon" aria-hidden="true">
                                <BackArrowIcon/>
                            </span>
                            返回
                        </Button>
                    )}
                </div>
                <div className="project-relation-graph__toolbar-right">
                    <Button size="sm" variant="outline" onClick={handleRefresh}>
                        刷新
                    </Button>
                </div>
            </div>

            <div className="project-relation-graph__meta">
                业务数据：{entries.length} 个词条，{relations.length} 条关系
                {layoutState.layoutLoading && ' · 布局计算中'}
                {layoutState.layoutError && ' · 布局失败'}
            </div>

            {layoutState.layoutError && (
                <div className="project-relation-graph__error">
                    布局失败：{layoutState.layoutError.message}
                </div>
            )}

            <div className="project-relation-graph__shell">
                <RelationGraph
                    key={graphKey}
                    nodes={nodes}
                    edges={edges}
                    layoutFn={layoutFn}
                    renderNode={renderNode}
                    height={720}
                    fitPadding={0.12}
                    fitDuration={500}
                    onLayoutStateChange={setLayoutState}
                />
            </div>
        </div>
    )
}
