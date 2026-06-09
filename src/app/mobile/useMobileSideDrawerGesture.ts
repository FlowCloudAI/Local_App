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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function getMobileSideDrawerWidth(): number {
    if (typeof window === 'undefined') return 320
    const width = window.innerWidth || 360
    return clamp(width - 54, 260, 360)
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
            if (vertical > 16 && vertical > horizontal) {
                cancelDrag(event.pointerId, '判定为竖向滚动', {
                    dx: Math.round(dx),
                    dy: Math.round(dy),
                    horizontal: Math.round(horizontal),
                    vertical: Math.round(vertical),
                })
                return
            }
            if (horizontal < 8 || horizontal < vertical * 1.25) return
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
        const openDistance = 6
        const closeDistance = 12
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
            }, 180)
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
