import {useDrag} from '@use-gesture/react'
import {
    type HTMLAttributes,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {logger} from '../../shared/logger'

interface UseMobileSideDrawerGestureOptions {
    enabled: boolean
    width: number
    logLabel?: string
    /**
     * 是否允许从 input / textarea / contenteditable 等文本编辑区域开始识别抽屉手势。
     * 默认关闭，避免普通表单页误触；灵感便签这种编辑器优先页面可以开启，让右划更容易呼出抽屉。
     */
    allowTextEditingTargetGestures?: boolean
    /**
     * 从屏幕左边缘向右滑时触发返回，而不是打开侧边抽屉。
     * 不传则保留纯抽屉行为，适合没有页面返回语义的嵌入场景。
     */
    onEdgeBackGesture?: () => void
}

interface MobileSideDrawerDragRuntime {
    edgeBackCandidate: boolean
    openBefore: boolean
    started: boolean
}

export interface MobileSideDrawerGesture {
    open: boolean
    dragging: boolean
    offset: number | null
    surfaceOffset: number
    openDrawer: () => void
    closeDrawer: () => void
    pointerHandlers: HTMLAttributes<HTMLElement>
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
     * 开始横滑识别前，手指至少要横向移动的距离。
     * 调小后更容易触发抽屉，误触概率会上升；调大后需要更明确的横滑动作。
     */
    horizontalStartDistance: 8,

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

    /**
     * 左边缘返回手势允许起手的屏幕宽度。
     * 调大后更容易从左侧触发返回，但也更可能抢占内容区横滑；调小后需要更贴边。
     */
    edgeBackStartWidth: 24,

    /**
     * 左边缘返回手势触发返回所需的右滑距离。
     * 调大后更不容易误返回；调小后短促右滑也会直接返回。
     */
    edgeBackTriggerDistance: 34,

    /**
     * 快速滑动直接结算为打开/关闭的速度阈值，单位约为 px/ms。
     * 调小后轻扫更容易生效；调大后主要依赖拖动距离结算。
     */
    flingVelocity: 0.25,
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

function isHorizontalScrollGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('[data-mobile-horizontal-scroll="true"]'))
}

function isInternalGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('[data-mobile-side-drawer-gesture-ignore="true"]'))
}

function getElementClassName(target: EventTarget): string {
    if (!(target instanceof HTMLElement)) return 'unknown'
    return typeof target.className === 'string' ? target.className : String(target.className)
}

function getPointerId(event: Event): number | string {
    return 'pointerId' in event && typeof event.pointerId === 'number' ? event.pointerId : 'gesture'
}

function getPointerType(event: Event): string {
    return 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : event.type
}

function getTagName(target: EventTarget | null): string {
    return target instanceof HTMLElement ? target.tagName : 'unknown'
}

