import {useState} from 'react'
import {Button, RollingBox, useAlert} from 'flowcloudai-ui'
import type {Category, Entry, EntryBrief, EntryLink} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {buildExcerpt, formatDate, getCategoryName} from '../lib/entryCommon'
import {
    EntryRelationDraftForm,
    type EntryRelationDraft,
} from '../../project-editor/components/EntryRelationCreator'
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

type RelationPanelState =
    | { mode: 'create'; draft: EntryRelationDraft }
    | { mode: 'edit'; index: number; draft: EntryRelationDraft }

function buildRelationLabel(draft: EntryRelationDraft): string {
    const content = draft.content.trim() || '关联'
    if (draft.direction === 'two_way') return `双向 · ${content}`
    if (draft.direction === 'incoming') return `对方指向我 · ${content}`
    return `我指向对方 · ${content}`
}

function createEmptyRelationDraft(): EntryRelationDraft {
    return {
        otherEntryId: null,
        direction: 'outgoing',
        content: '',
    }
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
    const {showAlert} = useAlert()
    const [relationsExpanded, setRelationsExpanded] = useState(false)
    const [outgoingLinksExpanded, setOutgoingLinksExpanded] = useState(false)
    const [backlinksExpanded, setBacklinksExpanded] = useState(false)
    const [relationPanel, setRelationPanel] = useState<RelationPanelState | null>(null)
    const relationPanelDisabled = saving || projectDataLoading
    const relationPanelCanSave = Boolean(relationPanel?.draft.otherEntryId) && !relationPanelDisabled

    const openCreateRelationPanel = () => {
        setRelationsExpanded(true)
        setRelationPanel({
            mode: 'create',
            draft: createEmptyRelationDraft(),
        })
    }

    const openEditRelationPanel = (index: number) => {
        const draft = relationDrafts[index]
        if (!draft) return
        setRelationsExpanded(true)
        setRelationPanel({
            mode: 'edit',
            index,
            draft: {...draft},
        })
    }

    const closeRelationPanel = () => setRelationPanel(null)

    const updateRelationPanelDraft = (draft: EntryRelationDraft) => {
        setRelationPanel((current) => current ? {...current, draft} : current)
    }

    const saveRelationPanel = () => {
        if (!relationPanel || !relationPanelCanSave) return
        if (relationPanel.mode === 'create') {
            onRelationDraftsChange([...relationDrafts, relationPanel.draft])
        } else {
            onRelationDraftsChange(relationDrafts.map((draft, index) => (
                index === relationPanel.index ? relationPanel.draft : draft
            )))
        }
        closeRelationPanel()
    }

    const deleteRelationFromPanel = async () => {
        if (!relationPanel || relationPanel.mode !== 'edit' || relationPanelDisabled) return
        const otherEntry = projectEntries.find((item) => item.id === relationPanel.draft.otherEntryId)
        const title = otherEntry?.title ?? '未选择词条'
        const confirmed = await showAlert(`确定要删除与「${title}」的关系吗？`, 'warning', 'confirm')
        if (confirmed !== 'yes') return
        onRelationDraftsChange(relationDrafts.filter((_, index) => index !== relationPanel.index))
        closeRelationPanel()
    }

    return (
        <>
            <section className={`entry-editor-relations ${relationsExpanded ? 'is-expanded' : ''}`}>
                <div className="entry-editor-relations__header">
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
                    {!isBrowseMode && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="entry-editor-relations__add"
                            disabled={relationPanelDisabled}
                            onClick={openCreateRelationPanel}
                        >
                            + 添加
                        </Button>
                    )}
                </div>

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
                            relationDrafts.length === 0 ? (
                                <div className="entry-editor-empty-tip">
                                    当前词条还没有结构化关系，可手动补充“依赖 / 包含 / 并列 / 对立”等语义连接。
                                </div>
                            ) : (
                                <div className="entry-editor-relations__list">
                                    {relationDrafts.map((draft, index) => {
                                        const otherEntry = projectEntries.find((item) => item.id === draft.otherEntryId)
                                        const title = otherEntry?.title ?? '未选择词条'
                                        return (
                                            <article key={draft.id ?? `draft-${index}`}
                                                     className="entry-editor-relation-card">
                                                <button
                                                    type="button"
                                                    className="entry-editor-relation-card__main"
                                                    disabled={!otherEntry}
                                                    onClick={() => {
                                                        if (!otherEntry) return
                                                        onOpenEntry?.({id: otherEntry.id, title: otherEntry.title})
                                                    }}
                                                >
                                                    <span className="entry-editor-relation-card__title">{title}</span>
                                                    <span className="entry-editor-relation-card__meta">
                                                        {otherEntry
                                                            ? `${getCategoryName(categories, otherEntry.category_id)} · ${buildRelationLabel(draft)}`
                                                            : '词条不存在或已被删除'}
                                                    </span>
                                                    {otherEntry?.summary ? (
                                                        <span className="entry-editor-relation-card__excerpt">
                                                            {buildExcerpt(otherEntry.summary, 60)}
                                                        </span>
                                                    ) : null}
                                                </button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => openEditRelationPanel(index)}
                                                >
                                                    编辑
                                                </Button>
                                            </article>
                                        )
                                    })}
                                </div>
                            )
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

            <FloatingPanel
                open={Boolean(relationPanel)}
                onClose={closeRelationPanel}
                dismissible
                ariaLabel={relationPanel?.mode === 'edit' ? '编辑词条关系' : '新增词条关系'}
                className="entry-relation-panel"
            >
                {relationPanel && (
                    <>
                        <div className="entry-relation-panel__header">
                            <span className="entry-relation-panel__title">
                                {relationPanel.mode === 'edit' ? '编辑词条关系' : '新增词条关系'}
                            </span>
                            <button
                                type="button"
                                className="entry-relation-panel__close app-dialog-close"
                                onClick={closeRelationPanel}
                                aria-label="关闭"
                            >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75"
                                          strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div className="entry-relation-panel__body">
                            <EntryRelationDraftForm
                                draft={relationPanel.draft}
                                entries={projectEntries}
                                categories={categories}
                                currentEntryId={entryId}
                                disabled={relationPanelDisabled}
                                onChange={updateRelationPanelDraft}
                                onOpenEntry={onOpenEntry}
                            />
                        </div>
                        <div className="entry-relation-panel__footer">
                            {relationPanel.mode === 'edit' && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={relationPanelDisabled}
                                    onClick={() => void deleteRelationFromPanel()}
                                >
                                    删除
                                </Button>
                            )}
                            <span className="entry-relation-panel__spacer"/>
                            <Button type="button" size="sm" variant="ghost" onClick={closeRelationPanel}>
                                取消
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={!relationPanelCanSave}
                                onClick={saveRelationPanel}
                            >
                                保存
                            </Button>
                        </div>
                    </>
                )}
            </FloatingPanel>
        </>
    )
}
