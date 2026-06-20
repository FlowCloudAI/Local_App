import {
    type CSSProperties,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {useDrag} from '@use-gesture/react'
import {createPortal} from 'react-dom'
import {pushOverlay, removeOverlay} from '../../../shared/ui/overlay/overlayStack'
import './MobileBottomSheet.css'

const EXIT_DURATION_MS = 100

interface BottomSheetDragRuntime {
    startScrollTop: number
    started: boolean
}

type MobileBottomSheetStyle = CSSProperties & {'--mobile-bottom-sheet-drag-offset'?: string}

function shouldSkipBottomSheetDrag(target: EventTarget | null, sheet: HTMLElement): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-mobile-bottom-sheet-drag-lock="true"]')) {
        return true
    }

    let element: HTMLElement | null = target
    while (element && element !== sheet) {
        const style = window.getComputedStyle(element)
        const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll'
        if (scrollableY && element.scrollHeight > element.clientHeight) return true
        element = element.parentElement
    }
    return false
}

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
    const dragRef = useRef<BottomSheetDragRuntime | null>(null)
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

    const resetDrag = useCallback(() => {
        dragRef.current = null
        setDragging(false)
        setDragOffset(0)
    }, [])

    const bindSheetDrag = useDrag(({
        cancel,
        event,
        first,
        last,
        movement: [moveX, moveY],
        velocity: [, velocityY],
    }) => {
        if (closing || !mounted || !dismissible) return
        const sheet = sheetRef.current
        if (!sheet) return

        if (first) {
            if (shouldSkipBottomSheetDrag(event.target, sheet)) {
                dragRef.current = null
                cancel()
                return
            }
            dragRef.current = {
                startScrollTop: sheet.scrollTop,
                started: false,
            }
        }

        const dragState = dragRef.current
        if (!dragState) return
        const horizontal = Math.abs(moveX)
        const vertical = Math.abs(moveY)

        if (!dragState.started) {
            if (horizontal < 6 && vertical < 6) return
            if (moveY <= 0 || horizontal > vertical * 1.1) {
                resetDrag()
                cancel()
                return
            }
            if (dragState.startScrollTop > 0 || sheet.scrollTop > 0) {
                if (last) dragRef.current = null
                return
            }
            dragState.started = true
            setDragging(true)
        }

        if (event.cancelable) event.preventDefault()
        const nextOffset = Math.max(0, Math.min(moveY, window.innerHeight * 0.45))
        setDragOffset(nextOffset)

        if (!last) return
        dragRef.current = null
        setDragging(false)
        if (dragState.started && (nextOffset > 68 || velocityY > 0.45)) {
            onCloseRef.current()
            return
        }
        setDragOffset(0)
    }, {
        axis: 'y',
        enabled: mounted && !closing && dismissible,
        filterTaps: true,
        pointer: {capture: false, keys: false, touch: true},
        threshold: 6,
    })

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
                {...bindSheetDrag()}
            >
                <div className="mobile-bottom-sheet__handle" aria-hidden="true"/>
                {children}
            </section>
        </div>,
        document.body,
    )
}
