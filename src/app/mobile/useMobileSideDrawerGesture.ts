import {
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {logger} from '../../shared/logger'

interface MobileSideDrawerDragState {
    pointerId: number
    startX: number
    startY: number
    baseOffset: number
    latestOffset: number
    tracking: boolean
}

interface UseMobileSideDrawerGestureOptions {
    enabled: boolean
    width: number
    logLabel?: string
}

export interface MobileSideDrawerGesture {
    open: boolean
    dragging: boolean
    offset: number | null
    surfaceOffset: number
    openDrawer: () => void
    closeDrawer: () => void
    pointerHandlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
        onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void
        onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void
    }
}

export const MOBILE_SIDE_DRAWER_GESTURE_TUNING = {
    /**
     * 浏览器/预览环境拿不到真实窗口宽度时使用的默认抽屉宽度。
     * 调大后预览里的抽屉会更宽；真机/模拟器通常会走 viewport 计算，不受它影响。
     */
    fallbackWidth: 320,

    /**
     * 抽屉展开后右侧保留的主页面露出宽度。
     * 调大后主页面剩余可见区域更宽，抽屉更窄；调小后抽屉更接近全屏。
     */
    viewportRightPeek: 54,

    /**
     * 抽屉宽度下限。
     * 调大后窄屏设备上的抽屉不会过窄，但右侧主页面露出区域会被压缩。
     */
    minWidth: 260,

    /**
     * 抽屉宽度上限。
     * 调大后宽屏设备上的抽屉可以更宽；调小后平板/横屏时抽屉更克制。
     */
    maxWidth: 360,

    /**
     * 手势尚未被识别为横滑前，允许竖向滚动优先生效的距离。
     * 调大后轻微上下抖动更不容易取消横滑；调小后页面滚动会更早抢回手势。
     */
    verticalCancelDistance: 16,

    /**
     * 开始横滑识别前，手指至少要横向移动的距离。
     * 调小后更容易触发抽屉，误触概率会上升；调大后需要更明确的横滑动作。
     */
    horizontalStartDistance: 8,

    /**
     * 横向位移相对竖向位移的优势倍数。
     * 调大后必须更“水平”才会识别为抽屉手势；调小后斜向滑动也更容易触发。
     */
    horizontalDominanceRatio: 1.25,

    /**
     * 关闭状态下，结算为打开所需的最小右滑距离。
     * 调小后短促右滑就能打开；调大后必须拖得更远才会吸附展开。
     */
    openSettleDistance: 6,

    /**
     * 打开状态下，结算为关闭所需的最小左滑距离。
     * 调小后轻微左滑就会关闭；调大后需要更明确的左滑才会收起。
     */
    closeSettleDistance: 12,

    /**
     * 横滑结束后屏蔽 click 事件的时间。
     * 调大后更能避免“滑完误点按钮”；调小后滑动结束后的点击响应恢复更快。
     */
    suppressClickMs: 180,
} as const

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function getMobileSideDrawerWidth(): number {
    if (typeof window === 'undefined') return MOBILE_SIDE_DRAWER_GESTURE_TUNING.fallbackWidth
    const width = window.innerWidth || MOBILE_SIDE_DRAWER_GESTURE_TUNING.fallbackWidth
    return clamp(
        width - MOBILE_SIDE_DRAWER_GESTURE_TUNING.viewportRightPeek,
        MOBILE_SIDE_DRAWER_GESTURE_TUNING.minWidth,
        MOBILE_SIDE_DRAWER_GESTURE_TUNING.maxWidth,
    )
}

function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function getElementClassName(element: HTMLElement): string {
    return typeof element.className === 'string' ? element.className : String(element.className)
}

