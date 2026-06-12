import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {
    db_list_all_entry_types,
    db_list_tag_schemas,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import TagCreator from '../../../features/entries/components/TagCreator'
import {MobileBackIcon, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileProjectScopedPageParams} from '../usePageStack'
import './MobileTypeTagManager.css'

interface Props {
    pop: () => void
    params: MobileProjectScopedPageParams
}

function tagTypeLabel(type: string): string {
    if (type === 'number') return '数值'
    if (type === 'boolean') return '是/否'
    if (type === 'string') return '文本'
    return type
}

export default function MobileTagManager({pop, params}: Props) {
    const projectId = params.projectId

    const [allEntryTypes, setAllEntryTypes] = useState<EntryTypeView[]>([])
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [loading, setLoading] = useState(true)
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagSchema | null>(null)

    const reloadData = useCallback(async () => {
        const [types, tags] = await Promise.all([
            db_list_all_entry_types(projectId),
            db_list_tag_schemas(projectId),
        ])
        setAllEntryTypes(types)
        setTagSchemas(tags)
    }, [projectId])

    useEffect(() => {
        setLoading(true)
        reloadData()
            .catch(logger.error)
            .finally(() => setLoading(false))
    }, [reloadData])

    const openCreator = (tag: TagSchema | null = null) => {
        setEditingTag(tag)
        setCreatorOpen(true)
    }

    return (
        <div className="mobile-page mobile-type-tag">
            <div className="mobile-type-tag__topbar">
                <MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}
                />
                <div className="mobile-type-tag__heading">
                    <span className="mobile-type-tag__eyebrow">{loading ? '正在同步' : `${tagSchemas.length} 个标签`}</span>
                    <h2 className="mobile-type-tag__title">标签管理</h2>
                </div>
                <MobileTopActionPill
                    actions={[{
                        key: 'create',
                        label: '新建标签',
                        icon: '+',
                        kind: 'add',
                        onClick: () => openCreator(null),
                    }]}
                />
            </div>

            {loading ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : (
                <div className="mobile-type-tag__list">
                    {tagSchemas.length === 0 ? (
                        <div className="mobile-page__empty mobile-type-tag__empty">还没有标签定义</div>
                    ) : tagSchemas.map(schema => (
                        <button
                            type="button"
                            className="mobile-list-card"
                            key={schema.id}
                            onClick={() => openCreator(schema)}
                        >
                            <span className="mobile-list-card__row">
                                <span className="mobile-list-card__main">
                                    <span className="mobile-list-card__title">{schema.name}</span>
                                    {schema.description && (
                                        <span className="mobile-list-card__description">{schema.description}</span>
                                    )}
                                </span>
                                <span className="mobile-list-card__tag mobile-type-tag__value-tag">
                                    {tagTypeLabel(schema.type)}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            <TagCreator
                open={creatorOpen}
                projectId={projectId}
                entryTypes={allEntryTypes}
                initialTag={editingTag}
                existingNames={tagSchemas.filter(schema => schema.id !== editingTag?.id).map(schema => schema.name)}
                existingCount={tagSchemas.length}
                onClose={() => { setCreatorOpen(false); setEditingTag(null) }}
                onSaved={() => { setCreatorOpen(false); setEditingTag(null); void reloadData() }}
                onDeleted={() => { setCreatorOpen(false); setEditingTag(null); void reloadData() }}
            />
        </div>
    )
}
