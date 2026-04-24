import type {Category, EntryBrief} from '../../../api'
import type {EntryRelationDraft} from './EntryRelationCreator'
import './EntryRelationEditor.css'

interface EntryRelationViewerProps {
    categories: Category[]
    drafts: EntryRelationDraft[]
    entries: EntryBrief[]
    currentEntryTitle: string
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function getCategoryName(categories: Category[], categoryId?: string | null): string {
    if (!categoryId) return '未分类'
    return categories.find((category) => category.id === categoryId)?.name ?? '未分类'
}

function stripMarkdown(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function buildExcerpt(value?: string | null, maxLength = 120): string {
    const normalized = stripMarkdown(value ?? '')
    if (!normalized) return '暂无正文'
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function buildRelationLabel(draft: EntryRelationDraft): string {
    const content = draft.content || '关联'
    if (draft.direction === 'two_way') {
        return `互相${content}`
    }
    return content
}

export default function EntryRelationViewer({
                                                categories,
                                                drafts,
                                                entries,
                                                onOpenEntry,
                                            }: EntryRelationViewerProps) {
    return (
        <div className="entry-relation-editor">
            {drafts.length === 0 ? (
                <div className="entry-relation-editor__empty">
                    当前词条还没有结构化关系。
                </div>
            ) : (
                <div className="entry-relation-editor__list">
                    {drafts.map((draft, index) => {
                        const otherEntry = entries.find((entry) => entry.id === draft.otherEntryId)
                        const otherTitle = otherEntry?.title ?? '未命名词条'

                        return (
                            <button
                                key={draft.id ?? `draft-${index}`}
                                type="button"
                                className="entry-editor-link-card"
                                onClick={() => {
                                    if (!otherEntry) return
                                    onOpenEntry?.({id: otherEntry.id, title: otherEntry.title})
                                }}
                                disabled={!otherEntry}
                            >
                                <div className="entry-editor-link-card__content">
                                    <span className="entry-editor-link-card__title">{otherTitle}</span>
                                    <span className="entry-editor-link-card__meta">
                                        {otherEntry
                                            ? `${getCategoryName(categories, otherEntry.category_id)} · ${buildRelationLabel(draft)}`
                                            : '词条不存在或已被删除'}
                                    </span>
                                    {otherEntry?.summary ? (
                                        <span className="entry-editor-link-card__excerpt">
                                            {buildExcerpt(otherEntry.summary, 60)}
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
