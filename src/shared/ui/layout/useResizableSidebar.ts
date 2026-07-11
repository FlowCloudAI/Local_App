import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {resolveSidebarDrag} from './sidebarResizeMath'

const COLLAPSE_PREVIEW_CLASS = 'is-sidebar-collapse-preview'
const COLLAPSE_RESTORE_CLASS = 'is-sidebar-collapse-restoring'

interface UseResizableSidebarOptions {
    widthVariable: `--${string}`
    minWidth: string
    maxWidth: string
    defaultWidth: number
    collapseThresholdRatio?: number
}

export function useResizableSidebar({
                                        widthVariable,
                                        minWidth,
                                        maxWidth,
                                        defaultWidth,
                                        collapseThresholdRatio = 1 / 5,
                                    }: UseResizableSidebarOptions) {
    const [width, setWidth] = useState(defaultWidth)
    const [collapsed, setCollapsed] = useState(false)
    const [dragging, setDragging] = useState(false)
    const layoutRef = useRef<HTMLDivElement>(null)
    const lastExpandedWidthRef = useRef(defaultWidth)
    const collapseRestoreTimerRef = useRef<number | null>(null)
    const dragCleanupRef = useRef<(() => void) | null>(null)

    const getBounds = useCallback(() => {
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
        return {
            min: rootFontSize * parseFloat(minWidth),
            max: rootFontSize * parseFloat(maxWidth),
        }
    }, [maxWidth, minWidth])

    const writeWidth = useCallback((nextWidth: number) => {
        layoutRef.current?.style.setProperty(widthVariable, `${nextWidth}px`)
    }, [widthVariable])

    useEffect(() => {
        if (!collapsed) lastExpandedWidthRef.current = width
    }, [collapsed, width])

    const expand = useCallback(() => {
        const nextWidth = lastExpandedWidthRef.current || defaultWidth
        setCollapsed(false)
        setWidth(nextWidth)
        writeWidth(nextWidth)
    }, [defaultWidth, writeWidth])

    const collapse = useCallback(() => {
        setCollapsed(true)
        writeWidth(0)
    }, [writeWidth])

    const clearCollapseRestore = useCallback(() => {
        if (collapseRestoreTimerRef.current !== null) {
            window.clearTimeout(collapseRestoreTimerRef.current)
            collapseRestoreTimerRef.current = null
        }
        layoutRef.current?.classList.remove(COLLAPSE_RESTORE_CLASS)
    }, [])

    useEffect(() => () => {
        dragCleanupRef.current?.()
        clearCollapseRestore()
    }, [clearCollapseRestore])

    const updateWidth = useCallback((nextWidth: number) => {
        const {min, max} = getBounds()
        const clampedWidth = Math.min(max, Math.max(min, nextWidth))
        setCollapsed(false)
        setWidth(clampedWidth)
        writeWidth(clampedWidth)
    }, [getBounds, writeWidth])

    const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        dragCleanupRef.current?.()

        const {min, max} = getBounds()
        const startX = event.clientX
        const startWidth = collapsed ? lastExpandedWidthRef.current || defaultWidth : width
        const collapseThreshold = startWidth * collapseThresholdRatio
        const pendingExpandHandleX = startX + startWidth
        const layout = layoutRef.current
        let currentWidth = startWidth
        let shouldCollapse = false
        let pendingExpand = collapsed
        let dragStartX = startX

        setDragging(!collapsed)
        if (collapsed) {
            setCollapsed(false)
            writeWidth(startWidth)
        }
        layout?.classList.remove(COLLAPSE_PREVIEW_CLASS)
        clearCollapseRestore()

        const onMove = (moveEvent: MouseEvent) => {
            if (pendingExpand) {
                if (moveEvent.clientX < pendingExpandHandleX) return
                pendingExpand = false
                dragStartX = pendingExpandHandleX
                setDragging(true)
            }

            const wasCollapsePreview = shouldCollapse
            const rawWidth = startWidth + moveEvent.clientX - dragStartX
            const dragResult = resolveSidebarDrag(rawWidth, min, max, collapseThreshold)
            currentWidth = dragResult.width
            shouldCollapse = dragResult.shouldCollapse

            if (wasCollapsePreview && !shouldCollapse) {
                layout?.classList.add(COLLAPSE_RESTORE_CLASS)
                if (collapseRestoreTimerRef.current !== null) {
                    window.clearTimeout(collapseRestoreTimerRef.current)
                }
                collapseRestoreTimerRef.current = window.setTimeout(() => {
                    layout?.classList.remove(COLLAPSE_RESTORE_CLASS)
                    collapseRestoreTimerRef.current = null
                }, 160)
            } else if (shouldCollapse) {
                clearCollapseRestore()
            }

            layout?.classList.toggle(COLLAPSE_PREVIEW_CLASS, shouldCollapse)
            writeWidth(shouldCollapse ? 0 : currentWidth)
        }

        let onUp: () => void = () => undefined
        const cleanup = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null
        }
        onUp = () => {
            cleanup()
            layout?.classList.remove(COLLAPSE_PREVIEW_CLASS)
            clearCollapseRestore()
            setDragging(false)

            if (shouldCollapse) {
                setCollapsed(true)
                writeWidth(0)
            } else {
                setCollapsed(false)
                setWidth(currentWidth)
            }
        }

        dragCleanupRef.current = cleanup
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }, [clearCollapseRestore, collapseThresholdRatio, collapsed, defaultWidth, getBounds, width, writeWidth])

    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        const {min, max} = getBounds()
        const nextWidth = event.key === 'ArrowLeft'
            ? width - 16
            : event.key === 'ArrowRight'
                ? width + 16
                : event.key === 'Home'
                    ? min
                    : event.key === 'End'
                        ? max
                        : null
        if (nextWidth === null) return
        event.preventDefault()
        updateWidth(nextWidth)
    }, [getBounds, updateWidth, width])

    return {
        width,
        collapsed,
        dragging,
        layoutRef,
        expand,
        collapse,
        handleMouseDown,
        handleKeyDown,
    }
}
