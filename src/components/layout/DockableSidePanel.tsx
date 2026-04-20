import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react'
import './DockableSidePanel.css'

export type DockableSidePanelMode = 'fullscreen' | 'floating'
const PANEL_COLLAPSE_THRESHOLD_RATIO = 1 / 3

interface DockableSidePanelProps {
    mode: DockableSidePanelMode
    width: number
    minWidth: number
    maxWidthRatio?: number
    collapsed?: boolean
    onCollapsedChange?: (collapsed: boolean) => void
    onWidthChange: (width: number) => void
    className?: string
    handleTitle?: string
    children: React.ReactNode
}

export default function DockableSidePanel({
                                              mode,
                                              width,
                                              minWidth,
                                              maxWidthRatio = 0.5,
                                              collapsed = false,
                                              onCollapsedChange,
                                              onWidthChange,
                                              className = '',
                                              handleTitle = '拖拽调整宽度',
                                              children,
                                          }: DockableSidePanelProps) {
    const rootRef = useRef<HTMLElement | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [isCollapsePreview, setIsCollapsePreview] = useState(false)
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

    useEffect(() => {
        if (mode === 'floating' && !collapsed) {
            lastExpandedWidthRef.current = width
        }
    }, [collapsed, mode, width])

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
        setIsDragging(true)
        isCollapsePreviewRef.current = false
        setIsCollapsePreview(false)
        dragStartXRef.current = event.clientX
        dragStartWidthRef.current = collapsed ? (lastExpandedWidthRef.current || width || minWidth) : width
        if (collapsed) {
            onCollapsedChange?.(false)
            onWidthChange(dragStartWidthRef.current)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [collapsed, minWidth, mode, onCollapsedChange, onWidthChange, width])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDraggingRef.current) return
            const delta = dragStartXRef.current - event.clientX
            const rawWidth = dragStartWidthRef.current + delta
            const collapseThreshold = dragStartWidthRef.current * PANEL_COLLAPSE_THRESHOLD_RATIO
            const nextWidth = Math.min(
                window.innerWidth * maxWidthRatio,
                Math.max(minWidth, rawWidth),
            )
            const shouldCollapse = rawWidth <= collapseThreshold
            isCollapsePreviewRef.current = shouldCollapse
            setIsCollapsePreview(shouldCollapse)
            if (!shouldCollapse) {
                onCollapsedChange?.(false)
                onWidthChange(nextWidth)
            }
        }

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            isDraggingRef.current = false
            setIsDragging(false)
            if (isCollapsePreviewRef.current) {
                onCollapsedChange?.(true)
            } else {
                onCollapsedChange?.(false)
            }
            isCollapsePreviewRef.current = false
            setIsCollapsePreview(false)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [maxWidthRatio, minWidth, onCollapsedChange, onWidthChange])

    const rootClassName = [
        'dockable-side-panel',
        `dockable-side-panel--${mode}`,
        mode === 'floating' && collapsed ? 'is-collapsed' : '',
        mode === 'floating' && isCollapsePreview ? 'is-collapse-preview' : '',
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

        return {
            width: collapsed || isCollapsePreview ? undefined : width,
        }
    })()

    return (
        <section
            ref={rootRef}
            className={rootClassName}
            style={rootStyle}
        >
            {mode === 'floating' && (
                <div
                    className={`dockable-side-panel__resize-handle${isDragging ? ' is-dragging' : ''}`}
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
