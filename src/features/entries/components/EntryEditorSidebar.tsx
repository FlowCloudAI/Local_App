import {useState} from 'react'
import {RollingBox} from 'flowcloudai-ui'
import type {Category, Entry, EntryBrief, EntryLink} from '../../../api'
import {buildExcerpt, formatDate, getCategoryName} from '../lib/entryCommon'
import EntryRelationCreator, {type EntryRelationDraft} from '../../project-editor/components/EntryRelationCreator'
import EntryRelationViewer from '../../project-editor/components/EntryRelationViewer'

interface EntryEditorSidebarProps {
    entryId: string
    entry: Entry | null
    editorMode: 'edit' | 'browse'
    saving: boolean
    projectDataLoading: boolean
    relationDrafts: EntryRelationDraft[]
    outgoingLinks: EntryLink[]
    backlinks: (EntryBrief & { content?: string | null })[]
    projectEntries: EntryBrief[]
    entryDetailsById: Record<string, Entry>
    categories: Category[]
    onOpenEntry?: (entry: { id: string; title: string }) => void
    onRelationDraftsChange: (drafts: EntryRelationDraft[]) => void
}

export default function EntryEditorSidebar({
                                               entryId,
                                               entry,
                                               editorMode,
                                               saving,
                                               projectDataLoading,
                                               relationDrafts,
                                               outgoingLinks,
                                               backlinks,
                                               projectEntries,
                                               entryDetailsById,
                                               categories,
                                               onOpenEntry,
                                               onRelationDraftsChange,
                                           }: EntryEditorSidebarProps) {
    const isBrowseMode = editorMode === 'browse'
    const [relationsExpanded, setRelationsExpanded] = useState(false)
    const [outgoingLinksExpanded, setOutgoingLinksExpanded] = useState(false)
    const [backlinksExpanded, setBacklinksExpanded] = useState(false)

    return (
        <>
            <section className={`entry-editor-relations ${relationsExpanded ? 'is-expanded' : ''}`}>
                <button
                    type="button"
                    className="entry-editor-relations__toggle"
                    onClick={() => setRelationsExpanded((current) => !current)}
                >
                    <svg className="entry-editor-toggle__arrow" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>词条关系</span>
                    <span className="entry-editor-relations__count">{relationDrafts.length}</span>
                </button>

                {relationsExpanded && (
                    <RollingBox axis="y" className="entry-editor-relations__body" thumbSize="thin">
                        {isBrowseMode ? (
                            <EntryRelationViewer
                                drafts={relationDrafts}
                                entries={projectEntries}
                                categories={categories}
                                currentEntryTitle={entry?.title ?? '本词条'}
                                onOpenEntry={onOpenEntry}
                            />
                        ) : (
                            <EntryRelationCreator
                                drafts={relationDrafts}
                                entries={projectEntries}
                                categories={categories}
                                currentEntryId={entryId}
                                disabled={saving || projectDataLoading}
                                onChange={onRelationDraftsChange}
                                onOpenEntry={onOpenEntry}
                            />
                        )}
                    </RollingBox>
                )}
            </section>

            <section className={`entry-editor-outgoing-links ${outgoingLinksExpanded ? 'is-expanded' : ''}`}>
                <button
                    type="button"
                    className="entry-editor-outgoing-links__toggle"
                    onClick={() => setOutgoingLinksExpanded((current) => !current)}
                >
                    <svg className="entry-editor-toggle__arrow" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>正向链接</span>
                    <span className="entry-editor-outgoing-links__count">{outgoingLinks.length}</span>
                </button>

                {outgoingLinksExpanded && (
                    <RollingBox axis="y" className="entry-editor-outgoing-links__body" thumbSize="thin">
                        {outgoingLinks.length === 0 ? (
                            <div className="entry-editor-empty-tip">
                                当前词条正文还没有通过 [[ ]] 引用其他词条。
                            </div>
                        ) : (
                            <div className="entry-editor-outgoing-links__list">
                                {outgoingLinks.map((link) => {
                                    const target = entryDetailsById[link.b_id] ?? projectEntries.find((item) => item.id === link.b_id)
                                    return (
                                        <button
                                            key={link.id}
                                            type="button"
                                            className="entry-editor-link-card"
                                            onClick={() => onOpenEntry?.({
                                                id: link.b_id,
                                                title: target?.title ?? '未命名词条'
                                            })}
                                        >
                                            <div className="entry-editor-link-card__content">
                                            <span
                                                className="entry-editor-link-card__title">{target?.title ?? '未命名词条'}</span>
                                                <span className="entry-editor-link-card__meta">
                                                {target ? getCategoryName(categories, target.category_id) : ''}
                                            </span>
                                                {target?.summary ? (
                                                    <span
                                                        className="entry-editor-link-card__excerpt">{buildExcerpt(target.summary, 60)}</span>
                                                ) : null}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </RollingBox>
                )}
            </section>

            <section className={`entry-editor-backlinks ${backlinksExpanded ? 'is-expanded' : ''}`}>
                <button
                    type="button"
                    className="entry-editor-backlinks__toggle"
                    onClick={() => setBacklinksExpanded((current) => !current)}
                >
                    <svg className="entry-editor-toggle__arrow" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>反向链接</span>
                    <span className="entry-editor-backlinks__count">{backlinks.length}</span>
                </button>

                {backlinksExpanded && (
                    <RollingBox axis="y" className="entry-editor-backlinks__body" thumbSize="thin">
                        {backlinks.length === 0 ? (
                            <div className="entry-editor-empty-tip">
                                目前还没有其他词条通过 [[ ]] 引用它。
                            </div>
                        ) : (
                            <div className="entry-editor-backlinks__list">
                                {backlinks.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="entry-editor-link-card"
                                        onClick={() => onOpenEntry?.({id: item.id, title: item.title})}
                                    >
                                        <div className="entry-editor-link-card__content">
                                            <span className="entry-editor-link-card__title">{item.title}</span>
                                            <span className="entry-editor-link-card__meta">
                                            {getCategoryName(categories, item.category_id)} · {formatDate(item.updated_at as string | null | undefined)}
                                        </span>
                                            <span
                                                className="entry-editor-link-card__excerpt">{buildExcerpt(item.content as string | null | undefined, 60)}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </RollingBox>
                )}
            </section>
        </>
    )
}
