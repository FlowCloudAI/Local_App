import {type ReactNode, useId} from 'react'
import {Button} from 'flowcloudai-ui'
import Overlay from './Overlay'

export interface FloatingPanelProps {
    open: boolean
    onClose?: () => void
    dismissible?: boolean
    className?: string
    title?: ReactNode
    ariaLabel?: string
    labelledBy?: string
    dataTourId?: string
    closeLabel?: string
    showCloseButton?: boolean
    children?: ReactNode
}

/**
 * 浮动面板：四边不挨屏、居中、点背板可关闭。基于 Overlay。
 */
export default function FloatingPanel({
    title,
    onClose,
    dismissible = true,
    ariaLabel,
    labelledBy,
    closeLabel = '关闭',
    showCloseButton,
    children,
    ...props
}: FloatingPanelProps) {
    const generatedTitleId = useId()
    const titleId = labelledBy ?? (title ? generatedTitleId : undefined)
    const shouldShowCloseButton = showCloseButton ?? Boolean(onClose)
    const shouldShowHeader = Boolean(title || (shouldShowCloseButton && onClose))

    return (
        <Overlay
            variant="floating"
            onClose={onClose}
            dismissible={dismissible}
            ariaLabel={titleId ? undefined : ariaLabel}
            labelledBy={titleId}
            {...props}
        >
            {shouldShowHeader && (
                <div className="fc-floating-panel__header">
                    {title && (
                        <div id={titleId} className="fc-floating-panel__title">
                            {title}
                        </div>
                    )}
                    {shouldShowCloseButton && onClose && (
                        <Button
                            type="button"
                            className="fc-floating-panel__close"
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label={closeLabel}
                            disabled={!dismissible}
                            onClick={onClose}
                        >
                            ×
                        </Button>
                    )}
                </div>
            )}
            {children}
        </Overlay>
    )
}
