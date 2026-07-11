import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
} from 'react'
import './SidebarResizeHandle.css'

interface SidebarResizeHandleProps {
    dragging: boolean
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
    onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
    ariaLabel?: string
}

export function SidebarResizeHandle({
                                        dragging,
                                        onMouseDown,
                                        onKeyDown,
                                        ariaLabel = '调整侧栏宽度',
                                    }: SidebarResizeHandleProps) {
    return (
        <div
            className={`fc-sidebar-resize-handle ${dragging ? 'is-dragging' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={ariaLabel}
            tabIndex={onKeyDown ? 0 : undefined}
            onMouseDown={onMouseDown}
            onKeyDown={onKeyDown}
        >
            <div className="fc-sidebar-resize-handle__grip" aria-hidden="true">
                <span className="fc-sidebar-resize-handle__dot"/>
                <span className="fc-sidebar-resize-handle__dot"/>
                <span className="fc-sidebar-resize-handle__dot"/>
            </div>
        </div>
    )
}
