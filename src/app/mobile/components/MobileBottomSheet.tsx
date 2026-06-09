import {
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {createPortal} from 'react-dom'
import {pushOverlay, removeOverlay} from '../../../shared/ui/overlay/overlayStack'
import './MobileBottomSheet.css'

const EXIT_DURATION_MS = 100

interface BottomSheetDragState {
    pointerId: number
    startX: number
    startY: number
    startScrollTop: number
    lastY: number
    lastTime: number
    velocityY: number
    currentOffset: number
    tracking: boolean
}

type MobileBottomSheetStyle = CSSProperties & {'--mobile-bottom-sheet-drag-offset'?: string}

export interface MobileBottomSheetProps {
    open: boolean
    onClose: () => void
    ariaLabel?: string
    dismissible?: boolean
    className?: string
    children?: ReactNode
}

export default function MobileBottomSheet({
    open,
    onClose,
    ariaLabel = '底部操作面板',
    dismissible = true,
    className,
    children,
}: MobileBottomSheetProps) {
    const [mounted, setMounted] = useState(open)
    const [closing, setClosing] = useState(false)
    const [dragging, setDragging] = useState(false)
    const [dragOffset, setDragOffset] = useState(0)
    const sheetRef = useRef<HTMLElement | null>(null)
    const closeTimerRef = useRef<number | null>(null)
    const dragRef = useRef<BottomSheetDragState | null>(null)
    const onCloseRef = useRef(onClose)
    const dismissibleRef = useRef(dismissible)

    useEffect(() => {
        onCloseRef.current = onClose
        dismissibleRef.current = dismissible
    })

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current === null) return
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
    }, [])

    useEffect(() => {
        if (open) {
            clearCloseTimer()
            dragRef.current = null
            setDragOffset(0)
            setDragging(false)
            setMounted(true)
            setClosing(false)
            return
        }
        if (!mounted) return
        clearCloseTimer()
        setClosing(true)
        closeTimerRef.current = window.setTimeout(() => {
            setMounted(false)
            setClosing(false)
            setDragging(false)
            setDragOffset(0)
            dragRef.current = null
            closeTimerRef.current = null
        }, EXIT_DURATION_MS)
    }, [clearCloseTimer, mounted, open])

    useEffect(() => {
        return () => {
            clearCloseTimer()
        }
    }, [clearCloseTimer])

    useEffect(() => {
        if (!mounted || closing) return
        const overlayId = pushOverlay(() => {
            if (dismissibleRef.current) onCloseRef.current()
        })

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !dismissibleRef.current) return
            event.preventDefault()
            event.stopPropagation()
            onCloseRef.current()
        }
        window.addEventListener('keydown', handleKeyDown, true)

        const bodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            removeOverlay(overlayId)
            window.removeEventListener('keydown', handleKeyDown, true)
            document.body.style.overflow = bodyOverflow
        }
    }, [closing, mounted])

    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (closing || !mounted || !dismissible) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const sheet = sheetRef.current
        if (!sheet) return
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startScrollTop: sheet.scrollTop,
            lastY: event.clientY,
            lastTime: window.performance.now(),
            velocityY: 0,
            currentOffset: 0,
            tracking: false,
        }
    }, [closing, dismissible, mounted])

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return
        const sheet = sheetRef.current
        if (!sheet) return

        const dx = event.clientX - dragState.startX
        const dy = event.clientY - dragState.startY
        const horizontal = Math.abs(dx)
        const vertical = Math.abs(dy)
        const now = window.performance.now()
        const elapsed = Math.max(now - dragState.lastTime, 1)
        dragState.velocityY = (event.clientY - dragState.lastY) / elapsed
        dragState.lastY = event.clientY
        dragState.lastTime = now

        if (!dragState.tracking) {
            if (horizontal < 6 && vertical < 6) return
            if (dy <= 0 || horizontal > vertical * 1.1) {
                dragRef.current = null
                return
            }
            if (dragState.startScrollTop > 0 || sheet.scrollTop > 0) return
            dragState.tracking = true
            setDragging(true)
            event.currentTarget.setPointerCapture?.(event.pointerId)
        }

        event.preventDefault()
        const nextOffset = Math.max(0, Math.min(dy, window.innerHeight * 0.45))
        dragState.currentOffset = nextOffset
        setDragOffset(nextOffset)
    }, [])

    const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        dragRef.current = null
        setDragging(false)

        if (dragState.tracking && (dragState.currentOffset > 68 || dragState.velocityY > 0.45)) {
            onCloseRef.current()
            return
        }
        setDragOffset(0)
    }, [])

    const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        dragRef.current = null
        setDragging(false)
        setDragOffset(0)
    }, [])

    if (!mounted || typeof document === 'undefined') return null

    const sheetStyle: CSSProperties | undefined = dragOffset > 0
        ? ({'--mobile-bottom-sheet-drag-offset': `${dragOffset}px`} as MobileBottomSheetStyle)
        : undefined

    return createPortal(
        <div
            className={`mobile-bottom-sheet-layer${closing ? ' is-closing' : ''}`}
            role="presentation"
            onPointerDown={event => {
                if (event.target === event.currentTarget && dismissibleRef.current) onCloseRef.current()
            }}
        >
            <section
                ref={sheetRef}
                className={`mobile-bottom-sheet${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
                style={sheetStyle}
                aria-label={ariaLabel}
                role="dialog"
                aria-modal="true"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
            >
                <div className="mobile-bottom-sheet__handle" aria-hidden="true"/>
                {children}
            </section>
        </div>,
        document.body,
    )
}
