import {useCallback, useEffect, useMemo, useState} from 'react'
import {
    Button,
    RelationGraph,
    type LayoutFunction,
    type LayoutRequest,
    type LayoutResponse,
    type RelationLayoutState,
    type RelationNodeInput,
} from 'flowcloudai-ui'
import {
    compute_layout,
    db_list_entries,
    db_list_relations_for_project,
    type EntryBrief,
    type EntryRelation,
} from '../../../api'
import {
    type RelationDemoNode,
    toRelationEdges,
    toRelationNodes,
} from '../fixtures/relationGraphFixture'
import '../dev/RelationDemo.css'
import './ProjectRelationGraph.css'

interface ProjectRelationGraphProps {
    projectId: string
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

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : '未知错误')
}

export default function ProjectRelationGraph({projectId, onBack}: ProjectRelationGraphProps) {
    const [graphKey, setGraphKey] = useState(0)
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [relations, setRelations] = useState<EntryRelation[]>([])
    const [dataLoading, setDataLoading] = useState(false)
    const [dataError, setDataError] = useState<Error | null>(null)
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)

    const nodes = useMemo(() => toRelationNodes(entries), [entries])
    const nodeIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries])
    const edges = useMemo(() => toRelationEdges(relations, nodeIds), [nodeIds, relations])

    const loadGraphData = useCallback(async () => {
        setDataLoading(true)
        setDataError(null)

        try {
            const [nextEntries, nextRelations] = await Promise.all([
                db_list_entries({projectId, limit: 1000, offset: 0}),
                db_list_relations_for_project(projectId),
            ])

            setEntries(nextEntries)
            setRelations(nextRelations)
            setLayoutState(INITIAL_LAYOUT_STATE)
            setGraphKey((prev) => prev + 1)
        } catch (error) {
            setDataError(normalizeError(error))
        } finally {
            setDataLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        void loadGraphData()
    }, [loadGraphData])

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
        void loadGraphData()
    }, [loadGraphData])

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
                    <Button size="sm" variant="outline" onClick={handleRefresh} disabled={dataLoading}>
                        {dataLoading ? '刷新中' : '刷新'}
                    </Button>
                </div>
            </div>

            <div className="project-relation-graph__meta">
                业务数据：{entries.length} 个词条，{relations.length} 条关系
                {dataLoading && ' · 数据加载中'}
                {dataError && ' · 数据加载失败'}
                {layoutState.layoutLoading && ' · 布局计算中'}
                {layoutState.layoutError && ' · 布局失败'}
            </div>

            {dataError && (
                <div className="project-relation-graph__error">
                    数据加载失败：{dataError.message}
                </div>
            )}

            {layoutState.layoutError && (
                <div className="project-relation-graph__error">
                    布局失败：{layoutState.layoutError.message}
                </div>
            )}

            <div className="project-relation-graph__shell">
                {dataLoading && entries.length === 0 ? (
                    <div className="project-relation-graph__notice">正在加载项目关系数据…</div>
                ) : dataError ? (
                    <div className="project-relation-graph__notice">无法展示关系图，请先处理数据加载错误。</div>
                ) : entries.length === 0 ? (
                    <div className="project-relation-graph__notice">当前项目还没有词条，暂时无法生成关系图。</div>
                ) : (
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
                )}
            </div>
        </div>
    )
}
