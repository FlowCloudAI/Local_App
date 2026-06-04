import {type ReactNode} from 'react'
import Overlay from './Overlay'

export interface FloatingPanelProps {
    open: boolean
    onClose?: () => void
    dismissible?: boolean
    className?: string
    ariaLabel?: string
    labelledBy?: string
    children?: ReactNode
}

/**
 * 浮动面板：四边不挨屏、居中、点背板可关闭。基于 Overlay。
 * 卡片外观由调用方子内容自带（或通过 className 提供）。
 */
export default function FloatingPanel(props: FloatingPanelProps) {
    return <Overlay variant="floating" {...props} />
}
