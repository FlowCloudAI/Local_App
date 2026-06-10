import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {
    db_list_all_entry_types,
    db_list_custom_entry_types,
    db_list_tag_schemas,
    type CustomEntryType,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import TagCreator from '../../../features/entries/components/TagCreator'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import './MobileTypeTagManager.css'

interface Props {
    params?: Record<string, unknown>
}

function tagTypeLabel(type: string): string {
    if (type === 'number') return '数值'
    if (type === 'boolean') return '是/否'
    if (type === 'string') return '文本'
    return type
}

/**
 * 项目级「类型与标签」管理：自定义词条类型 + 标签定义的增/改/删。
 * 内置类型始终可用，不在此管理。复用桌面 EntryTypeCreator / TagCreator（增改删一体）。
 */
export default function MobileTypeTagManager({params}: Props) {
    const projectId = params?.projectId as string
    const initialSection = params?.section === 'tags' ? 'tags' : 'types'
    const typeSectionRef = useRef<HTMLDivElement | null>(null)
    const tagSectionRef = useRef<HTMLDivElement | null>(null)

    const [customTypes, setCustomTypes] = useState<CustomEntryType[]>([])
    const [allEntryTypes, setAllEntryTypes] = useState<EntryTypeView[]>([])
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [loading, setLoading] = useState(true)

    const [typeCreatorOpen, setTypeCreatorOpen] = useState(false)
    const [editingType, setEditingType] = useState<CustomEntryType | null>(null)
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagSchema | null>(null)

    const reloadTypes = useCallback(async () => {
        const [custom, all] = await Promise.all([
            db_list_custom_entry_types(projectId),
            db_list_all_entry_types(projectId),
        ])
        setCustomTypes(custom)
        setAllEntryTypes(all)
    }, [projectId])

    const reloadTags = useCallback(async () => {
        setTagSchemas(await db_list_tag_schemas(projectId))
    }, [projectId])

    useEffect(() => {
        setLoading(true)
        Promise.all([reloadTypes(), reloadTags()])
            .catch(logger.error)
            .finally(() => setLoading(false))
    }, [reloadTypes, reloadTags])

    useEffect(() => {
        if (loading) return
        const target = initialSection === 'tags' ? tagSectionRef.current : typeSectionRef.current
        if (!target) return
        const frame = window.requestAnimationFrame(() => {
            target.scrollIntoView({block: 'start'})
        })
        return () => window.cancelAnimationFrame(frame)
    }, [initialSection, loading])

    if (loading) return <div className="mobile-page__loading">加载中…</div>

    return (
        <div className="mobile-page mobile-type-tag">
            {/* 自定义类型 */}
            <div className="mobile-type-tag__section-head" ref={typeSectionRef}>
                <h3 className="mobile-type-tag__section-title">自定义类型（{customTypes.length}）</h3>
                <Button type="button" size="sm" onClick={() => { setEditingType(null); setTypeCreatorOpen(true) }}>
                    + 新建类型
                </Button>
            </div>
            <div className="mobile-type-tag__list">
                {customTypes.length === 0 ? (
                    <div className="mobile-page__empty mobile-type-tag__empty">还没有自定义类型（内置类型始终可用）</div>
                ) : customTypes.map(t => (
                    <button
                        type="button"
                        className="mobile-list-card"
                        key={t.id}
                        onClick={() => { setEditingType(t); setTypeCreatorOpen(true) }}
                    >
                        <span className="mobile-list-card__title mobile-type-tag__type-title">
                            <EntryTypeIcon entryType={{kind: 'custom', ...t}} className=""/> {t.name}
                        </span>
                        {t.description && <span className="mobile-list-card__description">{t.description}</span>}
                    </button>
                ))}
            </div>

            {/* 标签 */}
            <div className="mobile-type-tag__section-head mobile-type-tag__section-head--gap" ref={tagSectionRef}>
                <h3 className="mobile-type-tag__section-title">标签（{tagSchemas.length}）</h3>
                <Button type="button" size="sm" onClick={() => { setEditingTag(null); setTagCreatorOpen(true) }}>
                    + 新建标签
                </Button>
            </div>
            <div className="mobile-type-tag__list">
                {tagSchemas.length === 0 ? (
                    <div className="mobile-page__empty mobile-type-tag__empty">还没有标签定义</div>
                ) : tagSchemas.map(s => (
                    <button
                        type="button"
                        className="mobile-list-card"
                        key={s.id}
                        onClick={() => { setEditingTag(s); setTagCreatorOpen(true) }}
                    >
                        <span className="mobile-list-card__title">{s.name}</span>
                        <span className="mobile-list-card__description">
                            {tagTypeLabel(s.type)}{s.description ? ` · ${s.description}` : ''}
                        </span>
                    </button>
                ))}
            </div>

            <EntryTypeCreator
                open={typeCreatorOpen}
                projectId={projectId}
                initialEntryType={editingType}
                existingNames={allEntryTypes
                    .filter(t => !(t.kind === 'custom' && t.id === editingType?.id))
                    .map(t => t.name)}
                onClose={() => { setTypeCreatorOpen(false); setEditingType(null) }}
                onSaved={() => { setTypeCreatorOpen(false); setEditingType(null); void reloadTypes() }}
                onDeleted={() => { setTypeCreatorOpen(false); setEditingType(null); void reloadTypes() }}
            />
            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={allEntryTypes}
                initialTag={editingTag}
                existingNames={tagSchemas.filter(s => s.id !== editingTag?.id).map(s => s.name)}
                existingCount={tagSchemas.length}
                onClose={() => { setTagCreatorOpen(false); setEditingTag(null) }}
                onSaved={() => { setTagCreatorOpen(false); setEditingTag(null); void reloadTags() }}
                onDeleted={() => { setTagCreatorOpen(false); setEditingTag(null); void reloadTags() }}
            />
        </div>
    )
}
