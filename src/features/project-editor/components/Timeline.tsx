import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {RollingBox} from 'flowcloudai-ui'
import {
    calculateTimelineFitZoom,
    calculateTimelineRowCapacity,
    LEFT_OFFSET,
    MAX_CARD_WIDTH,
    MIN_CARD_WIDTH,
    placeTimelineRows,
} from './timelineGeometry'
import './Timeline.css'

export interface TimelineEvent {
    id: string
    title: string
    startTime: number
    endTime?: number
    description?: string
    parentId?: string
}

export interface TimelineSelectedKeyChangeMeta {
    source?: 'click' | 'keyboard' | 'input' | 'drag' | 'programmatic'
    event?: React.MouseEvent<HTMLDivElement>
}

export type TimelineSelectedKeyChangeHandler = (
    nextValue: string | null,
    meta?: TimelineSelectedKeyChangeMeta,
) => void

export interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
    events: TimelineEvent[]
    yearStart: number
    yearEnd: number
    syncId?: string
    selectedKey?: string | null
    defaultSelectedKey?: string | null
    onSelectedKeyChange?: TimelineSelectedKeyChangeHandler
    controlsContainer?: HTMLElement | null
    /** 为事件生成完整行布局，并允许轨道纵向滚动。 */
    scrollableRows?: boolean
}

/** 旗帜（事件标记）的高度（px） */
const FLAG_HEIGHT = 60
/** 基准缩放下每一年对应的像素宽度 */
const PX_PER_YEAR = 12
/** 轨道最小宽度，防止年份范围过小时内容过窄（px） */
const MIN_TRACK_WIDTH = 800
/** 最大缩放倍率 */
const MAX_ZOOM = 6
/** 每次滚轮缩放的步进比例 */
const ZOOM_STEP = 0.15
/** 轨道顶部内边距（px） */
const TRACK_TOP_PADDING = 20
/** 事件行之间的垂直间距（px） */
const EVENT_ROW_GAP = 76
/** 旗帜底部到坐标轴之间的间距（px） */
const AXIS_TOP_GAP = 28
/** 坐标轴年份标签所占的垂直空间（px） */
const AXIS_LABEL_SPACE = 28
/** 轨道底部内边距（px） */
const TRACK_BOTTOM_PADDING = 16
/** 坐标轴下方用于滚轮缩放的交互区域高度（px） */
const AXIS_WHEEL_ZONE = 8
/** 单行轨道总高度 = 顶部边距 + 旗帜 + 轴间距 + 标签 + 底部边距 + 滚轮区 */
const SINGLE_ROW_TRACK_HEIGHT = TRACK_TOP_PADDING + FLAG_HEIGHT + AXIS_TOP_GAP
    + AXIS_LABEL_SPACE + TRACK_BOTTOM_PADDING + AXIS_WHEEL_ZONE

const syncGroups = new Map<string, Set<React.RefObject<HTMLDivElement | null>>>()
const syncLocks = new WeakMap<React.RefObject<HTMLDivElement | null>, boolean>()

function normalizeYearRange(yearStart: number, yearEnd: number): [number, number] {
    const safeStart = Number.isFinite(yearStart) ? yearStart : 0
    const safeEnd = Number.isFinite(yearEnd) ? yearEnd : safeStart
    return safeStart <= safeEnd ? [safeStart, safeEnd] : [safeEnd, safeStart]
}

