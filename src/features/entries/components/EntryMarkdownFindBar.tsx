/**
 * 正文查找替换栏；匹配计算保持纯文本语义，选区与滚动由 EntryEditor 接管。
 */
import {forwardRef, useImperativeHandle, useMemo, useRef, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import {
    findMarkdownTextMatches,
    type MarkdownTextMatch,
} from './entryMarkdownSearch'

export interface EntryMarkdownFindBarRef {
    focusSearch: () => void
}

interface EntryMarkdownFindBarProps {
    value: string
    onSelect: (match: MarkdownTextMatch) => void
    onReplace: (match: MarkdownTextMatch, replacement: string) => void
    onReplaceAll: (matches: MarkdownTextMatch[], replacement: string) => void
    onClose: () => void
}

const EntryMarkdownFindBar = forwardRef<EntryMarkdownFindBarRef, EntryMarkdownFindBarProps>(
    function EntryMarkdownFindBar({value, onSelect, onReplace, onReplaceAll, onClose}, ref) {
        const searchInputRef = useRef<HTMLInputElement>(null)
        const [query, setQuery] = useState('')
        const [replacement, setReplacement] = useState('')
        const [activeIndex, setActiveIndex] = useState(0)
        const matches = useMemo(() => findMarkdownTextMatches(value, query), [query, value])
        const currentIndex = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1)

        useImperativeHandle(ref, () => ({
            focusSearch: () => {
                searchInputRef.current?.focus()
                searchInputRef.current?.select()
            },
        }), [])

        function handleQueryChange(nextQuery: string) {
            setQuery(nextQuery)
            setActiveIndex(0)
            const firstMatch = findMarkdownTextMatches(value, nextQuery)[0]
            if (firstMatch) onSelect(firstMatch)
        }

        function navigate(direction: -1 | 1) {
            if (!matches.length) return
            const nextIndex = (Math.max(currentIndex, 0) + direction + matches.length) % matches.length
            setActiveIndex(nextIndex)
            onSelect(matches[nextIndex])
        }

        function replaceCurrent() {
            if (currentIndex < 0) return
            onReplace(matches[currentIndex], replacement)
        }

        return (
            <div className="entry-editor-find-bar" role="search" aria-label="正文查找替换">
                <Input
                    ref={searchInputRef}
                    className="entry-editor-find-bar__input"
                    size="sm"
                    value={query}
                    autoFocus
                    allowClear
                    placeholder="查找正文"
                    aria-label="查找正文"
                    suffix={(
                        <span className="entry-editor-find-bar__count" aria-live="polite">
                            {currentIndex < 0 ? 0 : currentIndex + 1}/{matches.length}
                        </span>
                    )}
                    onValueChange={handleQueryChange}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault()
                            onClose()
                        } else if (event.key === 'Enter') {
                            event.preventDefault()
                            navigate(event.shiftKey ? -1 : 1)
                        }
                    }}
                />
                <div className="entry-editor-find-bar__navigation" role="group" aria-label="匹配项导航">
                    <Button type="button" variant="ghost" size="sm" disabled={!matches.length} onClick={() => navigate(-1)}>
                        上一个
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!matches.length} onClick={() => navigate(1)}>
                        下一个
                    </Button>
                </div>
                <Input
                    className="entry-editor-find-bar__input"
                    size="sm"
                    value={replacement}
                    placeholder="替换为"
                    aria-label="替换为"
                    onValueChange={setReplacement}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault()
                            onClose()
                        } else if (event.key === 'Enter') {
                            event.preventDefault()
                            replaceCurrent()
                        }
                    }}
                />
                <div className="entry-editor-find-bar__actions" role="group" aria-label="替换操作">
                    <Button type="button" variant="ghost" size="sm" disabled={currentIndex < 0} onClick={replaceCurrent}>
                        替换
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!matches.length}
                        onClick={() => onReplaceAll(matches, replacement)}
                    >
                        全部替换
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                        关闭
                    </Button>
                </div>
            </div>
        )
    },
)

export default EntryMarkdownFindBar
