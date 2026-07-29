/**
 * 正文大纲浮层；负责标题层级展示，定位行为由 EntryEditor 统一处理。
 */
import {useEffect, useRef} from 'react'
import {Button} from 'flowcloudai-ui'
import type {MarkdownOutlineItem} from './entryMarkdownOutlineUtils'

interface EntryMarkdownOutlineProps {
    items: MarkdownOutlineItem[]
    onSelect: (item: MarkdownOutlineItem) => void
    onClose: () => void
}

export default function EntryMarkdownOutline({items, onSelect, onClose}: EntryMarkdownOutlineProps) {
    const panelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        panelRef.current?.focus()
    }, [])

    return (
        <div
            ref={panelRef}
            className="entry-editor-outline"
            role="dialog"
            aria-label="正文大纲"
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                onClose()
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) onClose()
            }}
        >
            <div className="entry-editor-outline__header">
                <strong>正文大纲</strong>
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                    关闭
                </Button>
            </div>
            <div className="entry-editor-outline__list">
                {items.length ? items.map((item) => (
                    <Button
                        key={item.start}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`entry-editor-outline__item is-level-${item.level}`}
                        title={item.title}
                        onClick={() => onSelect(item)}
                    >
                        {item.title}
                    </Button>
                )) : (
                    <p className="entry-editor-outline__empty">暂无 H1–H3 标题</p>
                )}
            </div>
        </div>
    )
}