export function useMobileSideDrawerGesture({
    enabled,
    width,
    logLabel = '[移动端侧边抽屉手势]',
    allowTextEditingTargetGestures = false,
    onEdgeBackGesture,
}: UseMobileSideDrawerGestureOptions): MobileSideDrawerGesture {
    const [open, setOpen] = useState(false)
    const [offset, setOffset] = useState<number | null>(null)
    const [dragging, setDragging] = useState(false)
    const dragRuntimeRef = useRef<MobileSideDrawerDragRuntime | null>(null)
    const suppressClickRef = useRef(false)
    const suppressClickTimerRef = useRef<number | null>(null)

    const clearSuppressClickTimer = useCallback(() => {
        if (suppressClickTimerRef.current === null) return
        window.clearTimeout(suppressClickTimerRef.current)
        suppressClickTimerRef.current = null
    }, [])

    const suppressNextClick = useCallback(() => {
        suppressClickRef.current = true
        clearSuppressClickTimer()
        suppressClickTimerRef.current = window.setTimeout(() => {
            suppressClickRef.current = false
            suppressClickTimerRef.current = null
        }, MOBILE_SIDE_DRAWER_GESTURE_TUNING.suppressClickMs)
    }, [clearSuppressClickTimer])

    const resetDrag = useCallback(() => {
        dragRuntimeRef.current = null
        setOffset(null)
        setDragging(false)
    }, [])

    const closeDrawer = useCallback(() => {
        setOpen(false)
        resetDrag()
    }, [resetDrag])

    const openDrawer = useCallback(() => {
        if (!enabled) return
        resetDrag()
        setOpen(true)
    }, [enabled, resetDrag])

    useEffect(() => {
        if (!enabled) closeDrawer()
    }, [closeDrawer, enabled])

    useEffect(() => {
        return () => {
            clearSuppressClickTimer()
        }
    }, [clearSuppressClickTimer])

    const bindDrag = useDrag(({
        cancel,
        currentTarget,
        direction: [directionX],
        event,
        first,
        initial: [startX, startY],
        last,
        movement: [moveX, moveY],
        offset: [nextOffset],
        velocity: [velocityX],
    }) => {
        if (!enabled) return

        const pointerId = getPointerId(event)
        if (first) {
            const edgeBackCandidate = Boolean(
                !open
                && onEdgeBackGesture
                && startX <= MOBILE_SIDE_DRAWER_GESTURE_TUNING.edgeBackStartWidth,
            )

            const ignoredReason = !allowTextEditingTargetGestures && isTextEditingTarget(event.target)
                ? '文本编辑区域'
                : isInternalGestureTarget(event.target)
                    ? '内部手势区域'
                    : !edgeBackCandidate && isHorizontalScrollGestureTarget(event.target)
                        ? '横向滚动区域'
                        : ''

            if (ignoredReason) {
                logger.info(`${logLabel} 忽略`, {
                    pointerId,
                    reason: ignoredReason,
                    target: getTagName(event.target),
                })
                dragRuntimeRef.current = null
                cancel()
                return
            }

            dragRuntimeRef.current = {
                edgeBackCandidate,
                openBefore: open,
                started: false,
            }
            logger.info(`${logLabel} 按下`, {
                pointerId,
                pointerType: getPointerType(event),
                open,
                drawerWidth: width,
                startX: Math.round(startX),
                startY: Math.round(startY),
                edgeBackCandidate,
                target: getTagName(event.target),
                area: getElementClassName(currentTarget),
            })
        }

        const runtime = dragRuntimeRef.current
        if (!runtime) return

        if (runtime.edgeBackCandidate) {
            if (moveX < 0) {
                logger.info(`${logLabel} 取消`, {
                    pointerId,
                    reason: '左边缘区域左滑',
                    dx: Math.round(moveX),
                    dy: Math.round(moveY),
                })
                resetDrag()
                cancel()
                return
            }

            if (moveX >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.edgeBackTriggerDistance) {
                if (event.cancelable) event.preventDefault()
                suppressNextClick()
                logger.info(`${logLabel} 左边缘返回`, {
                    pointerId,
                    dx: Math.round(moveX),
                    dy: Math.round(moveY),
                    triggerDistance: MOBILE_SIDE_DRAWER_GESTURE_TUNING.edgeBackTriggerDistance,
                })
                resetDrag()
                cancel()
                onEdgeBackGesture?.()
                return
            }

            if (last) resetDrag()
            return
        }

        if (!runtime.openBefore && moveX < 0) {
            logger.info(`${logLabel} 取消`, {
                pointerId,
                reason: '关闭状态下左滑',
                dx: Math.round(moveX),
                dy: Math.round(moveY),
            })
            resetDrag()
            cancel()
            return
        }

        if (!runtime.started) {
            runtime.started = true
            setDragging(true)
            logger.info(`${logLabel} 开始识别`, {
                pointerId,
                open: runtime.openBefore,
                dx: Math.round(moveX),
                dy: Math.round(moveY),
                baseOffset: runtime.openBefore ? Math.round(width) : 0,
                drawerWidth: Math.round(width),
            })
        }

        if (event.cancelable) event.preventDefault()
        const currentOffset = clamp(nextOffset, 0, width)
        setOffset(currentOffset)

        if (!last) return

        const dragDistance = currentOffset - (runtime.openBefore ? width : 0)
        const fastOpen = directionX > 0 && velocityX >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.flingVelocity
        const fastClose = directionX < 0 && velocityX >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.flingVelocity
        const shouldOpen = runtime.openBefore
            ? !fastClose && dragDistance > -MOBILE_SIDE_DRAWER_GESTURE_TUNING.closeSettleDistance
            : fastOpen || dragDistance >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.openSettleDistance

        logger.info(`${logLabel} 结算`, {
            pointerId,
            tracking: runtime.started,
            openBefore: runtime.openBefore,
            shouldOpen,
            currentOffset: Math.round(currentOffset),
            dragDistance: Math.round(dragDistance),
            openDistance: MOBILE_SIDE_DRAWER_GESTURE_TUNING.openSettleDistance,
            closeDistance: MOBILE_SIDE_DRAWER_GESTURE_TUNING.closeSettleDistance,
            velocityX: Number(velocityX.toFixed(3)),
            drawerWidth: Math.round(width),
        })

        if (runtime.started) suppressNextClick()
        resetDrag()
        setOpen(shouldOpen)
    }, {
        axis: 'x',
        bounds: {left: 0, right: width},
        enabled,
        filterTaps: true,
        from: () => [open ? width : 0, 0],
        pointer: {capture: false, keys: false, touch: true},
        rubberband: false,
        threshold: MOBILE_SIDE_DRAWER_GESTURE_TUNING.horizontalStartDistance,
    })

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
            ...bindDrag(),
            onClickCapture: handleClickCapture,
        },
    }
}
