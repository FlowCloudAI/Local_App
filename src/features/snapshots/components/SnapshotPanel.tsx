import {useCallback, useEffect, useMemo, useState} from 'react'
import {Button, Input, Select, useAlert} from 'flowcloudai-ui'
import {
    type AppendResult,
    dbAppendFrom,
    dbCreateBranch,
    dbGetSnapshotGraph,
    dbListBranches,
    dbRollbackTo,
    dbSnapshot,
    dbSnapshotWithMessage,
    dbSwitchBranch,
    type SnapshotBranchInfo,
    type SnapshotGraph,
    type SnapshotGraphNode,
} from '../../../api'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './SnapshotPanel.css'

interface SnapshotPanelProps {
    className?: string
    panelMode?: 'floating' | 'fullscreen'
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
}

interface SnapshotGraphRow {
    node: SnapshotGraphNode
    lane: number
    laneCount: number
    lanePresenceAbove: boolean[]
    lanePresenceBelow: boolean[]
    connections: number[]
}

const GRAPH_COLORS = [
    'var(--fc-color-primary)',
    'var(--fc-color-purple)',
    'var(--fc-color-teal)',
    'var(--fc-color-orange)',
    'var(--fc-color-pink)',
    'var(--fc-color-success)',
]

const LANE_GAP = 22
const LANE_R = LANE_GAP / 2
const GRAPH_PAD = LANE_R

function formatSnapshotTime(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date)
}

function formatSnapshotMessage(message: string): string {
    const [type, ...rest] = message.split(' ')
    if (type === 'auto') return '自动保存'
    if (type === 'manual') return rest.join(' ') || '手动保存'
    return message
}

function getFirstEmptyLane(lanes: Array<string | null>): number {
    const index = lanes.findIndex(lane => lane === null)
    if (index >= 0) return index
    lanes.push(null)
    return lanes.length - 1
}

function buildGraphRows(nodes: SnapshotGraphNode[]): SnapshotGraphRow[] {
    const activeLanes: Array<string | null> = []
    const rows: SnapshotGraphRow[] = []

    for (const node of nodes) {
        let lane = activeLanes.findIndex(entry => entry === node.id)
        if (lane < 0) {
            lane = getFirstEmptyLane(activeLanes)
            activeLanes[lane] = node.id
        }

        const lanePresenceAbove = activeLanes.map(entry => entry !== null)
        const nextLanes = [...activeLanes]
        const connections: number[] = []
        const [firstParent, ...otherParents] = node.parents

        if (firstParent) {
            const existing = nextLanes.findIndex(entry => entry === firstParent)
            if (existing >= 0 && existing !== lane) {
                nextLanes[lane] = null
                connections.push(existing)
            } else {
                nextLanes[lane] = firstParent
                connections.push(lane)
            }
        } else {
            nextLanes[lane] = null
        }

        for (const parentId of otherParents) {
            const existing = nextLanes.findIndex(entry => entry === parentId)
            if (existing >= 0) {
                connections.push(existing)
            } else {
                const nl = getFirstEmptyLane(nextLanes)
                nextLanes[nl] = parentId
                connections.push(nl)
            }
        }

        while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
            nextLanes.pop()
        }

        rows.push({
            node,
            lane,
            laneCount: Math.max(lanePresenceAbove.length, nextLanes.length, lane + 1),
            lanePresenceAbove,
            lanePresenceBelow: nextLanes.map(entry => entry !== null),
            connections,
        })

        activeLanes.splice(0, activeLanes.length, ...nextLanes)
    }

    return rows
}

function laneX(lane: number): number {
    return GRAPH_PAD + lane * LANE_GAP
}

