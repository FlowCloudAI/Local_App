import {type ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {pushOverlay, removeOverlay} from './overlayStack'
import './Overlay.css'

/** 退场动画时长，需 ≥ Overlay.css 中的 --fc-transition-slow（250ms）。 */
const EXIT_DURATION_MS = 280

type OverlayVariant = 'floating' | 'sheet'

interface OverlayProps {
    open: boolean
    onClose?: () => void
    /** 背板点击 / Esc / 返回键是否关闭，默认 true。需强制用户做选择时传 false。 */
    dismissible?: boolean
    variant?: OverlayVariant
    /** 浮层面板附加类名，用于承载自定义卡片样式。 */
    className?: string
    ariaLabel?: string
    labelledBy?: string
    dataTourId?: string
    children?: ReactNode
}

/**
 * 浮层基座：背板 + 定位 + 进出动画 + 焦点/滚动管理 + 返回栈接入。
 * 不规定卡片外观，卡片由子内容自带（或由变体组件 / className 提供）。
 */
export default function Overlay({
    open,
    onClose,
    dismissible = true,
    variant = 'floating',
    className,
    ariaLabel,
    labelledBy,
    dataTourId,
    children,
}: OverlayProps) {
    const [mounted, setMounted] = useState(open)
    const [active, setActive] = useState(false)
    const [overlayTop, setOverlayTop] = useState(0)
    const panelRef = useRef<HTMLDivElement>(null)
    // 用 ref 持有最新回调与可关闭标志，使下方副作用只依赖 open，避免 dismissible 抖动重跑。
    // 在 effect 中同步（不在渲染期写 ref，遵循 react-hooks/refs）。
    const onCloseRef = useRef(onClose)
    const dismissibleRef = useRef(dismissible)
    useEffect(() => {
        onCloseRef.current = onClose
        dismissibleRef.current = dismissible
    })

    // 开启即挂载并触发进场；关闭先播放退场再卸载。
    useEffect(() => {
        if (open) {
            setMounted(true)
            const raf = requestAnimationFrame(() => setActive(true))
            return () => cancelAnimationFrame(raf)
        }
        setActive(false)
        const timer = setTimeout(() => setMounted(false), EXIT_DURATION_MS)
        return () => clearTimeout(timer)
    }, [open])

    useEffect(() => {
        if (variant !== 'floating') {
            setOverlayTop(0)
            return
        }
        if (!open) return

        const updateOverlayTop = () => setOverlayTop(getOverlayTop())
        updateOverlayTop()
        const raf = requestAnimationFrame(updateOverlayTop)
        window.addEventListener('resize', updateOverlayTop)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('resize', updateOverlayTop)
        }
    }, [open, variant])

    // 开启期间：注册返回栈、捕获阶段 Esc（优先于页面返回）、锁定滚动、聚焦面板。
    useEffect(() => {
        if (!open) return
        const id = pushOverlay(() => onCloseRef.current?.())

        // 捕获阶段拦截 Esc：先于 window 冒泡监听（如移动端返回处理）执行并阻断，避免连带回退页面。
        const onKeyDownCapture = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && dismissibleRef.current) {
                e.preventDefault()
                e.stopPropagation()
                onCloseRef.current?.()
            }
        }
        window.addEventListener('keydown', onKeyDownCapture, true)

        const bodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        const prevFocus = document.activeElement as HTMLElement | null
        const focusRaf = requestAnimationFrame(() => {
            if (document.activeElement && panelRef.current?.contains(document.activeElement)) return
            panelRef.current?.focus()
        })

        return () => {
            removeOverlay(id)
            window.removeEventListener('keydown', onKeyDownCapture, true)
            document.body.style.overflow = bodyOverflow
            cancelAnimationFrame(focusRaf)
            prevFocus?.focus?.()
        }
    }, [open])

    if (!mounted) return null

    return createPortal(
        <div
            className={`fc-overlay fc-overlay--${variant}`}
            data-state={active ? 'open' : 'closed'}
            style={variant === 'floating' ? {top: overlayTop} : undefined}
            onMouseDown={(e) => {
                // 仅背板（自身）被按下时关闭，面板内部按下不触发。
                if (e.target === e.currentTarget && dismissibleRef.current) onCloseRef.current?.()
            }}
        >
            <div
                ref={panelRef}
                className={`fc-overlay__panel fc-overlay__panel--${variant}${className ? ` ${className}` : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                aria-labelledby={labelledBy}
                data-tour-id={dataTourId}
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body,
    )
}

function getOverlayTop(): number {
    const titleBar = document.querySelector('.top-bar')
    if (!titleBar) return 0

    return Math.max(0, titleBar.getBoundingClientRect().bottom)
}
