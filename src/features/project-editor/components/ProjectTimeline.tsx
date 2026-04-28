import {useCallback, useEffect, useMemo, useState} from 'react'
import {Button, Timeline, type TimelineEvent} from 'flowcloudai-ui'
import {
    db_list_timeline_events,
    type ProjectTimelineData,
    type TagSchema,
} from '../../../api'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectTimeline.css'

interface ProjectTimelineProps {
    projectId: string
    tagSchemas: TagSchema[]
    onBack?: () => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

interface TimelineTagHintGroup {
    label: string
    examples: string[]
}

type TimelineTagRole = 'start' | 'end' | 'parent' | 'show'

const TIMELINE_TAG_HINTS: TimelineTagHintGroup[] = [
    {label: '开始时间', examples: ['开始年份', '开始时间', 'year', 'start_year']},
    {label: '结束时间', examples: ['结束年份', '结束时间', 'end_year']},
    {label: '上级事件', examples: ['上级事件', '父级事件', 'parent_id']},
    {label: '是否显示', examples: ['时间线', '纳入时间线', 'show_timeline']},
]

function normalizeTagName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
}

function getTimelineRole(name: string): TimelineTagRole | null {
    switch (normalizeTagName(name)) {
        case 'start':
        case 'startyear':
        case 'starttime':
        case 'year':
        case '年份':
        case '开始':
        case '开始年':
        case '开始年份':
        case '开始时间':
        case '起始':
        case '起始年':
        case '起始年份':
        case '起始时间':
            return 'start'
        case 'end':
        case 'endyear':
        case 'endtime':
        case '结束':
        case '结束年':
        case '结束年份':
        case '结束时间':
        case '终止':
        case '终止年':
        case '终止年份':
        case '终止时间':
            return 'end'
        case 'parent':
        case 'parentid':
        case '父事件':
        case '父级事件':
        case '父事件id':
        case '父级事件id':
        case '上级事件':
        case '上级事件id':
            return 'parent'
        case 'timeline':
        case 'ontimeline':
        case 'showtimeline':
        case '时间线':
        case '纳入时间线':
        case '显示在时间线':
        case '显示时间线':
            return 'show'
        default:
            return null
    }
}

function formatYear(year: number) {
    if (year < 0) return `公元前 ${Math.abs(year)} 年`
    return `公元 ${year} 年`
}

function formatRange(event: { startTime: number; endTime?: number | null }) {
    if (typeof event.endTime === 'number') {
        return `${formatYear(event.startTime)} - ${formatYear(event.endTime)}`
    }
    return formatYear(event.startTime)
}

function buildRangeText(data: ProjectTimelineData) {
    if (typeof data.yearStart !== 'number' || typeof data.yearEnd !== 'number') {
        return '暂无'
    }
    return `${formatYear(data.yearStart)} - ${formatYear(data.yearEnd)}`
}

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : '未知错误')
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

