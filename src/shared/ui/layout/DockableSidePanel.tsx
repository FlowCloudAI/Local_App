import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react'
import './DockableSidePanel.css'

export type DockableSidePanelMode = 'fullscreen' | 'floating'
const PANEL_COLLAPSE_THRESHOLD_RATIO = 1 / 5
const FULLSCREEN_TRIGGER_DISTANCE = 150
const FULLSCREEN_TRANSITION_MS = 180
const FULLSCREEN_SIDE_DEFAULT_WIDTH = 320
const FULLSCREEN_SIDE_MIN_WIDTH = 270
const FULLSCREEN_SIDE_MAX_WIDTH_RATIO = 0.45
const FULLSCREEN_SIDE_WIDTH_VAR = '--dockable-side-panel-fullscreen-side-width'
const FLOATING_COLLAPSE_PREVIEW_CLASS = 'is-collapse-preview'
const FLOATING_COLLAPSE_RESTORE_CLASS = 'is-collapse-restoring'
const FULLSCREEN_SIDE_COLLAPSE_PREVIEW_CLASS = 'is-fullscreen-side-collapse-preview'
const FULLSCREEN_SIDE_COLLAPSE_RESTORE_CLASS = 'is-fullscreen-side-collapse-restoring'

type ResizeDragMode = 'floating-panel' | 'fullscreen-side' | null

interface PanelRect {
    top: number
    left: number
    width: number
    height: number
}

interface DockableSidePanelProps {
    mode: DockableSidePanelMode
    width: number
    minWidth: number
    maxWidthRatio?: number
    collapsed?: boolean
    onCollapsedChange?: (collapsed: boolean) => void
    onWidthChange: (width: number) => void
    onModeChange?: (mode: DockableSidePanelMode) => void
    fullscreenSideWidth?: number
    fullscreenSideMinWidth?: number
    fullscreenSideMaxWidthRatio?: number
    fullscreenSideCollapsed?: boolean
    onFullscreenSideWidthChange?: (width: number) => void
    onFullscreenSideCollapsedChange?: (collapsed: boolean) => void
    className?: string
    handleTitle?: string
    // 双 slot API：side 仅在 fullscreen 渲染，main 始终渲染；
    // 每个 stack 内按 activeKey 互斥切换 active 层
    sides?: Record<string, ReactNode>
    mains: Record<string, ReactNode>
    activeKey: string
}

