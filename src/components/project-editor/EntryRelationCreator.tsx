import {Button, Select} from 'flowcloudai-ui'
import type {Category, EntryBrief} from '../../api'
import './EntryRelationEditor.css'

export type EntryRelationDraftDirection = 'outgoing' | 'incoming' | 'two_way'

export interface EntryRelationDraft {
    id?: string
    otherEntryId: string | null
    direction: EntryRelationDraftDirection
    content: string
}

interface EntryRelationCreatorProps {
    drafts: EntryRelationDraft[]
    entries: EntryBrief[]
    categories: Category[]
    disabled?: boolean
    currentEntryId: string
    onChange: (drafts: EntryRelationDraft[]) => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

const DIRECTION_OPTIONS = [
    {value: 'outgoing', label: '我指向对方'},
    {value: 'incoming', label: '对方指向我'},
    {value: 'two_way', label: '双向关系'},
] as const

function getCategoryName(categories: Category[], categoryId?: string | null): string {
    if (!categoryId) return '未分类'
    return categories.find((category) => category.id === categoryId)?.name ?? '未分类'
}

function createEmptyDraft(): EntryRelationDraft {
    return {
        otherEntryId: null,
        direction: 'outgoing',
        content: '',
    }
}

export default function EntryRelationCreator({
                                                 drafts,
                                                 entries,
                                                 categories,
                                                 disabled = false,
                                                 currentEntryId,
                                                 onChange,
                                                 onOpenEntry,
                                             }: EntryRelationCreatorProps) {
    const selectableEntries = entries.filter((entry) => entry.id !== currentEntryId)
    const entryOptions = selectableEntries.map((entry) => ({
        value: entry.id,
        label: entry.title,
    }))

    const handleDraftChange = (index: number, updater: (draft: EntryRelationDraft) => EntryRelationDraft) => {
        onChange(drafts.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft)))
    }

    const handleDraftRemove = (index: number) => {
        onChange(drafts.filter((_, draftIndex) => draftIndex !== index))
    }

    const handleDraftAdd = () => {
        onChange([...drafts, createEmptyDraft()])
    }

    return (
        <div className="entry-relation-editor">
            <div className="entry-relation-editor__header">
                <div>
                    <h3 className="entry-relation-editor__title">词条关系</h3>
                    <p className="entry-relation-editor__desc">维护结构化关系，独立于正文中的 `[[双链]]` 引用。</p>
                </div>
                <Button size="sm" variant="outline" disabled={disabled} onClick={handleDraftAdd}>
                    + 新增关系
                </Button>
            </div>

            {drafts.length === 0 ? (
                <div className="entry-relation-editor__empty">
                    当前词条还没有结构化关系，可手动补充“依赖 / 包含 / 并列 / 对立”等语义连接。
                </div>
            ) : (
                <div className="entry-relation-editor__list">
                    {drafts.map((draft, index) => {
                        const otherEntry = selectableEntries.find((entry) => entry.id === draft.otherEntryId)
                        const hasInvalidTarget = draft.otherEntryId === null

                        return (
                            <div key={draft.id ?? `draft-${index}`} className="entry-relation-editor__item">
                                <div className="entry-relation-editor__row">
                                    <div className="entry-relation-editor__field entry-relation-editor__field--entry">
                                        <label className="entry-relation-editor__label">关联词条</label>
                                        <Select
                                            className="entry-relation-editor__select"
                                            options={entryOptions}
                                            value={draft.otherEntryId ?? undefined}
                                            onChange={(value) => {
                                                handleDraftChange(index, (current) => ({
                                                    ...current,
                                                    otherEntryId: typeof value === 'string' ? value : null,
                                                }))
                                            }}
                                            placeholder="搜索并选择关联词条"
                                            searchable
                                        />
                                        <div className="entry-relation-editor__field-note">
                                            {otherEntry ? getCategoryName(categories, otherEntry.category_id) : '未选择词条'}
                                        </div>
                                    </div>

                                    <div
                                        className="entry-relation-editor__field entry-relation-editor__field--direction">
                                        <label className="entry-relation-editor__label">方向</label>
                                        <Select
                                            className="entry-relation-editor__select"
                                            options={DIRECTION_OPTIONS.map((option) => ({
                                                value: option.value,
                                                label: option.label
                                            }))}
                                            value={draft.direction}
                                            onChange={(value) => {
                                                if (value !== 'outgoing' && value !== 'incoming' && value !== 'two_way') return
                                                handleDraftChange(index, (current) => ({
                                                    ...current,
                                                    direction: value,
                                                }))
                                            }}
                                            placeholder="选择关系方向"
                                        />
                                    </div>
                                </div>

                                <div className="entry-relation-editor__row">
                                    <div className="entry-relation-editor__field entry-relation-editor__field--content">
                                        <label className="entry-relation-editor__label">关系说明</label>
                                        <input
                                            className="entry-relation-editor__input"
                                            type="text"
                                            value={draft.content}
                                            onChange={(event) => {
                                                const value = event.currentTarget.value
                                                handleDraftChange(index, (current) => ({
                                                    ...current,
                                                    content: value,
                                                }))
                                            }}
                                            placeholder="例如：依赖、引用、属于、对立、协作"
                                            disabled={disabled}
                                        />
                                    </div>

                                    <div className="entry-relation-editor__actions">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={!otherEntry}
                                            onClick={() => {
                                                if (!otherEntry) return
                                                onOpenEntry?.({id: otherEntry.id, title: otherEntry.title})
                                            }}
                                        >
                                            打开词条
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={disabled}
                                            onClick={() => handleDraftRemove(index)}
                                        >
                                            删除
                                        </Button>
                                    </div>
                                </div>

                                {hasInvalidTarget && (
                                    <div className="entry-relation-editor__error">
                                        这条关系还没有选择目标词条，当前不能保存。
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