export function Timeline({
                             events,
                             yearStart,
                             yearEnd,
                             syncId,
                             selectedKey,
                             defaultSelectedKey = null,
                             onSelectedKeyChange,
                             controlsContainer,
                             scrollableRows = false,
                             className,
                             style,
                             ...props
                         }: TimelineProps) {
    // ─── 状态 ───────────────────────────────────────────────
    /** 横向滚动容器引用 */
    const scrollRef = useRef<HTMLDivElement>(null)
    /** 是否正在拖拽平移 */
    const [isDragging, setIsDragging] = useState(false)
    /** 拖拽起始时鼠标的页面 X 坐标 */
    const [dragStartX, setDragStartX] = useState(0)
    /** 拖拽起始时容器的 scrollLeft 值 */
    const [dragScrollLeft, setDragScrollLeft] = useState(0)
    /** 组件内部管理的选中事件 ID（无外部受控时使用） */
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(defaultSelectedKey)
    /** 当前缩放倍率，1 为基准 */
    const [zoomLevel, setZoomLevel] = useState(1)
    /** 滚动容器的可视宽度（px） */
    const [viewportWidth, setViewportWidth] = useState(0)
    /** 滚动容器的可视高度（px） */
    const [viewportHeight, setViewportHeight] = useState(0)
    /** 缩放锚点信息：鼠标偏移、对应内容坐标、缩放比率，用于缩放后保持锚点位置 */
    const zoomAnchorRef = useRef<{ offsetX: number; contentX: number; scaleRatio: number } | null>(null)
    /** 抑制自动滚动标志：底部旗帜点击时跳过居中滚动，避免跳动 */
    const suppressAutoScrollRef = useRef(false)

    // ─── 派生数据 ───────────────────────────────────────────
    const [currentStart, currentEnd] = useMemo(
        () => normalizeYearRange(yearStart, yearEnd),
        [yearEnd, yearStart],
    )

    const baseTrackWidth = useMemo(() => {
        const range = Math.max(currentEnd - currentStart, 1)
        return Math.max(range * PX_PER_YEAR, MIN_TRACK_WIDTH, viewportWidth - LEFT_OFFSET * 2)
    }, [currentStart, currentEnd, viewportWidth])

    const minZoomLevel = useMemo(
        () => calculateTimelineFitZoom(events, currentStart, currentEnd, viewportWidth, baseTrackWidth),
        [baseTrackWidth, currentEnd, currentStart, events, viewportWidth],
    )

    const trackWidth = useMemo(() => {
        return baseTrackWidth * zoomLevel
    }, [baseTrackWidth, zoomLevel])

    const layoutTrackWidth = useMemo(() => {
        return baseTrackWidth * minZoomLevel
    }, [baseTrackWidth, minZoomLevel])

    const getX = useCallback((year: number) => {
        const range = currentEnd - currentStart
        if (range <= 0) return 0
        return ((year - currentStart) / range) * trackWidth
    }, [currentStart, currentEnd, trackWidth])

    /** 将年份转换为布局坐标（使用 minZoomLevel 下的 trackWidth，不受用户缩放影响） */
    const getBaseX = useCallback((year: number) => {
        const range = currentEnd - currentStart
        if (range <= 0) return 0
        return ((year - currentStart) / range) * layoutTrackWidth
    }, [currentStart, currentEnd, layoutTrackWidth])

    /** 计算坐标轴刻度：根据年份范围动态调整步长（10/20/50/100年） */
    const ticks = useMemo(() => {
        const range = currentEnd - currentStart
        if (range <= 0) {
            return [{year: currentStart, left: 0, label: `${currentStart}`}]
        }
        // 根据范围大小选择刻度步长，避免刻度过密
        let step = 10
        if (range > 1000) step = 100
        else if (range > 500) step = 50
        else if (range > 200) step = 20
        // 将起止对齐到步长的整数倍
        const start = Math.floor(currentStart / step) * step
        const end = Math.ceil(currentEnd / step) * step
        const ticksArr = []
        for (let y = start; y <= end; y += step) {
            if (y >= currentStart && y <= currentEnd) {
                ticksArr.push({
                    year: y,
                    left: ((y - currentStart) / range) * 100,
                    label: `${y}`,
                })
            }
        }
        return ticksArr
    }, [currentStart, currentEnd])

    /** 移动端允许纵向滚动时保留全部事件行；桌面端继续按视口容量排布。 */
    const maxRows = useMemo(
        () => scrollableRows
            ? Math.max(events.length, 1)
            : calculateTimelineRowCapacity(viewportHeight, SINGLE_ROW_TRACK_HEIGHT, EVENT_ROW_GAP),
        [events.length, scrollableRows, viewportHeight],
    )

    /** 为每个事件计算像素坐标和尺寸，并分配所在行 */
    const processedEvents = useMemo(() => {
        if (!events.length) return []

        // 第一步：将年份转换为像素坐标，计算卡片宽度
        const eventsWithCoords = events.map(event => {
            const startX = getX(event.startTime)
            const layoutStartX = getBaseX(event.startTime)
            let durationWidth = 0
            let cardWidth = MIN_CARD_WIDTH
            let layoutCardWidth = MIN_CARD_WIDTH
            if (event.endTime !== undefined && event.endTime !== null) {
                const endX = getX(event.endTime)
                const layoutEndX = getBaseX(event.endTime)
                const rawWidth = endX - startX
                const layoutRawWidth = layoutEndX - layoutStartX
                durationWidth = rawWidth > 0 ? Math.max(rawWidth, 1) : 0
                const layoutDurationWidth = layoutRawWidth > 0 ? Math.max(layoutRawWidth, 1) : 0
                layoutCardWidth = layoutDurationWidth > 0
                    ? Math.min(Math.max(layoutDurationWidth, MIN_CARD_WIDTH), MAX_CARD_WIDTH)
                    : MIN_CARD_WIDTH
                cardWidth = layoutCardWidth
            }
            return {...event, startX, durationWidth, cardWidth, layoutStartX, layoutCardWidth}
        })

        // 第二步：按时间排序，贪心分配行，计算每个事件的 y 坐标
        const sorted = [...eventsWithCoords].sort((a, b) => a.startTime - b.startTime)
        const placements = placeTimelineRows(sorted, maxRows)
        return sorted.map((event, index) => {
            const placement = placements[index]
            return {
                ...event,
                y: TRACK_TOP_PADDING + placement.rowIndex * EVENT_ROW_GAP,
            }
        })
    }, [events, getBaseX, getX, maxRows])

    /** 坐标轴 Y 坐标：取内容底部与视口底部锚点的较大值，确保轴线始终可见 */
    const axisY = useMemo(() => {
        // 内容决定的轴线位置：所有事件旗帜底部 + 间距
        const contentAxisY = processedEvents.length
            ? processedEvents.reduce((maxBottom, event) => Math.max(maxBottom, event.y + FLAG_HEIGHT), 0) + AXIS_TOP_GAP
            : TRACK_TOP_PADDING + FLAG_HEIGHT + AXIS_TOP_GAP

        // 视口比内容高时把坐标轴下压到接近底部：旗帜柱撑满上方，轴线下方留出固定高度的缩放色带
        const bottomAnchoredAxisY = viewportHeight - AXIS_LABEL_SPACE - TRACK_BOTTOM_PADDING - AXIS_WHEEL_ZONE
        return Math.max(contentAxisY, bottomAnchoredAxisY)
    }, [processedEvents, viewportHeight])

    /** 轨道总高度 = 坐标轴 Y + 标签区 + 底部边距 + 滚轮交互区 */
    const trackHeight = useMemo(() => {
        return axisY + AXIS_LABEL_SPACE + TRACK_BOTTOM_PADDING + AXIS_WHEEL_ZONE
    }, [axisY])

    /** 当前选中的事件 ID：受控模式优先，否则使用内部状态 */
    const currentSelectedId = selectedKey !== undefined ? selectedKey : internalSelectedId

    // ─── 事件处理 ───────────────────────────────────────────
    /** 拖拽开始：记录起始位置 */
    const handleMouseDown = (event: React.MouseEvent) => {
        if (!scrollRef.current) return
        setIsDragging(true)
        setDragStartX(event.pageX - scrollRef.current.offsetLeft)
        setDragScrollLeft(scrollRef.current.scrollLeft)
    }

    /** 拖拽结束 */
    const handleMouseUp = useCallback(() => setIsDragging(false), [])

    /** 拖拽移动：横向平移时间线，乘以 1.5 加速系数 */
    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (!isDragging || !scrollRef.current) return
        event.preventDefault()
        const x = event.pageX - scrollRef.current.offsetLeft
        scrollRef.current.scrollLeft = dragScrollLeft - (x - dragStartX) * 1.5
    }, [isDragging, dragScrollLeft, dragStartX])

    /**
     * 缩放到指定倍率，以 offsetX 为锚点。
     * 记录锚点信息到 zoomAnchorRef，由 useLayoutEffect 在 trackWidth 更新后修正滚动位置。
     */
    const zoomTo = useCallback((nextZoomLevelRaw: number, offsetX: number) => {
        const container = scrollRef.current
        if (!container) return
        const nextZoomLevel = Math.min(MAX_ZOOM, Math.max(minZoomLevel, nextZoomLevelRaw))
        if (nextZoomLevel === zoomLevel) return
        zoomAnchorRef.current = {
            offsetX,
            contentX: container.scrollLeft + offsetX - LEFT_OFFSET,
            scaleRatio: nextZoomLevel / zoomLevel,
        }
        setZoomLevel(nextZoomLevel)
    }, [minZoomLevel, zoomLevel])

    /**
     * 拦截滚轮事件：
     * - 在坐标轴下方区域（AXIS_WHEEL_ZONE）→ 直接缩放
     * - 其他区域 → 需按住 Ctrl/⌘ 才缩放，否则返回 false 由 RollingBox 横向平移
     */
    const interceptWheel = useCallback((event: WheelEvent, container: HTMLDivElement) => {
        const rect = container.getBoundingClientRect()
        const offsetX = event.clientX - rect.left
        const offsetY = event.clientY - rect.top

        // 坐标轴下方（底部缩放色带）滚轮缩放，其余区域横向平移；Ctrl/⌘ + 滚轮任意位置缩放
        const inWheelZoomZone = offsetY >= axisY
        if (!inWheelZoomZone && !event.ctrlKey && !event.metaKey) {
            return false
        }

        event.preventDefault()
        event.stopPropagation()

        const direction = event.deltaY > 0 ? -1 : 1
        zoomTo(zoomLevel + direction * ZOOM_STEP, offsetX)
        return true
    }, [axisY, zoomLevel, zoomTo])

    /** 按钮缩放：以视口中心为锚点 */
    const handleZoomButton = useCallback((direction: 1 | -1) => {
        const container = scrollRef.current
        const offsetX = container ? container.clientWidth / 2 : 0
        zoomTo(zoomLevel + direction * ZOOM_STEP, offsetX)
    }, [zoomLevel, zoomTo])

    /** 适应视图：缩放到最小倍率，居中显示 */
    const handleZoomFit = useCallback(() => {
        const container = scrollRef.current
        const offsetX = container ? container.clientWidth / 2 : 0
        zoomTo(minZoomLevel, offsetX)
    }, [minZoomLevel, zoomTo])

    /**
     * 选中事件统一入口。
     * 受控模式下调用 onSelectedKeyChange；无受控时更新内部状态。
     * 切换选中时设置 suppressAutoScroll，避免旗帜点击触发的自动滚动。
     */
    const selectEvent = (eventId: string, meta: TimelineSelectedKeyChangeMeta) => {
        if (onSelectedKeyChange) {
            if (eventId !== currentSelectedId) {
                suppressAutoScrollRef.current = true
            }
            onSelectedKeyChange(eventId, meta)
        } else {
            setInternalSelectedId(eventId)
        }
    }

    /** 卡片点击事件处理 */
    const handleCardClick = (eventId: string, event: React.MouseEvent<HTMLDivElement>) => {
        selectEvent(eventId, {source: 'click', event})
    }

    /** 卡片键盘事件处理（Enter/Space 触发选中） */
    const handleCardKeyDown = (eventId: string, event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        selectEvent(eventId, {source: 'keyboard'})
    }

    // ─── 副作用 ─────────────────────────────────────────────
    /** 受控 selectedKey 变化时同步内部状态，并把选中卡片滚动到可视区居中位置 */
    useEffect(() => {
        if (selectedKey === undefined) return
        setInternalSelectedId(selectedKey)
        if (!selectedKey) return

        // 直接点击底部旗帜产生的选中不做自动滚动（旗帜已在光标处），避免时间线在
        // 光标下跳动；来自事件列表/方向键的选中则滚到居中位置。
        if (suppressAutoScrollRef.current) {
            suppressAutoScrollRef.current = false
            return
        }

        const container = scrollRef.current
        const cardElement = document.getElementById(`event-card-${selectedKey}`)
        if (!container || !cardElement) return

        // 容器 overflow-y 为 hidden：不能用 scrollIntoView（会带动外层纵向滚动并裁掉
        // 无法滚回的内容）。这里只按横轴把选中卡片滚到居中位置。
        const containerRect = container.getBoundingClientRect()
        const cardRect = cardElement.getBoundingClientRect()
        const cardContentLeft = cardRect.left - containerRect.left + container.scrollLeft
        const cardCenter = cardContentLeft + cardRect.width / 2
        const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
        const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, cardCenter - container.clientWidth / 2))
        const nextScrollTop = scrollableRows
            ? Math.min(
                Math.max(0, container.scrollHeight - container.clientHeight),
                Math.max(0, cardRect.top - containerRect.top + container.scrollTop
                    + cardRect.height / 2 - container.clientHeight / 2),
            )
            : container.scrollTop
        if (
            Math.abs(container.scrollLeft - nextScrollLeft) < 1
            && Math.abs(container.scrollTop - nextScrollTop) < 1
        ) return

        container.scrollTo({left: nextScrollLeft, top: nextScrollTop, behavior: 'smooth'})
    }, [scrollableRows, selectedKey])

    /** 监听容器尺寸变化，更新视口宽高 */
    useLayoutEffect(() => {
        if (!scrollRef.current) return

        const updateViewport = () => {
            if (!scrollRef.current) return
            setViewportWidth(scrollRef.current.clientWidth)
            setViewportHeight(scrollRef.current.clientHeight)
        }

        updateViewport()

        const resizeObserver = new ResizeObserver(() => {
            updateViewport()
        })

        resizeObserver.observe(scrollRef.current)

        return () => {
            resizeObserver.disconnect()
        }
    }, [])

    /** 当最小缩放倍率变化时，确保当前缩放不低于最小值 */
    useEffect(() => {
        setZoomLevel(prevZoomLevel => Math.max(prevZoomLevel, minZoomLevel))
    }, [minZoomLevel])

    /** 缩放后根据锚点信息修正滚动位置，保持锚点处内容不动 */
    useLayoutEffect(() => {
        if (!scrollRef.current || !zoomAnchorRef.current) return

        const {offsetX, contentX, scaleRatio} = zoomAnchorRef.current
        const scaledContentX = contentX * scaleRatio
        const maxScrollLeft = Math.max(
            trackWidth + LEFT_OFFSET * 2 - scrollRef.current.clientWidth,
            0,
        )

        scrollRef.current.scrollLeft = Math.min(
            maxScrollLeft,
            Math.max(0, scaledContentX - offsetX + LEFT_OFFSET),
        )
        zoomAnchorRef.current = null
    }, [trackWidth, zoomLevel])

    /** 同步滚动：相同 syncId 的多个 Timeline 横向滚动联动 */
    useEffect(() => {
        if (!syncId || !scrollRef.current) return

        // 加入同步组
        if (!syncGroups.has(syncId)) {
            syncGroups.set(syncId, new Set())
        }
        const group = syncGroups.get(syncId)!
        group.add(scrollRef)

        const handleScroll = () => {
            if (!scrollRef.current) return
            if (syncLocks.get(scrollRef)) return

            const currentLeft = scrollRef.current.scrollLeft
            group.forEach(otherRef => {
                if (otherRef !== scrollRef && otherRef.current) {
                    syncLocks.set(otherRef, true)
                    otherRef.current.scrollLeft = currentLeft
                    requestAnimationFrame(() => syncLocks.set(otherRef, false))
                }
            })
        }

        const scrollEl = scrollRef.current
        scrollEl.addEventListener('scroll', handleScroll)

        return () => {
            scrollEl.removeEventListener('scroll', handleScroll)
            group.delete(scrollRef)
            if (group.size === 0) {
                syncGroups.delete(syncId)
            }
        }
    }, [syncId])

    // ─── 渲染 ───────────────────────────────────────────────
    /** 缩放控制按钮组（缩小、当前倍率、放大） */
    const zoomControls = (
        <div
            className={`timeline-zoom${controlsContainer !== undefined ? ' timeline-zoom--inline' : ''}`}
            role="group"
            aria-label="时间线缩放控制"
        >
            <button
                type="button"
                className="timeline-zoom__btn"
                onClick={() => handleZoomButton(-1)}
                disabled={zoomLevel <= minZoomLevel}
                aria-label="缩小时间线"
                title="缩小"
            >
                <span aria-hidden="true">−</span>
            </button>
            <button
                type="button"
                className="timeline-zoom__level"
                onClick={handleZoomFit}
                aria-label={`当前缩放 ${Math.round(zoomLevel * 100)}%，点击适应视图`}
                title="适应视图"
            >
                {Math.round(zoomLevel * 100)}%
            </button>
            <button
                type="button"
                className="timeline-zoom__btn"
                onClick={() => handleZoomButton(1)}
                disabled={zoomLevel >= MAX_ZOOM}
                aria-label="放大时间线"
                title="放大"
            >
                <span aria-hidden="true">+</span>
            </button>
        </div>
    )

    return (
        <div
            {...props}
            className={['timeline-flag', className].filter(Boolean).join(' ')}
            style={style}
        >
            {/* 滚动容器：桌面横向平移，移动端额外允许浏览完整事件行。 */}
            <RollingBox
                className={[
                    'timeline-scroll-area',
                    scrollableRows ? 'timeline-scroll-area--scrollable-rows' : '',
                    isDragging ? 'dragging' : '',
                ].filter(Boolean).join(' ')}
                ref={scrollRef}
                data-mobile-horizontal-scroll="true"
                axis={scrollableRows ? 'both' : 'x'}
                showThumb="auto"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onMouseMove={handleMouseMove}
                interceptWheel={interceptWheel}
            >
                {/* 轨道容器：宽度 = trackWidth + 两侧偏移，高度 = trackHeight */}
                <div
                    className="flag-track"
                    style={{
                        width: trackWidth + LEFT_OFFSET * 2,
                        height: trackHeight,
                        position: 'relative',
                    }}
                >
                    {/* 底部缩放交互区：滚轮在此区域内直接触发缩放 */}
                    <div
                        className="flag-wheel-zone"
                        aria-hidden="true"
                        style={{top: axisY, height: trackHeight - axisY}}
                    />
                    {/* 坐标轴：横线 + 年份刻度 */}
                    <div className="flag-axis" style={{left: LEFT_OFFSET, right: LEFT_OFFSET, top: axisY}}>
                        <div className="flag-axis-line"/>
                        <div className="flag-ticks">
                            {ticks.map((tick, index) => (
                                <div key={index} className="flag-tick" style={{left: `${tick.left}%`}}>
                                    <div className="flag-tick-mark"/>
                                    <span className="flag-tick-label">{tick.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    {/* 持续时间条：有 endTime 的事件在轴线上显示的色带 */}
                    {processedEvents.map(event => {
                        if (event.durationWidth <= 0) return null
                        return (
                            <div
                                key={`duration-${event.id}`}
                                style={{
                                    position: 'absolute',
                                    left: LEFT_OFFSET + event.startX,
                                    top: axisY - 2,
                                    width: event.durationWidth,
                                    height: 4,
                                    backgroundColor: 'var(--fc-color-primary)',
                                    opacity: 0.6,
                                    borderRadius: 2,
                                    pointerEvents: 'none',
                                    zIndex: 5,
                                }}
                            />
                        )
                    })}

                    {/* 事件旗帜：卡片 + 旗杆 + 底部圆点 */}
                    {processedEvents.map((event, index) => {
                        const flagBottom = event.y + FLAG_HEIGHT
                        const lineHeight = axisY - flagBottom
                        const isSelected = currentSelectedId === event.id
                        return (
                            <div
                                key={event.id}
                                className="flag-event"
                                style={{
                                    position: 'absolute',
                                    left: LEFT_OFFSET + event.startX,
                                    top: event.y,
                                    zIndex: isSelected ? processedEvents.length + 20 : index + 10,
                                }}
                            >
                                {/* 卡片主体：显示标题和描述，可点击/键盘选中 */}
                                <div
                                    id={`event-card-${event.id}`}
                                    className={`flag-body ${isSelected ? 'selected' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    aria-label={event.title}
                                    style={{
                                        width: event.cardWidth,
                                        minWidth: MIN_CARD_WIDTH,
                                        maxWidth: MAX_CARD_WIDTH,
                                    }}
                                    onClick={(clickEvent) => handleCardClick(event.id, clickEvent)}
                                    onKeyDown={(keyEvent) => handleCardKeyDown(event.id, keyEvent)}
                                >
                                    <h3 className="flag-title">{event.title}</h3>
                                    {event.description && <p className="flag-desc">{event.description}</p>}
                                </div>
                                {/* 旗杆：连接卡片底部到坐标轴 */}
                                <div className="flag-pole-container" style={{height: lineHeight}}>
                                    <div className="flag-top-bar"/>
                                    <div className="flag-pole"/>
                                    <div className="flag-pole-dot"/>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </RollingBox>
            {/* 缩放控件：无 controlsContainer 时内联渲染，否则通过 Portal 挂载到指定容器 */}
            {controlsContainer === undefined
                ? zoomControls
                : controlsContainer
                    ? createPortal(zoomControls, controlsContainer)
                    : null}
        </div>
    )
}
