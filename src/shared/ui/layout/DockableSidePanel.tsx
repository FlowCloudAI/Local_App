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

interface DockableSidePanelProps {
    mode: DockableSidePanelMode
    width: number
    minWidth: number
    maxWidthRatio?: number
    collapsed?: boolean
    onCollapsedChange?: (collapsed: boolean) => void
    onWidthChange: (width: number) => void
    onModeChange?: (mode: DockableSidePanelMode) => void
    className?: string
    handleTitle?: string
    children: ReactNode
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
                                              className = '',
                                              handleTitle = '拖拽调整宽度',
                                              children,
                                          }: DockableSidePanelProps) {
    const rootRef = useRef<HTMLElement | null>(null)
    // 仅用于控制 CSS class（mousedown/mouseup 各切一次）
    const [isDraggingClass, setIsDraggingClass] = useState(false)
    const [fullscreenRect, setFullscreenRect] = useState<{
        top: number
        left: number
        width: number
        height: number
    } | null>(null)

    const isDraggingRef = useRef(false)
    const isCollapsePreviewRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRef = useRef(0)
    const lastExpandedWidthRef = useRef(width)
    // mousedown 时已是 collapsed 状态，等待第一次 mousemove 再激活拖拽
    const pendingExpandRef = useRef(false)

    useEffect(() => {
        if (mode === 'floating' && !collapsed) {
            lastExpandedWidthRef.current = width
        }
    }, [collapsed, mode, width])

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

        const updateFullscreenRect = () => {
            const parent = rootRef.current?.parentElement
            if (!parent) return
            const rect = parent.getBoundingClientRect()
            setFullscreenRect({
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
            })
        }

        updateFullscreenRect()

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
    }, [mode])

    const handleResizeStart = useCallback((event: ReactMouseEvent) => {
        if (mode !== 'floating') return
        event.preventDefault()
        isDraggingRef.current = true
        isCollapsePreviewRef.current = false
        dragStartXRef.current = event.clientX
        dragStartWidthRef.current = collapsed ? (lastExpandedWidthRef.current || width || minWidth) : width

        const el = rootRef.current
        if (collapsed) {
            // 收起状态下点击手柄：先触发展开（保留 transition），等到真正移动再激活拖拽模式
            pendingExpandRef.current = true
            onCollapsedChange?.(false)
            el?.style.setProperty('--dsp-width', `${dragStartWidthRef.current}px`)
        } else {
            pendingExpandRef.current = false
            setIsDraggingClass(true)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [collapsed, minWidth, mode, onCollapsedChange, width])

    const checkFullscreenTrigger = useCallback((panelRightEdgeX: number) => {
        if (mode !== 'floating') return false
        if (panelRightEdgeX <= FULLSCREEN_TRIGGER_DISTANCE) {
            onModeChange?.('fullscreen')
            return true
        }
        return false
    }, [mode, onModeChange])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDraggingRef.current) return

            const el = rootRef.current
            if (!el) return

            // 从收起状态展开后第一次移动：此时才真正进入拖拽，关闭 transition
            if (pendingExpandRef.current) {
                pendingExpandRef.current = false
                setIsDraggingClass(true)
            }

            const delta = dragStartXRef.current - event.clientX
            const rawWidth = dragStartWidthRef.current + delta

            // 检测是否触发全屏：面板右边缘距离视口左边界 <= 100px
            const panelRightEdgeX = window.innerWidth - rawWidth
            if (checkFullscreenTrigger(panelRightEdgeX)) {
                isDraggingRef.current = false
                setIsDraggingClass(false)
                isCollapsePreviewRef.current = false
                el.classList.remove('is-collapse-preview')
                pendingExpandRef.current = false
                document.body.style.cursor = ''
                document.body.style.userSelect = ''
                return
            }

            const collapseThreshold = dragStartWidthRef.current * PANEL_COLLAPSE_THRESHOLD_RATIO
            const nextWidth = Math.min(
                window.innerWidth * maxWidthRatio,
                Math.max(minWidth, rawWidth),
            )
            const shouldCollapse = rawWidth <= collapseThreshold

            const wasCollapsePreview = isCollapsePreviewRef.current
            isCollapsePreviewRef.current = shouldCollapse
            if (shouldCollapse !== wasCollapsePreview) {
                el.classList.toggle('is-collapse-preview', shouldCollapse)
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

            isDraggingRef.current = false
            pendingExpandRef.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''

            const shouldCollapse = isCollapsePreviewRef.current
            isCollapsePreviewRef.current = false
            setIsDraggingClass(false)
            el?.classList.remove('is-collapse-preview')

            if (shouldCollapse) {
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
            }
        }
    }, [maxWidthRatio, minWidth, onCollapsedChange, onWidthChange, checkFullscreenTrigger])

    const rootClassName = [
        'dockable-side-panel',
        `dockable-side-panel--${mode}`,
        mode === 'floating' && isDraggingClass ? 'is-dragging' : '',
        mode === 'floating' && collapsed ? 'is-collapsed' : '',
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
                    <div className="dockable-side-panel__resize-grip" aria-hidden="true">
                        <span className="dockable-side-panel__resize-dot"/>
                        <span className="dockable-side-panel__resize-dot"/>
                        <span className="dockable-side-panel__resize-dot"/>
                    </div>
                </div>
            )}
            <div className="dockable-side-panel__body">
                {children}
            </div>
        </section>
    )
}
