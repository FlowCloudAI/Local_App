import type {ButtonHTMLAttributes, HTMLAttributes} from 'react'

function joinClassNames(...classNames: Array<string | false | null | undefined>) {
    return classNames.filter(Boolean).join(' ')
}

interface DockPanelRegionProps extends HTMLAttributes<HTMLElement> {
    className?: string
}

interface DockPanelTopbarProps extends HTMLAttributes<HTMLDivElement> {
    variant?: 'main' | 'side'
}

export function DockPanelSide({className = '', ...props}: DockPanelRegionProps) {
    return (
        <aside
            className={joinClassNames('dock-panel-side', className)}
            {...props}
        />
    )
}

export function DockPanelMain({className = '', ...props}: DockPanelRegionProps) {
    return (
        <main
            className={joinClassNames('dock-panel-main', className)}
            {...props}
        />
    )
}

export function DockPanelTopbar({
    className = '',
    variant = 'main',
    ...props
}: DockPanelTopbarProps) {
    return (
        <div
            className={joinClassNames('dock-panel-topbar', `dock-panel-topbar--${variant}`, className)}
            {...props}
        />
    )
}

export function DockPanelTitle({className = '', ...props}: HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={joinClassNames('dock-panel-title', className)}
            {...props}
        />
    )
}

export function DockPanelIconButton({
    className = '',
    type = 'button',
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type={type}
            className={joinClassNames('dock-panel-icon-button', className)}
            {...props}
        />
    )
}
