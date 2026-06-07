import FloatingPanel from './FloatingPanel'
import './ActionMenu.css'

export interface ActionMenuItem {
    key: string
    label: string
    /** 破坏性操作（红色），如删除。 */
    danger?: boolean
    disabled?: boolean
    onSelect: () => void
}

export interface ActionMenuProps {
    open: boolean
    onClose: () => void
    /** 可选标题（如词条/项目名）。 */
    title?: string
    items: ActionMenuItem[]
    ariaLabel?: string
}

/**
 * 动作菜单：浮层里的一列操作项，用于卡片/详情的「⋯」入口。
 * 基于 FloatingPanel（居中浮层）。点项即关闭菜单再执行该项。
 */
export default function ActionMenu({open, onClose, title, items, ariaLabel}: ActionMenuProps) {
    return (
        <FloatingPanel
            open={open}
            onClose={onClose}
            ariaLabel={ariaLabel ?? title ?? '操作菜单'}
            className="fc-action-menu"
        >
            {title && <div className="fc-action-menu__title">{title}</div>}
            <div className="fc-action-menu__list">
                {items.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        className={`fc-action-menu__item${item.danger ? ' fc-action-menu__item--danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            // 先关菜单再执行：动作若打开下一个浮层不至于叠在菜单上。
                            onClose()
                            item.onSelect()
                        }}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </FloatingPanel>
    )
}
