import {useCallback, useEffect, useMemo, useState, type CSSProperties} from 'react'
import {convertFileSrc} from '@tauri-apps/api/core'
import {Button} from 'flowcloudai-ui'
import {RelationGraph} from './RelationGraph/RelationGraph'
import EntryTypeIcon from '../../project-editor/components/EntryTypeIcon'
import type {
    LayoutFunction,
    LayoutRequest,
    LayoutResponse,
    RelationLayoutState,
    RelationNodeInput,
} from './RelationGraph/types'
import {
    compute_layout,
    db_get_relation_graph_data,
    db_list_all_entry_types,
    db_list_entries,
    entryTypeKey,
    type EntryTypeView,
    type RelationGraphEdge,
    type RelationGraphNode,
} from '../../../api'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectRelationGraph.css'

interface ProjectRelationGraphProps {
    projectId: string
    onBack?: () => void
}

function BackArrow() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 16, height: 16}}>
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

type ProjectRelationNode = RelationNodeInput & RelationGraphNode & {entryType?: string | null}

/** 一次性拉取的词条数量上限，用于把 type 映射到图节点；超出的节点回退为无类型样式。 */
const ENTRY_TYPE_LOOKUP_LIMIT = 2000

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : '未知错误')
}

function fallbackCover(seed: string, title: string): string {
    const mark = title.trim().slice(0, 2) || '词条'
    const hue = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
        <rect width="96" height="96" rx="18" fill="hsl(${hue} 62% 44%)" />
        <circle cx="70" cy="26" r="16" fill="rgba(255,255,255,0.16)" />
        <text x="48" y="58" fill="white" font-size="22" font-family="Microsoft YaHei, sans-serif" font-weight="700" text-anchor="middle">${mark}</text>
      </svg>
    `.trim()
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function coverSrc(node: RelationGraphNode): string {
    const cover = node.coverImage
    if (!cover) return fallbackCover(node.id, node.title)
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(cover)) return cover
    return convertFileSrc(String(cover), 'fcimg')
}

export default function ProjectRelationGraph({projectId, onBack}: ProjectRelationGraphProps) {
    const [graphKey, setGraphKey] = useState(0)
    const [nodes, setNodes] = useState<ProjectRelationNode[]>([])
    const [edges, setEdges] = useState<RelationGraphEdge[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [dataLoading, setDataLoading] = useState(false)
    const [dataError, setDataError] = useState<Error | null>(null)
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)

    // 词条类型以 type key 索引，供节点解析颜色与图标。
    const entryTypeByKey = useMemo(() => {
        const map = new Map<string, EntryTypeView>()
        for (const et of entryTypes) {
            map.set(entryTypeKey(et), et)
        }
        return map
    }, [entryTypes])

    const loadGraphData = useCallback(async () => {
        setDataLoading(true)
        setDataError(null)

        try {
            // 图节点数据不含 type，需并行拉取词条列表（取 id→type）与类型定义（取 color/icon/name）。
            const [data, entries, types] = await Promise.all([
                db_get_relation_graph_data(projectId),
                db_list_entries({projectId, limit: ENTRY_TYPE_LOOKUP_LIMIT, offset: 0}),
                db_list_all_entry_types(projectId),
            ])
            const typeById = new Map(entries.map((entry) => [entry.id, entry.type ?? null]))
            setNodes(data.nodes.map((node) => ({...node, entryType: typeById.get(node.id) ?? null})))
            setEdges(data.edges)
            setEntryTypes(types)
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

    const statsChips = [
        {label: '词条', value: nodes.length},
        {label: '关系', value: edges.length},
    ]

    const statusItems = [
        dataLoading ? '数据加载中' : null,
        dataError ? '数据加载失败' : null,
        layoutState.layoutLoading ? '布局计算中' : null,
        layoutState.layoutError ? '布局失败' : null,
    ].filter(Boolean)

    const renderNode = useCallback((data: RelationNodeInput, selected: boolean) => {
        const node = data as unknown as ProjectRelationNode
        const entryType = node.entryType ? entryTypeByKey.get(node.entryType) ?? null : null
        const accentStyle = entryType?.color
            ? ({'--rg-accent': entryType.color} as CSSProperties)
            : undefined

        return (
            <div
                className={selected ? 'rg-node rg-node--selected' : 'rg-node'}
                style={accentStyle}
            >
                <div className="rg-node__accent" aria-hidden="true"/>
                <div className="rg-node__cover-wrap">
                    <img
                        className="rg-node__cover"
                        src={coverSrc(node)}
                        alt={node.title}
                        loading="lazy"
                    />
                    {entryType && (
                        <span className="rg-node__type-badge" title={entryType.name}>
                            <EntryTypeIcon entryType={entryType} className="rg-node__type-icon"/>
                        </span>
                    )}
                </div>
                <div className="rg-node__body">
                    <div className="rg-node__title" title={node.title}>
                        {node.title}
                    </div>
                    <div className="rg-node__summary" title={node.summary}>
                        {node.summary}
                    </div>
                </div>
            </div>
        )
    }, [entryTypeByKey])

    return (
        <div className="project-relation-graph fc-op-panel">
            {/* ── 顶部 ── */}
            <div className="fc-op-header">
                {onBack && (
                    <button type="button" className="fc-op-back-btn" onClick={onBack}>
                        <BackArrow/>返回
                    </button>
                )}
                <div className="fc-op-header__title-block">
                    <h2 className="fc-op-header__title">关系图谱</h2>
                    <p className="fc-op-header__subtitle">
                        可视化展示项目内词条之间的关联结构。
                    </p>
                </div>
                <div className="fc-op-header__actions">
                    <Button type="button" size="sm" variant="outline" onClick={handleRefresh} disabled={dataLoading}>
                        {dataLoading ? '刷新中' : '刷新'}
                    </Button>
                </div>
            </div>

            {/* ── 工具栏（统计 + 状态） ── */}
            {(nodes.length > 0 || statusItems.length > 0) && (
                <div className="fc-op-toolbar">
                    {statsChips.map((chip) => (
                        <span key={chip.label} className="fc-op-chip">
                            {chip.label} {chip.value}
                        </span>
                    ))}
                    {statusItems.length > 0 && (
                        <>
                            <div className="fc-op-toolbar__sep" />
                            {statusItems.map((item, index) => (
                                <span
                                    key={index}
                                    className={`fc-op-status${dataError || layoutState.layoutError ? ' fc-op-status--error' : ''}`}
                                >
                                    {item}
                                </span>
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* ── 错误提示 ── */}
            {dataError && (
                <div className="fc-status-banner fc-status-banner--error">
                    数据加载失败：{dataError.message}
                </div>
            )}

            {layoutState.layoutError && (
                <div className="fc-status-banner fc-status-banner--error">
                    布局失败：{layoutState.layoutError.message}
                </div>
            )}

            {/* ── 视口 ── */}
            <div className="fc-op-viewport">
                {dataLoading && nodes.length === 0 ? (
                    <div className="fc-op-viewport-empty">正在加载项目关系数据…</div>
                ) : dataError ? (
                    <div className="fc-op-viewport-empty">无法展示关系图，请先处理数据加载错误。</div>
                ) : nodes.length === 0 ? (
                    <div className="fc-op-viewport-empty">当前项目还没有可展示的词条关系，请先为词条建立关系连接。</div>
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
