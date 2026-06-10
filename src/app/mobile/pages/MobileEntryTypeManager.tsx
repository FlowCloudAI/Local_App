import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {
    db_list_all_entry_types,
    db_list_custom_entry_types,
    type CustomEntryType,
    type EntryTypeView,
} from '../../../api'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {MobileBackIcon, MobileTopActionPill} from '../components/MobileTopControls'
import './MobileTypeTagManager.css'

interface Props {
    pop: () => void
    params?: Record<string, unknown>
}

export default function MobileEntryTypeManager({pop, params}: Props) {
    const projectId = params?.projectId as string

    const [customTypes, setCustomTypes] = useState<CustomEntryType[]>([])
    const [allEntryTypes, setAllEntryTypes] = useState<EntryTypeView[]>([])
    const [loading, setLoading] = useState(true)
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [editingType, setEditingType] = useState<CustomEntryType | null>(null)

    const reloadTypes = useCallback(async () => {
        const [custom, all] = await Promise.all([
            db_list_custom_entry_types(projectId),
            db_list_all_entry_types(projectId),
        ])
        setCustomTypes(custom)
        setAllEntryTypes(all)
    }, [projectId])

    useEffect(() => {
        setLoading(true)
        reloadTypes()
            .catch(logger.error)
            .finally(() => setLoading(false))
    }, [reloadTypes])

    const openCreator = (type: CustomEntryType | null = null) => {
        setEditingType(type)
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
                    <span className="mobile-type-tag__eyebrow">{loading ? '正在同步' : `${customTypes.length} 个自定义类型`}</span>
                    <h2 className="mobile-type-tag__title">类型管理</h2>
                </div>
                <MobileTopActionPill
                    actions={[{
                        key: 'create',
                        label: '新建类型',
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
                    {customTypes.length === 0 ? (
                        <div className="mobile-page__empty mobile-type-tag__empty">还没有自定义类型（内置类型始终可用）</div>
                    ) : customTypes.map(type => (
                        <button
                            type="button"
                            className="mobile-list-card"
                            key={type.id}
                            onClick={() => openCreator(type)}
                        >
                            <span className="mobile-list-card__title mobile-type-tag__type-title">
                                <EntryTypeIcon entryType={{kind: 'custom', ...type}} className=""/> {type.name}
                            </span>
                            {type.description && <span className="mobile-list-card__description">{type.description}</span>}
                        </button>
                    ))}
                </div>
            )}

            <EntryTypeCreator
                open={creatorOpen}
                projectId={projectId}
                initialEntryType={editingType}
                existingNames={allEntryTypes
                    .filter(type => !(type.kind === 'custom' && type.id === editingType?.id))
                    .map(type => type.name)}
                onClose={() => { setCreatorOpen(false); setEditingType(null) }}
                onSaved={() => { setCreatorOpen(false); setEditingType(null); void reloadTypes() }}
                onDeleted={() => { setCreatorOpen(false); setEditingType(null); void reloadTypes() }}
            />
        </div>
    )
}
