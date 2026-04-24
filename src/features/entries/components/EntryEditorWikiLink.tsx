import type {RefObject} from 'react'
import type {Category} from '../../../api'
import {getCategoryName} from '../lib/entryCommon'

type WikiLinkOption =
    | { kind: 'entry'; id: string; title: string; categoryId: string | null }
    | { kind: 'create'; title: string }

interface EntryEditorWikiLinkProps {
    wikiDraft: { start: number; end: number; query: string } | null
    wikiPopoverPosition: { top: number; left: number }
    wikiLinkOptions: WikiLinkOption[]
    activeWikiOptionIndex: number
    creatingLinkedEntry: boolean
    hasExactCategorySuggestion: boolean
    categories: Category[]
    popoverRef: RefObject<HTMLDivElement | null>
    optionRefs: RefObject<Record<number, HTMLButtonElement | null>>
    onOptionCommit: (option: WikiLinkOption) => void
    onActiveIndexChange: (index: number) => void
}

export default function EntryEditorWikiLink({
                                                wikiDraft,
                                                wikiPopoverPosition,
                                                wikiLinkOptions,
                                                activeWikiOptionIndex,
                                                creatingLinkedEntry,
                                                hasExactCategorySuggestion,
                                                categories,
                                                popoverRef,
                                                optionRefs,
                                                onOptionCommit,
                                                onActiveIndexChange,
                                            }: EntryEditorWikiLinkProps) {
    if (!wikiDraft) return null

    return (
        <div
            ref={popoverRef}
            className="entry-editor-wikilink-popover"
            style={{
                top: `${wikiPopoverPosition.top}px`,
                left: `${wikiPopoverPosition.left}px`,
            }}
        >
            <div className="entry-editor-wikilink-popover__header">
                <span>插入双链</span>
                <span className="entry-editor-wikilink-popover__query">
                    {wikiDraft.query || '继续输入词条名…'}
                </span>
            </div>

            <div className="entry-editor-wikilink-popover__list">
                {wikiLinkOptions.map((option, optionIndex) => (
                    option.kind === 'entry' ? (
                        <button
                            key={option.id}
                            type="button"
                            className={`entry-editor-wikilink-option${optionIndex === activeWikiOptionIndex ? ' is-active' : ''}`}
                            ref={(element) => {
                                optionRefs.current[optionIndex] = element
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => onActiveIndexChange(optionIndex)}
                            onClick={() => onOptionCommit(option)}
                        >
                            <span className="entry-editor-wikilink-option__title">{option.title}</span>
                            <span className="entry-editor-wikilink-option__meta">
                                {getCategoryName(categories, option.categoryId)}
                            </span>
                        </button>
                    ) : (
                        <button
                            key={`create-${option.title}`}
                            type="button"
                            className={`entry-editor-wikilink-option is-create${optionIndex === activeWikiOptionIndex ? ' is-active' : ''}`}
                            ref={(element) => {
                                optionRefs.current[optionIndex] = element
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => onActiveIndexChange(optionIndex)}
                            onClick={() => onOptionCommit(option)}
                            disabled={creatingLinkedEntry}
                        >
                            <span className="entry-editor-wikilink-option__title">
                                {creatingLinkedEntry ? '创建中…' : `创建新词条：${option.title}`}
                            </span>
                            <span className="entry-editor-wikilink-option__meta">
                                创建后会立即插入双链
                            </span>
                        </button>
                    )
                ))}

                {!wikiLinkOptions.length && (hasExactCategorySuggestion || !wikiDraft.query.trim()) && (
                    <div className="entry-editor-wikilink-empty">
                        {wikiDraft.query.trim() ? '没有更多匹配项' : '继续输入词条名以搜索'}
                    </div>
                )}
            </div>
        </div>
    )
}