export default function SnapshotPanel({
                                          className,
                                          panelMode,
                                          onTogglePanelMode,
                                          onToggleCollapsed
                                      }: SnapshotPanelProps) {
    const {showAlert} = useAlert()
    const [branches, setBranches] = useState<SnapshotBranchInfo[]>([])
    const [graph, setGraph] = useState<SnapshotGraph>({activeBranch: '', branches: [], nodes: []})
    const [activeBranch, setActiveBranch] = useState('')
    const [loading, setLoading] = useState(false)
    const [actionId, setActionId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [branchSwitching, setBranchSwitching] = useState(false)
    const [message, setMessage] = useState('')
    const [newBranchName, setNewBranchName] = useState('')

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [branchList, snapshotGraph] = await Promise.all([
                dbListBranches(),
                dbGetSnapshotGraph(),
            ])
            setBranches(branchList)
            setGraph(snapshotGraph)
            setActiveBranch(snapshotGraph.activeBranch)
        } catch (error) {
            console.error('加载快照图失败', error)
            void showAlert('加载版本信息失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [showAlert])

    useEffect(() => {
        void load()
    }, [load])

    const handleSnapshot = useCallback(async () => {
        setSaving(true)
        try {
            const trimmedMessage = message.trim()
            const created = trimmedMessage
                ? await dbSnapshotWithMessage(trimmedMessage)
                : await dbSnapshot()
            setMessage('')
            void showAlert(created ? '快照已创建' : '没有新变更，无需快照', created ? 'success' : 'info')
            if (created) await load()
        } catch (error) {
            console.error('创建快照失败', error)
            void showAlert('创建快照失败', 'error')
        } finally {
            setSaving(false)
        }
    }, [load, message, showAlert])

    const handleCreateBranch = useCallback(async () => {
        const trimmedName = newBranchName.trim()
        if (!trimmedName) {
            void showAlert('请输入分支名称', 'warning')
            return
        }

        try {
            await dbCreateBranch(trimmedName)
            setNewBranchName('')
            void showAlert('分支已创建', 'success')
            await load()
        } catch (error) {
            console.error('创建分支失败', error)
            void showAlert('创建分支失败', 'error')
        }
    }, [load, newBranchName, showAlert])

    const handleSwitchBranch = useCallback(async (branchName: string) => {
        if (!branchName || branchName === activeBranch) return

        const confirmed = await showAlert(
            `切换到分支「${branchName}」会把数据库恢复到该分支最新版本，是否继续？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setBranchSwitching(true)
        try {
            await dbSwitchBranch(branchName)
            void showAlert(`已切换到分支「${branchName}」`, 'success')
            await load()
        } catch (error) {
            console.error('切换分支失败', error)
            void showAlert('切换分支失败', 'error')
        } finally {
            setBranchSwitching(false)
        }
    }, [activeBranch, load, showAlert])

    const handleRollback = useCallback(async (snapshot: Pick<SnapshotGraphNode, 'id' | 'message'>) => {
        const confirmed = await showAlert(
            `确定回退到「${formatSnapshotMessage(snapshot.message)}」？\n当前状态会先自动保存。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setActionId(snapshot.id)
        try {
            await dbRollbackTo(snapshot.id)
            void showAlert('回退成功', 'success')
            await load()
        } catch (error) {
            console.error('回退失败', error)
            void showAlert('回退失败', 'error')
        } finally {
            setActionId(null)
        }
    }, [load, showAlert])

    const handleAppend = useCallback(async (snapshot: Pick<SnapshotGraphNode, 'id' | 'message'>) => {
        const confirmed = await showAlert(
            `确定从「${formatSnapshotMessage(snapshot.message)}」追加恢复缺失记录？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setActionId(snapshot.id)
        try {
            const result: AppendResult = await dbAppendFrom(snapshot.id)
            const parts = [
                result.projects && `项目 ${result.projects}`,
                result.categories && `分类 ${result.categories}`,
                result.entries && `词条 ${result.entries}`,
                result.tagSchemas && `标签 ${result.tagSchemas}`,
                result.relations && `关系 ${result.relations}`,
                result.links && `链接 ${result.links}`,
                result.entryTypes && `类型 ${result.entryTypes}`,
                result.ideaNotes && `便签 ${result.ideaNotes}`,
            ].filter(Boolean)
            void showAlert(parts.length > 0 ? `已恢复: ${parts.join(', ')}` : '无新增记录', 'success')
            await load()
        } catch (error) {
            console.error('追加恢复失败', error)
            void showAlert('追加恢复失败', 'error')
        } finally {
            setActionId(null)
        }
    }, [load, showAlert])

    const branchOptions = useMemo(() => (
        branches.map(branch => ({
            value: branch.name,
            label: branch.isActive ? `${branch.name}（当前）` : branch.name,
        }))
    ), [branches])

    const graphRows = useMemo(() => buildGraphRows(graph.nodes), [graph.nodes])

    const maxRailWidth = useMemo(() => {
        return graphRows.reduce((max, row) => {
            const w = Math.max(LANE_GAP + GRAPH_PAD * 2, GRAPH_PAD * 2 + row.laneCount * LANE_GAP)
            return Math.max(max, w)
        }, 0)
    }, [graphRows])

    const RAIL_PX = 32
    const RAIL_OVERLAP = 2
    const midY = RAIL_PX / 2

    return (
        <div className={`snapshot-panel${className ? ` ${className}` : ''}`}>
            <div className="snapshot-panel__header">
                <div className="snapshot-panel__title">版本管理</div>
                <div className="snapshot-panel__header-actions">
                    <button
                        type="button"
                        className="snapshot-panel__fullscreen-toggle"
                        onClick={() => onTogglePanelMode?.()}
                        title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                             strokeWidth="1.5">
                            {panelMode === 'fullscreen' ? (
                                <>
                                    <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                                </>
                            ) : (
                                <>
                                    <path d="M4 4h3M4 4v3M12 4h-3M12 4v3M4 12h3M4 12v-3M12 12h-3M12 12v-3"/>
                                </>
                            )}
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="snapshot-panel__fullscreen-toggle"
                        onClick={() => onToggleCollapsed?.()}
                        title="最小化"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                             strokeWidth="1.5">
                            <path d="M6 4l4 4-4 4"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div className="snapshot-panel__workspace">
                <div className="snapshot-panel__viewport">
                    {loading && graphRows.length === 0 ? (
                        <div className="snapshot-panel__empty fc-empty-state-card">
                            <span className="fc-empty-state-mark">Snapshot</span>
                            <p className="fc-empty-state-title">正在加载版本历史</p>
                            <p className="fc-empty-state-copy">正在读取快照图与分支信息。</p>
                        </div>
                    ) : graphRows.length === 0 ? (
                        <div className="snapshot-panel__empty fc-empty-state-card">
                            <span className="fc-empty-state-mark">Snapshot</span>
                            <p className="fc-empty-state-title">{activeBranch ? `分支「${activeBranch}」暂无历史版本` : '暂无历史版本'}</p>
                            <p className="fc-empty-state-copy">创建一次手动保存，或先切换到已有分支查看历史记录。</p>
                        </div>
                    ) : (
                        <div className="snapshot-panel__graph"
                             style={{'--rail-width': `${maxRailWidth}px`} as React.CSSProperties}>
                            {graphRows.map((row) => {
                                const circleColor = row.node.isActiveTip
                                    ? 'var(--fc-color-primary)'
                                    : GRAPH_COLORS[row.lane % GRAPH_COLORS.length]
                                const circleR = row.node.isActiveTip || row.node.isCurrentHead ? 6 : 5
                                return (
                                    <div
                                        key={row.node.id}
                                        className={`snapshot-panel__graph-row${row.node.isActiveTip ? ' is-active' : ''}`}
                                    >
                                        <div className="snapshot-panel__graph-rail"
                                             style={{width: `${maxRailWidth}px`}}>
                                            <svg
                                                width={maxRailWidth}
                                                height={RAIL_PX + RAIL_OVERLAP * 2}
                                                viewBox={`0 ${-RAIL_OVERLAP} ${maxRailWidth} ${RAIL_PX + RAIL_OVERLAP * 2}`}
                                                style={{overflow: 'visible'}}
                                            >
                                                {Array.from({length: row.laneCount}, (_, lane) => {
                                                    const color = GRAPH_COLORS[lane % GRAPH_COLORS.length]
                                                    const x = laneX(lane)
                                                    const hasTop = lane < row.lanePresenceAbove.length && row.lanePresenceAbove[lane]
                                                    const hasBot = lane < row.lanePresenceBelow.length && row.lanePresenceBelow[lane]
                                                    return (
                                                        <g key={`${row.node.id}-lane-${lane}`}>
                                                            {hasTop &&
                                                                <line
                                                                    x1={x}
                                                                    y1={-RAIL_OVERLAP}
                                                                    x2={x}
                                                                    y2={midY + 1}
                                                                    stroke={color}
                                                                    strokeWidth="1.5"
                                                                />}
                                                            {hasBot && <line
                                                                x1={x}
                                                                y1={midY - 1}
                                                                x2={x}
                                                                y2={RAIL_PX + RAIL_OVERLAP}
                                                                stroke={color}
                                                                strokeWidth="1.5"
                                                            />}
                                                        </g>
                                                    )
                                                })}
                                                {row.connections
                                                    .filter(parentLane => parentLane !== row.lane)
                                                    .map(parentLane => {
                                                        const fromX = laneX(row.lane)
                                                        const toX = laneX(parentLane)
                                                        const color = GRAPH_COLORS[parentLane % GRAPH_COLORS.length]
                                                        return (
                                                            <path
                                                                key={`${row.node.id}-${parentLane}`}
                                                                d={`M ${fromX} ${midY} C ${fromX} ${RAIL_PX * 0.78}, ${toX} ${RAIL_PX * 0.78}, ${toX} ${RAIL_PX + RAIL_OVERLAP}`}
                                                                fill="none"
                                                                stroke={color}
                                                                strokeWidth="1.5"
                                                            />
                                                        )
                                                    })}
                                            </svg>
                                            <div
                                                className="snapshot-panel__graph-node"
                                                style={{
                                                    width: circleR * 2,
                                                    height: circleR * 2,
                                                    left: laneX(row.lane) - circleR,
                                                    background: circleColor,
                                                }}
                                            />
                                        </div>
                                        <div className="snapshot-panel__item">
                                            <span className="snapshot-panel__item-message">
                                                {formatSnapshotMessage(row.node.message)}
                                            </span>
                                            <span className="snapshot-panel__item-branches">
                                                {row.node.branchNames.map(branchName => (
                                                    <span
                                                        key={`${row.node.id}-${branchName}`}
                                                        className="snapshot-panel__branch-tag"
                                                    >
                                                        {branchName}
                                                    </span>
                                                ))}
                                            </span>
                                            <span className="snapshot-panel__item-actions">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={actionId === row.node.id}
                                                    onClick={() => void handleRollback(row.node)}
                                                >
                                                    回退
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={actionId === row.node.id}
                                                    onClick={() => void handleAppend(row.node)}
                                                >
                                                    恢复
                                                </Button>
                                            </span>
                                            <span className="snapshot-panel__item-time">
                                                {formatSnapshotTime(row.node.timestamp)}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <aside className="snapshot-panel__sidebar">
                    <div className="snapshot-panel__section">
                        <div className="snapshot-panel__section-title">当前分支</div>
                        <div className="snapshot-panel__branch-row">
                            <Select
                                options={branchOptions}
                                value={activeBranch}
                                onChange={(value) => void handleSwitchBranch(String(value))}
                                style={{flex: 1}}
                                disabled={loading || branchSwitching || branches.length === 0}
                            />
                            <span className="snapshot-panel__branch-badge">{activeBranch || '未初始化'}</span>
                        </div>
                        <div className="snapshot-panel__branch-create">
                            <Input
                                placeholder="新分支名称，例如 feature/世界观重写"
                                value={newBranchName}
                                onChange={setNewBranchName}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleCreateBranch()}
                                disabled={loading || branchSwitching}
                            >
                                新建分支
                            </Button>
                        </div>
                    </div>

                    <div className="snapshot-panel__section">
                        <div className="snapshot-panel__section-title">手动保存</div>
                        <div className="snapshot-panel__save-row">
                            <textarea
                                className="snapshot-panel__save-textarea"
                                placeholder="可选：输入本次版本说明"
                                value={message}
                                onChange={(event) => setMessage(event.target.value)}
                                rows={4}
                            />
                            <div className="snapshot-panel__save-actions">
                                <Button variant="primary" size="sm" onClick={() => void handleSnapshot()}
                                        disabled={loading || saving}>
                                    保存
                                </Button>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    )
}
