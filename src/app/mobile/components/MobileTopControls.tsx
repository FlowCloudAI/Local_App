import {
    type ButtonHTMLAttributes,
    type CSSProperties,
    type ReactNode,
    type RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useLayoutEffect,
    useState,
} from 'react'
import './MobileTopControls.css'

const MOBILE_ANCHORED_MENU_CLOSE_MS = 130

export interface MobilePageTopBarProps {
    left?: ReactNode
    center?: ReactNode
    right?: ReactNode
    className?: string
    sticky?: boolean
    edgeToEdge?: boolean
    ariaLabel?: string
}

/**
 * 移动端页面顶栏外框：只统一高度、贴顶方式、背景和三段插槽。
 * 具体按钮、标题内容和菜单锚点仍由页面传入，避免把页面业务塞进通用组件。
 */
export function MobilePageTopBar({
    left,
    center,
    right,
    className,
    sticky = false,
    edgeToEdge = false,
    ariaLabel,
}: MobilePageTopBarProps) {
    return (
        <header
            className={`mobile-page-topbar${sticky ? ' mobile-page-topbar--sticky' : ''}${edgeToEdge ? ' mobile-page-topbar--edge-to-edge' : ''}${className ? ` ${className}` : ''}`}
            aria-label={ariaLabel}
        >
            <div className="mobile-page-topbar__side mobile-page-topbar__side--left">
                {left}
            </div>
            <div className="mobile-page-topbar__center">
                {center}
            </div>
            <div className="mobile-page-topbar__side mobile-page-topbar__side--right">
                {right}
            </div>
        </header>
    )
}

export interface MobileTopIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon: ReactNode
}

export function MobileTopIconButton({icon, className, ...props}: MobileTopIconButtonProps) {
    return (
        <button
            {...props}
            className={`mobile-top-icon-button${className ? ` ${className}` : ''}`}
        >
            <span className="mobile-top-icon-button__icon" aria-hidden="true">
                {icon}
            </span>
        </button>
    )
}

export interface MobileTopAction {
    key: string
    label: string
    icon: ReactNode
    onClick: () => void
    disabled?: boolean
    kind?: 'add' | 'more'
    ariaHasPopup?: ButtonHTMLAttributes<HTMLButtonElement>['aria-haspopup']
    ariaExpanded?: boolean
}

export interface MobileTopActionPillProps {
    actions: MobileTopAction[]
    className?: string
}

export const MobileTopActionPill = forwardRef<HTMLDivElement, MobileTopActionPillProps>(
    function MobileTopActionPill({actions, className}, ref) {
        const expanded = actions.some(action => action.ariaExpanded)
        return (
            <div
                ref={ref}
                className={`mobile-top-action-pill${expanded ? ' mobile-top-action-pill--expanded' : ''}${className ? ` ${className}` : ''}`}
            >
                {actions.map(action => (
                    <button
                        key={action.key}
                        type="button"
                        className={`mobile-top-action-pill__button mobile-top-action-pill__button--${action.kind ?? 'default'}`}
                        aria-label={action.label}
                        aria-haspopup={action.ariaHasPopup}
                        aria-expanded={action.ariaExpanded}
                        disabled={action.disabled}
                        onClick={action.onClick}
                    >
                        <span className="mobile-top-action-pill__icon" aria-hidden="true">
                            {action.icon}
                        </span>
                    </button>
                ))}
            </div>
        )
    }
)

export interface MobileAnchoredMenuProps {
    open: boolean
    onClose: () => void
    anchorRef: RefObject<HTMLElement | null>
    containerRef: RefObject<HTMLElement | null>
    ariaLabel: string
    children: ReactNode
    className?: string
    align?: 'left' | 'right'
    placement?: 'bottom' | 'top'
    rightBoundaryRef?: RefObject<HTMLElement | null>
    rightBoundaryGap?: number
}