export default function ProjectTimeline({projectId, tagSchemas, onBack, onOpenEntry}: ProjectTimelineProps) {
    const [data, setData] = useState<ProjectTimelineData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

    const matchedSchemaNames = useMemo(() => {
        const groups: Record<TimelineTagRole, string[]> = {
            start: [] as string[],
            end: [] as string[],
            parent: [] as string[],
            show: [] as string[],
        }

        tagSchemas.forEach((schema) => {
            const role = getTimelineRole(schema.name)
            if (!role) return
            groups[role].push(schema.name)
        })

        return groups
    }, [tagSchemas])

    const events = useMemo(() => data?.events ?? [], [data])
    const selectedEvent = useMemo(
        () => events.find((event) => event.id === selectedEventId) ?? null,
        [events, selectedEventId],
    )

    const eventStats = useMemo(() => {
        const rangeEvents = events.filter((event) => typeof event.endTime === 'number').length
        const pointEvents = events.length - rangeEvents
        const hierarchyEvents = events.filter((event) => event.parentId).length
        return {rangeEvents, pointEvents, hierarchyEvents}
    }, [events])

    const loadTimeline = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const nextData = await db_list_timeline_events(projectId)
            setData(nextData)
            setSelectedEventId((current) => {
                if (current && nextData.events.some((event) => event.id === current)) return current
                return nextData.events[0]?.id ?? null
            })
        } catch (nextError) {
            setError(normalizeError(nextError))
            setData(null)
            setSelectedEventId(null)
        } finally {
            setLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        void loadTimeline()
    }, [loadTimeline])

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            if (events.length === 0 || !selectedEventId) return

            const currentIndex = events.findIndex((item) => item.id === selectedEventId)
            if (currentIndex < 0) return

            event.preventDefault()
            const nextIndex = event.key === 'ArrowLeft'
                ? Math.max(0, currentIndex - 1)
                : Math.min(events.length - 1, currentIndex + 1)

            if (nextIndex !== currentIndex) {
                setSelectedEventId(events[nextIndex].id)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [events, selectedEventId])

    const timelineEvents = useMemo<TimelineEvent[]>(
        () => events.map((event) => ({
            id: event.id,
            title: event.title,
            startTime: event.startTime,
            endTime: event.endTime ?? undefined,
            description: event.description ?? undefined,
            parentId: event.parentId ?? undefined,
        })),
        [events],
    )

    const matchedTagCount = Object.values(matchedSchemaNames).reduce((sum, names) => sum + names.length, 0)

    return (
        <div className="project-timeline fc-op-panel">
            {/* ── Header ── */}
            <div className="fc-op-header">
                {onBack && (
                    <button type="button" className="fc-op-back-btn" onClick={onBack}>
                        <BackArrow/>返回
                    </button>
                )}
                <div className="fc-op-header__title-block">
                    <h2 className="fc-op-header__title">时间线</h2>
                    <p className="fc-op-header__subtitle">
                        系统会扫描项目中的词条标签，并自动识别时间线语义。
                    </p>
                </div>
                <div className="fc-op-header__actions">
                    {selectedEvent && onOpenEntry && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenEntry({id: selectedEvent.id, title: selectedEvent.title})}
                        >
                            打开当前词条
                        </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => void loadTimeline()} disabled={loading}>
                        {loading ? '刷新中' : '刷新'}
                    </Button>
                </div>
            </div>

            {/* ── Toolbar (stats chips) ── */}
            {data && events.length > 0 && (
                <div className="fc-op-toolbar">
                    <span className="fc-op-chip">扫描词条 {data.scannedEntryCount}</span>
                    <span className="fc-op-chip">时间线事件 {data.matchedEntryCount}</span>
                    <span className="fc-op-chip">持续区间 {eventStats.rangeEvents}</span>
                    <span className="fc-op-chip">单点事件 {eventStats.pointEvents}</span>
                    <span className="fc-op-chip">层级事件 {eventStats.hierarchyEvents}</span>
                    <div className="fc-op-toolbar__sep" />
                    <span className="fc-op-status">范围：{buildRangeText(data)}</span>
                    {matchedTagCount > 0 && (
                        <span className="fc-op-status">
                            标签：{[
                                matchedSchemaNames.start.length > 0 ? `开始 ${matchedSchemaNames.start.join('、')}` : '',
                                matchedSchemaNames.end.length > 0 ? `结束 ${matchedSchemaNames.end.join('、')}` : '',
                                matchedSchemaNames.parent.length > 0 ? `上级事件 ${matchedSchemaNames.parent.join('、')}` : '',
                                matchedSchemaNames.show.length > 0 ? `显示 ${matchedSchemaNames.show.join('、')}` : '',
                            ].filter(Boolean).join('；')}
                        </span>
                    )}
                </div>
            )}

            {/* ── Error Banner ── */}
            {error && (
                <div className="fc-status-banner fc-status-banner--error">
                    时间线数据加载失败：{error.message}
                </div>
            )}

            {/* ── Body ── */}
            {events.length === 0 ? (
                <div className="fc-op-viewport-empty">
                    <div className="fc-op-hint-block">
                        <div className="fc-op-hint">当前项目还没有可渲染的时间线事件。</div>
                        <div className="fc-op-hint">至少需要在某些词条上设置一个可识别的“开始时间”标签。</div>
                        {TIMELINE_TAG_HINTS.map((group) => (
                            <div key={group.label} className="fc-op-hint">
                                {group.label}：{group.examples.join(' / ')}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="fc-op-body">
                    {/* ── Sidebar: Event List ── */}
                    <div className="fc-op-sidebar">
                        <div className="fc-op-sidebar__header">
                            <span className="fc-op-sidebar__title">事件列表</span>
                            <span className="fc-op-count">
                                {selectedEvent
                                    ? `${events.findIndex((event) => event.id === selectedEvent.id) + 1} / ${events.length}`
                                    : `0 / ${events.length}`}
                            </span>
                        </div>
                        <div className="fc-op-sidebar__body">
                            {events.map((event) => {
                                const isSelected = event.id === selectedEventId
                                return (
                                    <button
                                        key={event.id}
                                        type="button"
                                        className={`project-timeline__event-item fc-op-item${isSelected ? ' is-active' : ''}`}
                                        onClick={() => setSelectedEventId(event.id)}
                                    >
                                        <div className="fc-op-item__content">
                                            <span className="fc-op-item__title">{event.title}</span>
                                            <span className="fc-op-item__meta">{formatRange(event)}</span>
                                            {event.description?.trim() ? (
                                                <span className="fc-op-item__excerpt">
                                                    {event.description.trim()}
                                                </span>
                                            ) : (
                                                <span className="fc-op-item__excerpt">
                                                    该词条未填写摘要，时间线将直接使用标题展示。
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* ── Viewport: Timeline ── */}
                    <div className="fc-op-viewport">
                        <div className="project-timeline__timeline-shell">
                            <Timeline
                                events={timelineEvents}
                                yearStart={data?.yearStart ?? Math.min(...timelineEvents.map((event) => event.startTime))}
                                yearEnd={data?.yearEnd ?? Math.max(...timelineEvents.map((event) => event.endTime ?? event.startTime))}
                                selectedEventId={selectedEventId}
                                onEventSelect={setSelectedEventId}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