export function useMobileSideDrawerGesture({
    enabled,
    width,
    logLabel = '[移动端侧边抽屉手势]',
}: UseMobileSideDrawerGestureOptions): MobileSideDrawerGesture {
    const [open, setOpen] = useState(false)
    const [offset, setOffset] = useState<number | null>(null)
    const [dragging, setDragging] = useState(false)
    const dragRef = useRef<MobileSideDrawerDragState | null>(null)
    const dragElementRef = useRef<HTMLElement | null>(null)
    const suppressClickRef = useRef(false)
    const suppressClickTimerRef = useRef<number | null>(null)

    const clearSuppressClickTimer = useCallback(() => {
        if (suppressClickTimerRef.current === null) return
        window.clearTimeout(suppressClickTimerRef.current)
        suppressClickTimerRef.current = null
    }, [])

    const closeDrawer = useCallback(() => {
        setOpen(false)
        setOffset(null)
        setDragging(false)
        dragRef.current = null
        dragElementRef.current = null
    }, [])

    const openDrawer = useCallback(() => {
        if (!enabled) return
        setOffset(null)
        setOpen(true)
    }, [enabled])

    useEffect(() => {
        if (!enabled) {
            closeDrawer()
        }
    }, [closeDrawer, enabled])

    useEffect(() => {
        return () => {
            clearSuppressClickTimer()
        }
    }, [clearSuppressClickTimer])

    const cancelDrag = useCallback((
        pointerId: number,
        reason: string,
        detail?: Record<string, unknown>,
    ) => {
        logger.info(`${logLabel} 取消`, {
            pointerId,
            reason,
            ...detail,
        })
        dragRef.current = null
        const dragElement = dragElementRef.current
        if (dragElement?.hasPointerCapture(pointerId)) {
            dragElement.releasePointerCapture(pointerId)
        }
        dragElementRef.current = null
    }, [logLabel])

    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled) return
        if (!event.isPrimary) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (isTextEditingTarget(event.target)) return

        const dragElement = event.currentTarget
        dragElementRef.current = dragElement
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseOffset: open ? width : 0,
            latestOffset: open ? width : 0,
            tracking: false,
        }
        dragElement.setPointerCapture(event.pointerId)
        logger.info(`${logLabel} 按下`, {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            open,
            drawerWidth: width,
            startX: Math.round(event.clientX),
            startY: Math.round(event.clientY),
            target: event.target instanceof HTMLElement ? event.target.tagName : 'unknown',
            area: getElementClassName(dragElement),
        })
    }, [enabled, logLabel, open, width])

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        const dx = event.clientX - dragState.startX
        const dy = event.clientY - dragState.startY
        const horizontal = Math.abs(dx)
        const vertical = Math.abs(dy)

        if (!dragState.tracking) {
            if (
                vertical > MOBILE_SIDE_DRAWER_GESTURE_TUNING.verticalCancelDistance
                && vertical > horizontal
            ) {
                cancelDrag(event.pointerId, '判定为竖向滚动', {
                    dx: Math.round(dx),
                    dy: Math.round(dy),
                    horizontal: Math.round(horizontal),
                    vertical: Math.round(vertical),
                })
                return
            }
            if (
                horizontal < MOBILE_SIDE_DRAWER_GESTURE_TUNING.horizontalStartDistance
                || horizontal < vertical * MOBILE_SIDE_DRAWER_GESTURE_TUNING.horizontalDominanceRatio
            ) return
            if (!open && dx < 0) {
                cancelDrag(event.pointerId, '关闭状态下左滑', {
                    dx: Math.round(dx),
                    dy: Math.round(dy),
                    horizontal: Math.round(horizontal),
                    vertical: Math.round(vertical),
                })
                return
            }
            dragState.tracking = true
            setDragging(true)
            logger.info(`${logLabel} 开始识别`, {
                pointerId: event.pointerId,
                open,
                dx: Math.round(dx),
                dy: Math.round(dy),
                horizontal: Math.round(horizontal),
                vertical: Math.round(vertical),
                baseOffset: Math.round(dragState.baseOffset),
                drawerWidth: Math.round(width),
            })
        }

        event.preventDefault()
        const nextOffset = clamp(dragState.baseOffset + dx, 0, width)
        dragState.latestOffset = nextOffset
        setOffset(nextOffset)
    }, [cancelDrag, logLabel, open, width])

    const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        const currentOffset = dragState.latestOffset
        const dragDistance = currentOffset - dragState.baseOffset
        const openDistance = MOBILE_SIDE_DRAWER_GESTURE_TUNING.openSettleDistance
        const closeDistance = MOBILE_SIDE_DRAWER_GESTURE_TUNING.closeSettleDistance
        const shouldOpen = dragState.tracking
            ? open
                ? dragDistance > -closeDistance
                : dragDistance >= openDistance
            : open
        logger.info(`${logLabel} 结算`, {
            pointerId: event.pointerId,
            tracking: dragState.tracking,
            openBefore: open,
            shouldOpen,
            currentOffset: Math.round(currentOffset),
            dragDistance: Math.round(dragDistance),
            openDistance: Math.round(openDistance),
            closeDistance: Math.round(closeDistance),
            drawerWidth: Math.round(width),
        })
        if (dragState.tracking) {
            suppressClickRef.current = true
            clearSuppressClickTimer()
            suppressClickTimerRef.current = window.setTimeout(() => {
                suppressClickRef.current = false
                suppressClickTimerRef.current = null
            }, MOBILE_SIDE_DRAWER_GESTURE_TUNING.suppressClickMs)
        }
        dragRef.current = null
        setOffset(null)
        setDragging(false)
        setOpen(shouldOpen)

        const dragElement = dragElementRef.current
        if (dragElement?.hasPointerCapture(event.pointerId)) {
            dragElement.releasePointerCapture(event.pointerId)
        }
        dragElementRef.current = null
    }, [clearSuppressClickTimer, logLabel, open, width])

    const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
    }, [])

    return {
        open,
        dragging,
        offset,
        surfaceOffset: offset ?? (open ? width : 0),
        openDrawer,
        closeDrawer,
        pointerHandlers: {
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: finishDrag,
            onPointerCancel: finishDrag,
            onPointerLeave: finishDrag,
            onClickCapture: handleClickCapture,
        },
    }
}