export function MobileAnchoredMenu({
    open,
    onClose,
    anchorRef,
    containerRef,
    ariaLabel,
    children,
    className,
    align = 'right',
    placement = 'bottom',
    rightBoundaryRef,
    rightBoundaryGap = 0,
}: MobileAnchoredMenuProps) {
    const [anchor, setAnchor] = useState<{top: number; bottom: number; left: number; right: number; rightBoundary: number | null} | null>(null)
    const [rendered, setRendered] = useState(open)
    const [closing, setClosing] = useState(false)

    const updateAnchor = useCallback(() => {
        const containerElement = containerRef.current
        const anchorElement = anchorRef.current
        if (!containerElement || !anchorElement) return
        const containerRect = containerElement.getBoundingClientRect()
        const anchorRect = anchorElement.getBoundingClientRect()
        const boundaryRect = rightBoundaryRef?.current?.getBoundingClientRect()
        setAnchor({
            top: Math.max(0, anchorRect.top - containerRect.top),
            bottom: Math.max(0, containerRect.bottom - anchorRect.bottom),
            left: Math.max(0, anchorRect.left - containerRect.left),
            right: Math.max(0, containerRect.right - anchorRect.right),
            rightBoundary: boundaryRect
                ? Math.max(0, boundaryRect.left - containerRect.left - rightBoundaryGap)
                : null,
        })
    }, [anchorRef, containerRef, rightBoundaryGap, rightBoundaryRef])

    useEffect(() => {
        if (open) {
            setRendered(true)
            setClosing(false)
            return undefined
        }
        if (!rendered) return undefined
        setClosing(true)
        const timer = window.setTimeout(() => {
            setRendered(false)
            setClosing(false)
        }, MOBILE_ANCHORED_MENU_CLOSE_MS)
        return () => window.clearTimeout(timer)
    }, [open, rendered])

    useLayoutEffect(() => {
        if (open && rendered) updateAnchor()
    }, [open, rendered, updateAnchor])

    useEffect(() => {
        if (!open || !rendered) return undefined
        updateAnchor()
        const viewport = window.visualViewport
        window.addEventListener('resize', updateAnchor)
        viewport?.addEventListener('resize', updateAnchor)
        return () => {
            window.removeEventListener('resize', updateAnchor)
            viewport?.removeEventListener('resize', updateAnchor)
        }
    }, [open, rendered, updateAnchor])

    if (!rendered) return null

    return (
        <div
            className={`mobile-anchored-menu-layer${closing ? ' mobile-anchored-menu-layer--closing' : ''}`}
            role="presentation"
            onPointerDown={event => {
                if (!closing && event.target === event.currentTarget) onClose()
            }}
        >
            <div
                className={`mobile-anchored-menu mobile-anchored-menu--${align} mobile-anchored-menu--placement-${placement}${closing ? ' mobile-anchored-menu--closing' : ''}${className ? ` ${className}` : ''}`}
                role="menu"
                aria-label={ariaLabel}
                style={anchor ? {
                    '--mobile-anchored-menu-top': `${anchor.top}px`,
                    '--mobile-anchored-menu-bottom': `${anchor.bottom}px`,
                    '--mobile-anchored-menu-left': `${anchor.left}px`,
                    '--mobile-anchored-menu-right': `${anchor.right}px`,
                    ...(anchor.rightBoundary != null
                        ? {'--mobile-anchored-menu-right-boundary': `${anchor.rightBoundary}px`}
                        : {}),
                } as CSSProperties : undefined}
                onPointerDown={event => event.stopPropagation()}
            >
                {children}
            </div>
        </div>
    )
}

export interface MobileAnchoredMenuItem {
    key: string
    label: string
    description?: string
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
    onSelect: () => void
}

export interface MobileAnchoredActionMenuProps extends Omit<MobileAnchoredMenuProps, 'children'> {
    items: MobileAnchoredMenuItem[]
}

export function MobileAnchoredActionMenu({
    items,
    onClose,
    ...menuProps
}: MobileAnchoredActionMenuProps) {
    return (
        <MobileAnchoredMenu {...menuProps} onClose={onClose}>
            <div className="mobile-anchored-menu__group">
                {items.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        className={`mobile-anchored-menu__row${item.danger ? ' mobile-anchored-menu__row--danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            onClose()
                            item.onSelect()
                        }}
                    >
                        <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                        <span className="mobile-anchored-menu__icon" aria-hidden="true">
                            {item.icon}
                        </span>
                        <span className="mobile-anchored-menu__text">
                            <span>{item.label}</span>
                            {item.description ? <small>{item.description}</small> : null}
                        </span>
                    </button>
                ))}
            </div>
        </MobileAnchoredMenu>
    )
}

export function MobileBackIcon() {
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M14.5 5.5 8 12l6.5 6.5"/>
        </svg>
    )
}
