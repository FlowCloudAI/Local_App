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
}

const FLAG_HEIGHT = 60
const PX_PER_YEAR = 12
const MIN_TRACK_WIDTH = 800
const MAX_ZOOM = 6
const ZOOM_STEP = 0.15
const TRACK_TOP_PADDING = 20
const EVENT_ROW_GAP = 76
const AXIS_TOP_GAP = 28
const AXIS_LABEL_SPACE = 28
const TRACK_BOTTOM_PADDING = 16
const AXIS_WHEEL_ZONE = 8
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
                             className,
                             style,
                             ...props
                         }: TimelineProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStartX, setDragStartX] = useState(0)
    const [dragScrollLeft, setDragScrollLeft] = useState(0)
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(defaultSelectedKey)
    const [zoomLevel, setZoomLevel] = useState(1)
    const [viewportWidth, setViewportWidth] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(0)
    const zoomAnchorRef = useRef<{ offsetX: number; contentX: number; scaleRatio: number } | null>(null)
    const suppressAutoScrollRef = useRef(false)

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
        if (Math.abs(container.scrollLeft - nextScrollLeft) < 1) return

        container.scrollTo({left: nextScrollLeft, behavior: 'smooth'})
    }, [selectedKey])

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

    const getBaseX = useCallback((year: number) => {
        const range = currentEnd - currentStart
        if (range <= 0) return 0
        return ((year - currentStart) / range) * layoutTrackWidth
    }, [currentStart, currentEnd, layoutTrackWidth])

    const ticks = useMemo(() => {
        const range = currentEnd - currentStart
        if (range <= 0) {
            return [{year: currentStart, left: 0, label: `${currentStart}`}]
        }
        let step = 10
        if (range > 1000) step = 100
        else if (range > 500) step = 50
        else if (range > 200) step = 20
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

    const maxRows = useMemo(
        () => calculateTimelineRowCapacity(viewportHeight, SINGLE_ROW_TRACK_HEIGHT, EVENT_ROW_GAP),
        [viewportHeight],
    )

    const processedEvents = useMemo(() => {
        if (!events.length) return []

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

    const axisY = useMemo(() => {
        const contentAxisY = processedEvents.length
            ? processedEvents.reduce((maxBottom, event) => Math.max(maxBottom, event.y + FLAG_HEIGHT), 0) + AXIS_TOP_GAP
            : TRACK_TOP_PADDING + FLAG_HEIGHT + AXIS_TOP_GAP

        // 视口比内容高时把坐标轴下压到接近底部：旗帜柱撑满上方，轴线下方留出固定高度的缩放色带
        const bottomAnchoredAxisY = viewportHeight - AXIS_LABEL_SPACE - TRACK_BOTTOM_PADDING - AXIS_WHEEL_ZONE
        return Math.max(contentAxisY, bottomAnchoredAxisY)
    }, [processedEvents, viewportHeight])

    const trackHeight = useMemo(() => {
        return axisY + AXIS_LABEL_SPACE + TRACK_BOTTOM_PADDING + AXIS_WHEEL_ZONE
    }, [axisY])

    const handleMouseDown = (event: React.MouseEvent) => {
        if (!scrollRef.current) return
        setIsDragging(true)
        setDragStartX(event.pageX - scrollRef.current.offsetLeft)
        setDragScrollLeft(scrollRef.current.scrollLeft)
    }

    const handleMouseUp = useCallback(() => setIsDragging(false), [])

    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (!isDragging || !scrollRef.current) return
        event.preventDefault()
        const x = event.pageX - scrollRef.current.offsetLeft
        scrollRef.current.scrollLeft = dragScrollLeft - (x - dragStartX) * 1.5
    }, [isDragging, dragScrollLeft, dragStartX])

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

    // 按钮缩放以视口中心为锚点，保持中间内容稳定
    const handleZoomButton = useCallback((direction: 1 | -1) => {
        const container = scrollRef.current
        const offsetX = container ? container.clientWidth / 2 : 0
        zoomTo(zoomLevel + direction * ZOOM_STEP, offsetX)
    }, [zoomLevel, zoomTo])

    const handleZoomFit = useCallback(() => {
        const container = scrollRef.current
        const offsetX = container ? container.clientWidth / 2 : 0
        zoomTo(minZoomLevel, offsetX)
    }, [minZoomLevel, zoomTo])

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

    useEffect(() => {
        setZoomLevel(prevZoomLevel => Math.max(prevZoomLevel, minZoomLevel))
    }, [minZoomLevel])

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

    useEffect(() => {
        if (!syncId || !scrollRef.current) return

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

    const currentSelectedId = selectedKey !== undefined ? selectedKey : internalSelectedId

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

    const handleCardClick = (eventId: string, event: React.MouseEvent<HTMLDivElement>) => {
        selectEvent(eventId, {source: 'click', event})
    }

    const handleCardKeyDown = (eventId: string, event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        selectEvent(eventId, {source: 'keyboard'})
    }

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
            <RollingBox
                className={`timeline-scroll-area ${isDragging ? 'dragging' : ''}`}
                ref={scrollRef}
                axis="x"
                showThumb="auto"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onMouseMove={handleMouseMove}
                interceptWheel={interceptWheel}
            >
                <div
                    className="flag-track"
                    style={{
                        width: trackWidth + LEFT_OFFSET * 2,
                        height: trackHeight,
                        position: 'relative',
                    }}
                >
                    <div
                        className="flag-wheel-zone"
                        aria-hidden="true"
                        style={{top: axisY, height: trackHeight - axisY}}
                    />
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
            {controlsContainer === undefined
                ? zoomControls
                : controlsContainer
                    ? createPortal(zoomControls, controlsContainer)
                    : null}
        </div>
    )
}