export default function DockableSidePanel({
                                              mode,
                                              width,
                                              minWidth,
                                              maxWidthRatio = 0.5,
                                              collapsed = false,
                                              onCollapsedChange,
                                              onWidthChange,
                                              onModeChange,
                                              fullscreenSideWidth = FULLSCREEN_SIDE_DEFAULT_WIDTH,
                                              fullscreenSideMinWidth = FULLSCREEN_SIDE_MIN_WIDTH,
                                              fullscreenSideMaxWidthRatio = FULLSCREEN_SIDE_MAX_WIDTH_RATIO,
                                              fullscreenSideCollapsed = false,
                                              onFullscreenSideWidthChange,
                                              onFullscreenSideCollapsedChange,
                                              className = '',
                                              handleTitle = '拖拽调整宽度',
                                              sides,
                                              mains,
                                              activeKey,
                                          }: DockableSidePanelProps) {
    const rootRef = useRef<HTMLElement | null>(null)
    // 仅用于控制 CSS class（mousedown/mouseup 各切一次）
    const [isDraggingClass, setIsDraggingClass] = useState(false)
    const [fullscreenRect, setFullscreenRect] = useState<PanelRect | null>(null)
    const [fullscreenTransform, setFullscreenTransform] = useState<string | undefined>()
    const [fullscreenTransitionEnabled, setFullscreenTransitionEnabled] = useState(false)
    const [dragHint, setDragHint] = useState('')

    const isDraggingRef = useRef(false)
    const isCollapsePreviewRef = useRef(false)
    const isFullscreenPreviewRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRef = useRef(0)
    const lastFloatingRectRef = useRef<PanelRect | null>(null)
    const previousModeRef = useRef<DockableSidePanelMode>(mode)
    const fullscreenAnimationRafRef = useRef<number | null>(null)
    const fullscreenAnimationTimerRef = useRef<number | null>(null)
    const collapseRestoreTimerRef = useRef<number | null>(null)
    // mousedown 时已是 collapsed 状态，等待鼠标移动到展开后的手柄位置再激活拖拽
    const pendingExpandRef = useRef(false)
    const pendingExpandHandleXRef = useRef(0)
    const resizeDragModeRef = useRef<ResizeDragMode>(null)
    const dragCurrentWidthRef = useRef(0)

    const readPanelRect = useCallback((rect: DOMRect): PanelRect => ({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
    }), [])

    const readFullscreenTargetRect = useCallback((): PanelRect | null => {
        const parent = rootRef.current?.parentElement
        if (!parent) return null
        return readPanelRect(parent.getBoundingClientRect())
    }, [readPanelRect])

    const getFullscreenSideMaxWidth = useCallback(() => {
        const containerWidth = fullscreenRect?.width
            ?? readFullscreenTargetRect()?.width
            ?? window.innerWidth
        return Math.max(fullscreenSideMinWidth, containerWidth * fullscreenSideMaxWidthRatio)
    }, [fullscreenRect?.width, fullscreenSideMaxWidthRatio, fullscreenSideMinWidth, readFullscreenTargetRect])

    const clampFullscreenSideWidth = useCallback((nextWidth: number) => (
        Math.min(
            getFullscreenSideMaxWidth(),
            Math.max(fullscreenSideMinWidth, nextWidth),
        )
    ), [fullscreenSideMinWidth, getFullscreenSideMaxWidth])

    const writeFullscreenSideWidth = useCallback((nextWidth: number) => {
        rootRef.current?.style.setProperty(
            FULLSCREEN_SIDE_WIDTH_VAR,
            `${clampFullscreenSideWidth(nextWidth)}px`,
        )
    }, [clampFullscreenSideWidth])

    const clearFullscreenAnimation = useCallback(() => {
        if (fullscreenAnimationRafRef.current !== null) {
            window.cancelAnimationFrame(fullscreenAnimationRafRef.current)
            fullscreenAnimationRafRef.current = null
        }
        if (fullscreenAnimationTimerRef.current !== null) {
            window.clearTimeout(fullscreenAnimationTimerRef.current)
            fullscreenAnimationTimerRef.current = null
        }
    }, [])

    const finishFullscreenAnimation = useCallback(() => {
        clearFullscreenAnimation()
        setFullscreenTransitionEnabled(false)
        setFullscreenTransform(undefined)
    }, [clearFullscreenAnimation])

    const clearCollapseRestore = useCallback(() => {
        if (collapseRestoreTimerRef.current !== null) {
            window.clearTimeout(collapseRestoreTimerRef.current)
            collapseRestoreTimerRef.current = null
        }
        rootRef.current?.classList.remove(FLOATING_COLLAPSE_RESTORE_CLASS)
        rootRef.current?.classList.remove(FULLSCREEN_SIDE_COLLAPSE_RESTORE_CLASS)
    }, [])

    const startFullscreenEnterAnimation = useCallback((targetRect: PanelRect) => {
        const rootRect = rootRef.current ? readPanelRect(rootRef.current.getBoundingClientRect()) : null
        const startRect = lastFloatingRectRef.current ?? rootRect ?? targetRect
        const translateX = startRect.left - targetRect.left
        const translateY = startRect.top - targetRect.top
        const scaleX = targetRect.width > 0 ? startRect.width / targetRect.width : 1
        const scaleY = targetRect.height > 0 ? startRect.height / targetRect.height : 1
        const inverseTransform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`

        clearFullscreenAnimation()
        setFullscreenRect(targetRect)
        setFullscreenTransitionEnabled(false)
        setFullscreenTransform(inverseTransform)

        fullscreenAnimationRafRef.current = window.requestAnimationFrame(() => {
            const el = rootRef.current
            if (el) {
                el.getBoundingClientRect()
            }
            fullscreenAnimationRafRef.current = window.requestAnimationFrame(() => {
                setFullscreenTransitionEnabled(true)
                setFullscreenTransform('none')
            })
        })
        fullscreenAnimationTimerRef.current = window.setTimeout(
            finishFullscreenAnimation,
            FULLSCREEN_TRANSITION_MS + 60,
        )
    }, [clearFullscreenAnimation, finishFullscreenAnimation, readPanelRect])

    useLayoutEffect(() => {
        if (mode !== 'floating') return

        const el = rootRef.current
        if (!el) return

        const syncFloatingRect = () => {
            lastFloatingRectRef.current = readPanelRect(el.getBoundingClientRect())
        }

        syncFloatingRect()
        window.addEventListener('resize', syncFloatingRect)

        if (typeof ResizeObserver === 'undefined') {
            return () => {
                window.removeEventListener('resize', syncFloatingRect)
            }
        }

        const observer = new ResizeObserver(syncFloatingRect)
        observer.observe(el)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', syncFloatingRect)
        }
    }, [mode, readPanelRect])

    // 非拖拽期间，props 变化时同步 CSS 变量到 DOM
    useEffect(() => {
        if (mode !== 'floating') return
        if (isDraggingRef.current) return

        const el = rootRef.current
        if (!el) return

        if (collapsed) {
            el.style.setProperty('--dsp-width', '0px')
        } else {
            el.style.setProperty('--dsp-width', `${width}px`)
        }
    }, [mode, collapsed, width])

    useLayoutEffect(() => {
        if (mode !== 'fullscreen') return
        if (isDraggingRef.current && resizeDragModeRef.current === 'fullscreen-side') return

        writeFullscreenSideWidth(fullscreenSideWidth)
    }, [fullscreenSideWidth, mode, writeFullscreenSideWidth])

    useLayoutEffect(() => {
        const previousMode = previousModeRef.current
        previousModeRef.current = mode

        if (mode !== 'fullscreen') {
            finishFullscreenAnimation()
            return
        }

        const targetRect = readFullscreenTargetRect()
        if (previousMode === 'floating' && targetRect) {
            startFullscreenEnterAnimation(targetRect)
        } else if (targetRect) {
            setFullscreenRect(targetRect)
        }

        const updateFullscreenRect = () => {
            const rect = readFullscreenTargetRect()
            if (!rect) return
            setFullscreenRect(rect)
        }

        const parent = rootRef.current?.parentElement
        if (!parent || typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateFullscreenRect)
            return () => {
                window.removeEventListener('resize', updateFullscreenRect)
            }
        }

        const observer = new ResizeObserver(() => {
            updateFullscreenRect()
        })

        observer.observe(parent)
        window.addEventListener('resize', updateFullscreenRect)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', updateFullscreenRect)
        }
    }, [finishFullscreenAnimation, mode, readFullscreenTargetRect, startFullscreenEnterAnimation])

    useEffect(() => () => {
        clearFullscreenAnimation()
        clearCollapseRestore()
    }, [clearCollapseRestore, clearFullscreenAnimation])

    const handleResizeStart = useCallback((event: ReactMouseEvent) => {
        if (mode !== 'floating') return
        event.preventDefault()
        resizeDragModeRef.current = 'floating-panel'
        isDraggingRef.current = true
        isCollapsePreviewRef.current = false
        isFullscreenPreviewRef.current = false
        setDragHint('调整宽度')
        dragStartXRef.current = event.clientX
        dragStartWidthRef.current = collapsed ? minWidth : width

        const el = rootRef.current
        if (collapsed) {
            // 收起状态下点击手柄：先触发展开（保留 transition），等鼠标追上新手柄位置再激活拖拽
            pendingExpandRef.current = true
            pendingExpandHandleXRef.current = event.clientX - dragStartWidthRef.current
            onCollapsedChange?.(false)
            el?.style.setProperty('--dsp-width', `${dragStartWidthRef.current}px`)
        } else {
            pendingExpandRef.current = false
            setIsDraggingClass(true)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [collapsed, minWidth, mode, onCollapsedChange, width])

    const handleFullscreenSideResizeStart = useCallback((event: ReactMouseEvent) => {
        if (mode !== 'fullscreen') return
        event.preventDefault()
        resizeDragModeRef.current = 'fullscreen-side'
        isDraggingRef.current = true
        isCollapsePreviewRef.current = false
        isFullscreenPreviewRef.current = false
        setDragHint('调整侧栏宽度')

        const startWidth = clampFullscreenSideWidth(
            fullscreenSideCollapsed
                ? fullscreenSideWidth || FULLSCREEN_SIDE_DEFAULT_WIDTH
                : fullscreenSideWidth,
        )
        dragStartXRef.current = event.clientX
        dragStartWidthRef.current = startWidth
        dragCurrentWidthRef.current = startWidth

        const el = rootRef.current
        if (fullscreenSideCollapsed) {
            // 收起状态下点击手柄：先展开到上次宽度，等鼠标追上新手柄位置后继续拖拽。
            pendingExpandRef.current = true
            pendingExpandHandleXRef.current = event.clientX + startWidth
            onFullscreenSideCollapsedChange?.(false)
            writeFullscreenSideWidth(startWidth)
        } else {
            pendingExpandRef.current = false
            setIsDraggingClass(true)
        }
        el?.classList.remove(FULLSCREEN_SIDE_COLLAPSE_PREVIEW_CLASS)
        clearCollapseRestore()
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [
        clampFullscreenSideWidth,
        clearCollapseRestore,
        fullscreenSideCollapsed,
        fullscreenSideWidth,
        mode,
        onFullscreenSideCollapsedChange,
        writeFullscreenSideWidth,
    ])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDraggingRef.current) return

            const el = rootRef.current
            if (!el) return
            const dragMode = resizeDragModeRef.current

            if (dragMode === 'fullscreen-side') {
                if (pendingExpandRef.current) {
                    if (event.clientX < pendingExpandHandleXRef.current) {
                        setDragHint('移到手柄位置后拖拽')
                        return
                    }
                    pendingExpandRef.current = false
                    dragStartXRef.current = pendingExpandHandleXRef.current
                    setIsDraggingClass(true)
                }

                const rawWidth = dragStartWidthRef.current + event.clientX - dragStartXRef.current
                const collapseThreshold = dragStartWidthRef.current * PANEL_COLLAPSE_THRESHOLD_RATIO
                const nextWidth = clampFullscreenSideWidth(rawWidth)
                const shouldCollapse = rawWidth <= collapseThreshold
                const wasCollapsePreview = isCollapsePreviewRef.current
                isCollapsePreviewRef.current = shouldCollapse
                dragCurrentWidthRef.current = nextWidth

                if (wasCollapsePreview && !shouldCollapse) {
                    el.classList.add(FULLSCREEN_SIDE_COLLAPSE_RESTORE_CLASS)
                    if (collapseRestoreTimerRef.current !== null) {
                        window.clearTimeout(collapseRestoreTimerRef.current)
                    }
                    collapseRestoreTimerRef.current = window.setTimeout(() => {
                        el.classList.remove(FULLSCREEN_SIDE_COLLAPSE_RESTORE_CLASS)
                        collapseRestoreTimerRef.current = null
                    }, 160)
                } else if (shouldCollapse) {
                    clearCollapseRestore()
                }
                if (shouldCollapse !== wasCollapsePreview) {
                    el.classList.toggle(FULLSCREEN_SIDE_COLLAPSE_PREVIEW_CLASS, shouldCollapse)
                }

                setDragHint(shouldCollapse ? '释放后收起侧栏' : '调整侧栏宽度')
                el.style.setProperty(
                    FULLSCREEN_SIDE_WIDTH_VAR,
                    shouldCollapse ? '0px' : `${nextWidth}px`,
                )
                return
            }

            if (pendingExpandRef.current) {
                if (event.clientX > pendingExpandHandleXRef.current) {
                    setDragHint('移到手柄位置后拖拽')
                    return
                }
                pendingExpandRef.current = false
                dragStartXRef.current = pendingExpandHandleXRef.current
                setIsDraggingClass(true)
            }

            const delta = dragStartXRef.current - event.clientX
            const rawWidth = dragStartWidthRef.current + delta

            // 检测是否触发全屏：面板右边缘距离视口左边界 <= 100px
            const panelRightEdgeX = window.innerWidth - rawWidth
            const shouldFullscreen = panelRightEdgeX <= FULLSCREEN_TRIGGER_DISTANCE

            const collapseThreshold = dragStartWidthRef.current * PANEL_COLLAPSE_THRESHOLD_RATIO
            const nextWidth = Math.min(
                window.innerWidth * maxWidthRatio,
                Math.max(minWidth, rawWidth),
            )
            const shouldCollapse = !shouldFullscreen && rawWidth <= collapseThreshold

            const wasCollapsePreview = isCollapsePreviewRef.current
            const wasFullscreenPreview = isFullscreenPreviewRef.current
            isCollapsePreviewRef.current = shouldCollapse
            isFullscreenPreviewRef.current = shouldFullscreen
            if (wasCollapsePreview && !shouldCollapse) {
                el.classList.add(FLOATING_COLLAPSE_RESTORE_CLASS)
                if (collapseRestoreTimerRef.current !== null) {
                    window.clearTimeout(collapseRestoreTimerRef.current)
                }
                collapseRestoreTimerRef.current = window.setTimeout(() => {
                    el.classList.remove(FLOATING_COLLAPSE_RESTORE_CLASS)
                    collapseRestoreTimerRef.current = null
                }, 160)
            } else if (shouldCollapse) {
                clearCollapseRestore()
            }
            if (shouldCollapse !== wasCollapsePreview) {
                el.classList.toggle(FLOATING_COLLAPSE_PREVIEW_CLASS, shouldCollapse)
            }
            if (shouldFullscreen !== wasFullscreenPreview) {
                el.classList.toggle('is-fullscreen-preview', shouldFullscreen)
            }

            if (shouldFullscreen) {
                setDragHint('释放后全屏')
            } else if (shouldCollapse) {
                setDragHint('释放后折叠')
            } else {
                setDragHint('调整宽度')
            }

            if (shouldCollapse) {
                // 拖过阈值：CSS transition 接管，面板在用户手里就开始动画收起
                el.style.setProperty('--dsp-width', '0px')
            } else {
                // 正常拖拽：直接写 DOM，零 React 渲染开销
                el.style.setProperty('--dsp-width', `${nextWidth}px`)
            }
        }

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            const el = rootRef.current
            const dragMode = resizeDragModeRef.current

            isDraggingRef.current = false
            pendingExpandRef.current = false
            resizeDragModeRef.current = null
            document.body.style.cursor = ''
            document.body.style.userSelect = ''

            const shouldCollapse = isCollapsePreviewRef.current
            const shouldFullscreen = isFullscreenPreviewRef.current
            isCollapsePreviewRef.current = false
            isFullscreenPreviewRef.current = false
            setIsDraggingClass(false)
            setDragHint('')
            clearCollapseRestore()
            el?.classList.remove(FLOATING_COLLAPSE_PREVIEW_CLASS)
            el?.classList.remove(FULLSCREEN_SIDE_COLLAPSE_PREVIEW_CLASS)
            el?.classList.remove('is-fullscreen-preview')

            if (dragMode === 'fullscreen-side') {
                if (shouldCollapse) {
                    onFullscreenSideCollapsedChange?.(true)
                    el?.style.setProperty(FULLSCREEN_SIDE_WIDTH_VAR, '0px')
                } else {
                    const finalWidth = clampFullscreenSideWidth(dragCurrentWidthRef.current || dragStartWidthRef.current)
                    onFullscreenSideCollapsedChange?.(false)
                    onFullscreenSideWidthChange?.(finalWidth)
                    el?.style.setProperty(FULLSCREEN_SIDE_WIDTH_VAR, `${finalWidth}px`)
                }
                return
            }

            if (shouldFullscreen) {
                if (el) {
                    lastFloatingRectRef.current = readPanelRect(el.getBoundingClientRect())
                }
                onModeChange?.('fullscreen')
            } else if (shouldCollapse) {
                onCollapsedChange?.(true)
            } else {
                const currentWidthStr = el?.style.getPropertyValue('--dsp-width')
                const currentWidth = currentWidthStr ? parseFloat(currentWidthStr) : dragStartWidthRef.current
                const finalWidth = Math.min(
                    window.innerWidth * maxWidthRatio,
                    Math.max(minWidth, currentWidth),
                )
                onCollapsedChange?.(false)
                onWidthChange(finalWidth)
            }
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            // 组件卸载时若仍在拖拽，清理残留样式
            if (isDraggingRef.current) {
                document.body.style.cursor = ''
                document.body.style.userSelect = ''
                resizeDragModeRef.current = null
            }
            clearCollapseRestore()
        }
    }, [
        clampFullscreenSideWidth,
        clearCollapseRestore,
        maxWidthRatio,
        minWidth,
        onCollapsedChange,
        onFullscreenSideCollapsedChange,
        onFullscreenSideWidthChange,
        onModeChange,
        onWidthChange,
        readPanelRect,
    ])

    const hasFullscreenSide = mode === 'fullscreen' && sides?.[activeKey] != null

    const rootClassName = [
        'dockable-side-panel',
        `dockable-side-panel--${mode}`,
        isDraggingClass ? 'is-dragging' : '',
        mode === 'floating' && collapsed ? 'is-collapsed' : '',
        hasFullscreenSide && fullscreenSideCollapsed ? 'is-fullscreen-side-collapsed' : '',
        mode === 'fullscreen' && fullscreenTransitionEnabled ? 'is-fullscreen-animating' : '',
        className,
    ].filter(Boolean).join(' ')

    const rootStyle: CSSProperties | undefined = (() => {
        if (mode === 'fullscreen') {
            if (!fullscreenRect) return undefined
            return {
                position: 'fixed',
                top: fullscreenRect.top,
                left: fullscreenRect.left,
                width: fullscreenRect.width,
                height: fullscreenRect.height,
                zIndex: 1000,
                transform: fullscreenTransform,
                transformOrigin: 'top left',
            }
        }
        // floating 模式下宽度由 CSS 变量 --dsp-width 控制，不通过 inline style
        return undefined
    })()

    return (
        <section
            ref={rootRef}
            className={rootClassName}
            style={rootStyle}
        >
            {mode === 'floating' && (
                <div
                    className={`dockable-side-panel__resize-handle${isDraggingClass ? ' is-dragging' : ''}`}
                    onMouseDown={handleResizeStart}
                    title={handleTitle}
                >
                    {dragHint && (
                        <div className="dockable-side-panel__drag-hint">
                            {dragHint}
                        </div>
                    )}
                    <div className="dockable-side-panel__resize-grip" aria-hidden="true">
                        <span className="dockable-side-panel__resize-dot"/>
                        <span className="dockable-side-panel__resize-dot"/>
                        <span className="dockable-side-panel__resize-dot"/>
                    </div>
                </div>
            )}
            <div className="dockable-side-panel__body">
                {/* side-stack 仅在 active layer 真实存在 side 节点时渲染，
                    避免非激活 layer 撑出宽度形成空白 */}
                {hasFullscreenSide && (
                    <div className="dockable-side-panel__side-stack">
                        {Object.entries(sides ?? {}).map(([key, node]) => (
                            <div
                                key={key}
                                className={`dockable-side-panel__side-layer${key === activeKey ? ' active' : ''}`}
                                aria-hidden={key !== activeKey}
                            >
                                {node}
                            </div>
                        ))}
                    </div>
                )}
                {hasFullscreenSide && (
                    <div
                        className={`dockable-side-panel__side-resize-handle${isDraggingClass ? ' is-dragging' : ''}`}
                        onMouseDown={handleFullscreenSideResizeStart}
                        title="拖拽调整侧栏宽度"
                    >
                        {dragHint && (
                            <div className="dockable-side-panel__drag-hint">
                                {dragHint}
                            </div>
                        )}
                        <div className="dockable-side-panel__resize-grip" aria-hidden="true">
                            <span className="dockable-side-panel__resize-dot"/>
                            <span className="dockable-side-panel__resize-dot"/>
                            <span className="dockable-side-panel__resize-dot"/>
                        </div>
                    </div>
                )}
                <div className="dockable-side-panel__main-stack">
                    {Object.entries(mains).map(([key, node]) => (
                        <div
                            key={key}
                            className={`dockable-side-panel__main-layer${key === activeKey ? ' active' : ''}`}
                            aria-hidden={key !== activeKey}
                        >
                            {node}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
