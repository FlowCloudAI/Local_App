import {logger} from '../../../shared/logger'
import MarkdownPreview from '@uiw/react-markdown-preview'
import {type CSSProperties, useCallback, useEffect, useState} from 'react'
import {Button, Input, Select, TagItem, useAlert, useTheme} from 'flowcloudai-ui'
import {
    type Category,
    type CustomEntryType,
    db_get_entry,
    db_delete_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_list_tag_schemas,
    db_update_entry,
    type Entry,
    type EntryTag,
    type EntryTypeView,
    entryTypeKey,
    type TagSchema,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {ActionMenu} from '../../../shared/ui/overlay'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {buildTagValueMap} from '../../../features/entries/lib/entryCommon'
import {
    areTagMapsEqual,
    getComparableTagValue,
    isSchemaImplantedForType,
    normalizeComparableTagValue,
    normalizeTagTargets,
} from '../../../features/entries/lib/entryTag'
import './MobileEntryDetail.css'

interface Props {
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeBack: (handler: (() => boolean | Promise<boolean>) | null) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

type Mode = 'view' | 'edit'
type TagValueMap = Record<string, string | number | boolean | null>

/** 把词条已有标签（EntryTag[]）按 schema.id 摊平成可编辑的值表。 */
function buildTagDraft(e: Entry, schemas: TagSchema[]): TagValueMap {
    const map = buildTagValueMap(e)
    return Object.fromEntries(schemas.map(s => [s.id, getComparableTagValue(map, s)]))
}

/** 该 schema 是否适用于此词条类型：target 为空（通用）或包含该类型。 */
function isTagSchemaApplicable(s: TagSchema, entryType: string | null | undefined): boolean {
    return normalizeTagTargets(s.target).length === 0 || isSchemaImplantedForType(s, entryType ?? null)
}

/**
 * 词条页：查看 / 编辑同屏（mode 切换），避免「详情 → 编辑」再多压一级。
 * params.mode === 'edit' 时（如新建词条后）直接进入编辑态。
 */
export default function MobileEntryDetail({pop, replace, navigateToTab, setBeforeBack, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const entryId = params?.entryId as string
    const {showAlert} = useAlert()
    const {theme} = useTheme()

    const [entry, setEntry] = useState<Entry | null>(null)
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [mode, setMode] = useState<Mode>(params?.mode === 'edit' ? 'edit' : 'view')

    // 编辑表单字段
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [summary, setSummary] = useState('')
    const [entryType, setEntryType] = useState<string | null>(null)
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [typeCreatorOpen, setTypeCreatorOpen] = useState(false)
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [tagDraft, setTagDraft] = useState<TagValueMap>({})

    // wrapperElement 的 data-color-mode 只接受 "light" | "dark"，不接受 "auto"
    const colorMode: 'light' | 'dark' = theme === 'dark'
        ? 'dark'
        : theme === 'light'
            ? 'light'
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    const syncForm = useCallback((e: Entry, schemas: TagSchema[]) => {
        setTitle(e.title)
        setContent(e.content ?? '')
        setSummary(e.summary ?? '')
        setEntryType(e.type ?? null)
        setCategoryId(e.category_id ?? null)
        setTagDraft(buildTagDraft(e, schemas))
    }, [])

    const isDirty = mode === 'edit' && !!entry && (
        title !== entry.title
        || content !== (entry.content ?? '')
        || summary !== (entry.summary ?? '')
        || entryType !== (entry.type ?? null)
        || categoryId !== (entry.category_id ?? null)
        || !areTagMapsEqual(tagDraft, buildTagValueMap(entry), tagSchemas)
    )

    useEffect(() => {
        if (!entryId) return
        setLoading(true)
        Promise.all([
            db_get_entry(entryId),
            db_list_all_entry_types(projectId),
            db_list_categories(projectId),
            db_list_tag_schemas(projectId),
        ]).then(([e, types, cats, schemas]) => {
            setEntry(e)
            setEntryTypes(types)
            setCategories(cats)
            setTagSchemas(schemas)
            syncForm(e, schemas)
        }).catch(logger.error).finally(() => setLoading(false))
    }, [entryId, projectId, syncForm])

    const enterEdit = useCallback(() => {
        if (entry) syncForm(entry, tagSchemas)
        setMode('edit')
    }, [entry, syncForm, tagSchemas])

    const confirmDiscard = useCallback(async () => {
        if (!isDirty) return true
        const result = await showAlert('未保存的更改将丢失，是否继续？', 'warning', 'confirm')
        return result === 'yes'
    }, [isDirty, showAlert])

    useEffect(() => {
        if (mode !== 'edit') {
            setBeforeBack(null)
            return
        }
        setBeforeBack(confirmDiscard)
        return () => setBeforeBack(null)
    }, [confirmDiscard, mode, setBeforeBack])

    // 取消：已有可回退的查看态则回查看；否则（极端情况无 entry）回退页面。
    const handleCancel = useCallback(async () => {
        if (!await confirmDiscard()) return
        if (entry) {
            syncForm(entry, tagSchemas)
            setMode('view')
        } else {
            pop()
        }
    }, [confirmDiscard, entry, pop, syncForm, tagSchemas])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            await showAlert('请输入词条标题', 'warning', 'toast', 2000)
            return
        }
        setSaving(true)
        const tags: EntryTag[] = tagSchemas
            .map<EntryTag | null>(s => {
                const v = tagDraft[s.id]
                return v == null || v === '' ? null : {schema_id: s.id, name: s.name, value: v}
            })
            .filter((t): t is EntryTag => t !== null)
        try {
            await db_update_entry({
                id: entryId,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                categoryId: categoryId || null,
                tags,
            })
            setEntry(prev => prev ? {
                ...prev,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                category_id: categoryId || null,
                tags,
            } : prev)
            setAiFocus({projectId, entryId})
            // 同步页面标题（顶部标题取自 params.displayName）。
            replace({type: 'entryDetail', params: {...(params ?? {}), projectId, entryId, displayName: title.trim(), mode: 'view'}})
            setMode('view')
        } catch (e) {
            await showAlert(`保存失败：${String(e)}`, 'error', 'toast', 3000)
        } finally {
            setSaving(false)
        }
    }, [title, content, summary, entryType, categoryId, tagSchemas, tagDraft, entryId, projectId, params, replace, setAiFocus, showAlert])

    const handleDelete = useCallback(async () => {
        const result = await showAlert(`确定删除词条「${entry?.title ?? ''}」？此操作不可撤销。`, 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await db_delete_entry(entryId)
            pop()
        } catch (e) {
            await showAlert(`删除失败：${String(e)}`, 'error', 'toast', 3000)
        }
    }, [entry, entryId, pop, showAlert])

    const handleTypeCreated = useCallback(async (created: CustomEntryType) => {
        try {
            setEntryTypes(await db_list_all_entry_types(projectId))
        } catch (e) {
            logger.error('刷新词条类型失败', e)
        }
        setEntryType(created.id)
    }, [projectId])

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!entry) return <div className="mobile-page__error">词条不存在</div>

    // ---------- 编辑态 ----------
    if (mode === 'edit') {
        const categoryOptions = [
            {value: '', label: '无分类'},
            ...categories.map(c => ({value: c.id, label: c.name})),
        ]
        const typeOptions = [
            {value: '', label: '无类型'},
            ...entryTypes.map(et => ({value: entryTypeKey(et), label: et.name})),
        ]
        const editTagSchemas = tagSchemas.filter(s => isTagSchemaApplicable(s, entryType))
        return (
            <div className="mobile-page mobile-entry-detail mobile-entry-detail--edit">
                <div className="mobile-entry-detail__actions">
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleCancel()} disabled={saving}>取消</Button>
                    <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? '保存中…' : '保存'}
                    </Button>
                </div>

                <Input
                    placeholder="词条标题"
                    value={title}
                    onValueChange={setTitle}
                    className="mobile-entry-detail__title-input"
                />

                <div className="mobile-entry-detail__meta-row">
                    <Select
                        value={entryType ?? ''}
                        onChange={v => setEntryType(v ? String(v) : null)}
                        options={typeOptions}
                        placeholder="类型"
                        className="mobile-entry-detail__meta-select"
                    />
                    <Select
                        value={categoryId ?? ''}
                        onChange={v => setCategoryId(v ? String(v) : null)}
                        options={categoryOptions}
                        placeholder="分类"
                        className="mobile-entry-detail__meta-select"
                    />
                </div>

                <button
                    type="button"
                    className="mobile-entry-detail__add-type"
                    onClick={() => setTypeCreatorOpen(true)}
                >
                    + 新建类型
                </button>

                <Input
                    placeholder="摘要（可选）"
                    value={summary}
                    onValueChange={setSummary}
                    className="mobile-entry-detail__summary-input"
                />

                <textarea
                    placeholder="正文内容…"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="mobile-entry-detail__content-input"
                />

                {editTagSchemas.length > 0 && (
                    <div className="mobile-entry-detail__tags">
                        <div className="mobile-entry-detail__tags-label">标签</div>
                        <div className="mobile-entry-detail__tags-list">
                            {editTagSchemas.map(s => (
                                <TagItem
                                    key={s.id}
                                    schema={{id: s.id, name: s.name, type: s.type as 'number' | 'string' | 'boolean', range_min: s.range_min ?? null, range_max: s.range_max ?? null}}
                                    value={tagDraft[s.id] ?? undefined}
                                    mode="edit"
                                    onChange={(v) => setTagDraft(prev => ({...prev, [s.id]: normalizeComparableTagValue(v)}))}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <EntryTypeCreator
                    open={typeCreatorOpen}
                    projectId={projectId}
                    existingNames={entryTypes.map(et => et.name)}
                    onClose={() => setTypeCreatorOpen(false)}
                    onSaved={(created) => void handleTypeCreated(created)}
                />
            </div>
        )
    }

    // ---------- 查看态 ----------
    const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null
    const typeBadgeStyle = et?.color
        ? {
            '--mobile-entry-type-bg': `${et.color}22`,
            '--mobile-entry-type-color': et.color,
        } as CSSProperties
        : undefined

    const viewTagMap = buildTagValueMap(entry)
    const viewTagSchemas = tagSchemas.filter(s =>
        isTagSchemaApplicable(s, entry.type) && getComparableTagValue(viewTagMap, s) !== null
    )

    return (
        <div className="mobile-page mobile-entry-detail">
            <h1 className="mobile-entry-detail__title">
                {entry.title}
            </h1>

            {et && (
                <div className="mobile-entry-detail__type">
                    <span className="mobile-entry-detail__type-badge" style={typeBadgeStyle}>
                        <EntryTypeIcon entryType={et} className=""/> {et.name}
                    </span>
                </div>
            )}

            {viewTagSchemas.length > 0 && (
                <div className="mobile-entry-detail__tags mobile-entry-detail__tags--view">
                    {viewTagSchemas.map(s => (
                        <TagItem
                            key={s.id}
                            schema={{id: s.id, name: s.name, type: s.type as 'number' | 'string' | 'boolean', range_min: s.range_min ?? null, range_max: s.range_max ?? null}}
                            value={getComparableTagValue(viewTagMap, s) ?? undefined}
                            mode="show"
                        />
                    ))}
                </div>
            )}

            {entry.summary && (
                <p className="mobile-entry-detail__summary">
                    {entry.summary}
                </p>
            )}

            {entry.content ? (
                <div className="mobile-entry-detail__markdown" data-color-mode={colorMode}>
                    <MarkdownPreview
                        source={entry.content}
                        className="mobile-entry-detail__markdown-preview"
                        wrapperElement={{'data-color-mode': colorMode}}
                    />
                </div>
            ) : (
                <div className="mobile-page__empty mobile-entry-detail__empty">
                    暂无正文内容
                </div>
            )}

            <div className="mobile-bottom-bar mobile-entry-detail__bottom-bar">
                <Button type="button" variant="outline" onClick={handleAiDiscuss}>AI 讨论</Button>
                <Button type="button" onClick={enterEdit}>编辑</Button>
                <Button type="button" variant="ghost" onClick={() => setMenuOpen(true)} aria-label="更多操作">⋯</Button>
            </div>

            <ActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                title={entry.title}
                items={[
                    {key: 'delete', label: '删除词条', danger: true, onSelect: () => void handleDelete()},
                ]}
            />
        </div>
    )
}
