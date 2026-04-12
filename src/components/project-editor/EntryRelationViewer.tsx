import type {Category, EntryBrief} from '../../api'
import type {EntryRelationDraft} from './EntryRelationCreator'
import './EntryRelationEditor.css'

interface EntryRelationViewerProps {
    categories: Category[]
    drafts: EntryRelationDraft[]
    entries: EntryBrief[]
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function getCategoryName(categories: Category[], categoryId?: string | null): string {
    if (!categoryId) return '未分类'
    return categories.find((category) => category.id === categoryId)?.name ?? '未分类'
}

function getDirectionLabel(direction: EntryRelationDraft['direction']): string {
    if (direction === 'incoming') return '对方指向我'
    if (direction === 'two_way') return '双向关系'
    return '我指向对方'
}

export default function EntryRelationViewer({
                                                categories,
                                                drafts,
                                                entries,
                                                onOpenEntry,
                                            }: EntryRelationViewerProps) {
    return (
        <div className="entry-relation-editor">
            <div className="entry-relation-editor__header">
                <div>
                    <h3 className="entry-relation-editor__title">词条关系</h3>
                    <p className="entry-relation-editor__desc">这里展示当前词条的结构化关系，不包含正文自动解析出的引用链接。</p>
                </div>
                <div className="entry-relation-editor__count">{drafts.length} 条</div>
            </div>

            {drafts.length === 0 ? (
                <div className="entry-relation-editor__empty">
                    当前词条还没有结构化关系。
                </div>
            ) : (
                <div className="entry-relation-editor__list">
                    {drafts.map((draft, index) => {
                        const otherEntry = entries.find((entry) => entry.id === draft.otherEntryId)
                        const title = otherEntry?.title ?? '未命名词条'
                        const meta = otherEntry ? getCategoryName(categories, otherEntry.category_id) : '词条不存在或已被删除'

                        return (
                            <button
                                key={draft.id ?? `draft-${index}`}
                                type="button"
                                className="entry-relation-editor__viewer-item"
                                onClick={() => {
                                    if (!otherEntry) return
                                    onOpenEntry?.({id: otherEntry.id, title: otherEntry.title})
                                }}
                                disabled={!otherEntry}
                            >
                                <div className="entry-relation-editor__viewer-main">
                                    <span className="entry-relation-editor__viewer-title">{title}</span>
                                    <span
                                        className="entry-relation-editor__viewer-badge">{getDirectionLabel(draft.direction)}</span>
                                </div>
                                <div className="entry-relation-editor__viewer-meta">{meta}</div>
                                <div
                                    className="entry-relation-editor__viewer-content">{draft.content || '未填写关系说明'}</div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
