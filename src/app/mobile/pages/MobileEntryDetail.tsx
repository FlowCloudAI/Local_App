import {logger} from '../../../shared/logger'
import MarkdownPreview from '@uiw/react-markdown-preview'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from 'react'
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
    import_entry_images,
    type Entry,
    type EntryTypeView,
    entryTypeKey,
    type TagSchema,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {ActionMenu} from '../../../shared/ui/overlay'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import TagCreator from '../../../features/entries/components/TagCreator'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {buildTagValueMap} from '../../../features/entries/lib/entryCommon'
import {buildMarkdownPreviewSource} from '../../../features/entries/lib/entryMarkdown'
import {
    areTagMapsEqual,
    getComparableTagValue,
    normalizeComparableTagValue,
} from '../../../features/entries/lib/entryTag'
import {
    buildEntryImageMarkdownRef,
    type EntryImage,
    normalizeEntryImages,
    toEntryImageSrc,
} from '../../../features/entries/lib/entryImage'
import useEntryTags from '../../../features/entries/hooks/useEntryTags'
import {buildEntryTagsPayload, type EntryTagRuntimeValue} from '../../../features/entries/components/entryTagUtils'
import EntryImageAddModal from '../../../features/entries/components/EntryImageAddModal'
import EntryImageLightbox from '../../../features/entries/components/EntryImageLightbox'
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
type TagValueMap = Record<string, EntryTagRuntimeValue>

/** 保留 schema 标签和桌面端使用的额外标签（如角色语音配置），避免移动端保存时丢字段。 */
function buildTagDraft(e: Entry): TagValueMap {
    return buildTagValueMap(e)
}

function areImagesEqual(left: EntryImage[], right: EntryImage[]): boolean {
    if (left.length !== right.length) return false
    return left.every((image, index) => {
        const target = right[index]
        return image.path === target.path
            && image.url === target.url
            && image.alt === target.alt
            && image.caption === target.caption
            && Boolean(image.is_cover) === Boolean(target.is_cover)
    })
}

function escapeMarkdownImageAlt(value: string): string {
    return value.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
}

function getImageLabel(image: EntryImage, index: number): string {
    if (image.alt) return image.alt
    if (image.caption) return image.caption
    const raw = image.path ?? image.url ?? ''
    const fileName = String(raw).split(/[\\/]/).pop()
    return fileName || `图片 ${index + 1}`
}

function appendImages(current: EntryImage[], incoming: EntryImage[]): EntryImage[] {
    const nextImages = [...current]
    incoming.forEach((image, index) => {
        nextImages.push({
            ...image,
            is_cover: nextImages.length === 0 && index === 0,
        })
    })
    return nextImages
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
    const contentInputRef = useRef<HTMLTextAreaElement | null>(null)

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
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [tagDraft, setTagDraft] = useState<TagValueMap>({})
    const [images, setImages] = useState<EntryImage[]>([])
    const [imageAddModalOpen, setImageAddModalOpen] = useState(false)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)

    const handleTagDraftChange = useCallback((nextTags: TagValueMap) => {
        setTagDraft(nextTags)
    }, [])
    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: tagDraft,
        draftType: entryType,
        entryId,
        onTagsChange: handleTagDraftChange,
    })

    // wrapperElement 的 data-color-mode 只接受 "light" | "dark"，不接受 "auto"
    const colorMode: 'light' | 'dark' = theme === 'dark'
        ? 'dark'
        : theme === 'light'
            ? 'light'
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    const syncForm = useCallback((e: Entry) => {
        setTitle(e.title)
        setContent(e.content ?? '')
        setSummary(e.summary ?? '')
        setEntryType(e.type ?? null)
        setCategoryId(e.category_id ?? null)
        setTagDraft(buildTagDraft(e))
        setImages(normalizeEntryImages(e.images))
    }, [])

    const isDirty = mode === 'edit' && !!entry && (
        title !== entry.title
        || content !== (entry.content ?? '')
        || summary !== (entry.summary ?? '')
        || entryType !== (entry.type ?? null)
        || categoryId !== (entry.category_id ?? null)
        || !areTagMapsEqual(tagDraft, buildTagValueMap(entry), tagSchemas)
        || !areImagesEqual(images, normalizeEntryImages(entry.images))
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
            syncForm(e)
        }).catch(logger.error).finally(() => setLoading(false))
    }, [entryId, projectId, syncForm])

    const enterEdit = useCallback(() => {
        if (entry) syncForm(entry)
        setMode('edit')
    }, [entry, syncForm])

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
            syncForm(entry)
            setMode('view')
        } else {
            pop()
        }
    }, [confirmDiscard, entry, pop, syncForm])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            await showAlert('请输入词条标题', 'warning', 'toast', 2000)
            return
        }
        if (!entry) return
        setSaving(true)
        const tags = buildEntryTagsPayload(tagDraft, entryTags.localTagSchemas, entry.tags)
        try {
            await db_update_entry({
                id: entryId,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                categoryId: categoryId || null,
                tags,
                images,
            })
            setEntry(prev => prev ? {
                ...prev,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                category_id: categoryId || null,
                tags,
                images,
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
    }, [title, content, summary, entryType, categoryId, tagDraft, entryTags.localTagSchemas, entry, entryId, images, projectId, params, replace, setAiFocus, showAlert])

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

    const handleTagSchemaSaved = useCallback((schema: TagSchema) => {
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
        setTagSchemas(nextSchemas)
        setTagCreatorOpen(false)
    }, [entryTags])

    const lightboxImages = useMemo(() => images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [images])

    const handleUploadImages = useCallback(async (): Promise<EntryImage[]> => {
        try {
            const selected = await openFileDialog({
                multiple: true,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
            if (!paths.length) return []
            const imported = await import_entry_images(projectId, paths)
            const nextImportedImages: EntryImage[] = imported.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${index + 1}`),
                is_cover: false,
            }))
            setImages(current => appendImages(current, nextImportedImages))
            return nextImportedImages
        } catch (error) {
            await showAlert(`导入图片失败：${String(error)}`, 'error', 'toast', 3000)
            return []
        }
    }, [projectId, showAlert])

    const handleAddAiImages = useCallback((aiImages: EntryImage[]) => {
        setImages(current => appendImages(current, aiImages))
    }, [])

    const handleSetCover = useCallback((targetIndex: number) => {
        setImages(current => current.map((image, index) => ({
            ...image,
            is_cover: index === targetIndex,
        })))
    }, [])

    const handleRemoveImage = useCallback((targetIndex: number) => {
        setImages(current => {
            const nextImages = current.filter((_, index) => index !== targetIndex)
            if (nextImages.length > 0 && !nextImages.some(image => image.is_cover)) {
                nextImages[0] = {...nextImages[0], is_cover: true}
            }
            return nextImages
        })
        setLightboxIndex(current => Math.min(current, Math.max(0, images.length - 2)))
    }, [images.length])

    const handleInsertImageMarkdown = useCallback((targetIndex: number) => {
        const image = images[targetIndex]
        const imageRef = buildEntryImageMarkdownRef(image)
        if (!image || !imageRef) {
            void showAlert('当前图片还没有可用于正文引用的 uuid，请先保存词条后再插入。', 'warning', 'toast', 1800)
            return
        }
        const textarea = contentInputRef.current
        const fallbackAlt = getImageLabel(image, targetIndex) || title || entry?.title || `图片 ${targetIndex + 1}`
        const markdown = `![${escapeMarkdownImageAlt(fallbackAlt)}](${imageRef})`
        const start = textarea?.selectionStart ?? content.length
        const end = textarea?.selectionEnd ?? start
        const prefix = content.slice(0, start)
        const suffix = content.slice(end)
        const before = prefix && !prefix.endsWith('\n') ? '\n\n' : ''
        const after = suffix && !suffix.startsWith('\n') ? '\n\n' : ''
        const nextContent = `${prefix}${before}${markdown}${after}${suffix}`
        const nextCursor = prefix.length + before.length + markdown.length
        setContent(nextContent)
        setLightboxOpen(false)
        window.requestAnimationFrame(() => {
            contentInputRef.current?.focus()
            contentInputRef.current?.setSelectionRange(nextCursor, nextCursor)
        })
    }, [content, entry?.title, images, showAlert, title])

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
        const editTagSchemas = entryTags.visibleTagSchemas
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

                <div className="mobile-entry-detail__images">
                    <div className="mobile-entry-detail__images-header">
                        <div className="mobile-entry-detail__images-label">图片</div>
                        <Button type="button" size="sm" variant="outline" onClick={() => setImageAddModalOpen(true)}>
                            + 添加图片
                        </Button>
                    </div>
                    {images.length > 0 ? (
                        <div className="mobile-entry-detail__image-grid">
                            {images.map((image, index) => {
                                const src = toEntryImageSrc(image)
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__image-thumb"
                                        key={`${image.path ?? image.url ?? index}-${index}`}
                                        onClick={() => {
                                            setLightboxIndex(index)
                                            setLightboxOpen(true)
                                        }}
                                    >
                                        {src ? (
                                            <img src={src} alt={getImageLabel(image, index)}/>
                                        ) : (
                                            <span>无预览</span>
                                        )}
                                        {image.is_cover && <span className="mobile-entry-detail__image-badge">主图</span>}
                                    </button>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="mobile-page__empty mobile-entry-detail__images-empty">
                            还没有图片
                        </div>
                    )}
                </div>

                <textarea
                    ref={contentInputRef}
                    placeholder="正文内容…"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="mobile-entry-detail__content-input"
                />

                <div className="mobile-entry-detail__tags">
                    <div className="mobile-entry-detail__tags-header">
                        <div className="mobile-entry-detail__tags-label">标签</div>
                        <div className="mobile-entry-detail__tags-actions">
                            {entryTags.availableTagSchemaOptions.length > 0 && (
                                <Select
                                    value={entryTags.tagSchemaPickerValue}
                                    onChange={(value) => {
                                        if (typeof value !== 'string') return
                                        entryTags.handleAddVisibleTagSchema(value)
                                    }}
                                    options={entryTags.availableTagSchemaOptions}
                                    placeholder="添加已有标签"
                                    searchable
                                    className="mobile-entry-detail__tag-select"
                                />
                            )}
                            <Button type="button" variant="ghost" size="sm" onClick={() => setTagCreatorOpen(true)}>
                                + 新建标签
                            </Button>
                        </div>
                    </div>
                    {entryTags.localTagSchemas.length === 0 ? (
                        <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前项目还没有标签定义</div>
                    ) : editTagSchemas.length > 0 ? (
                        <div className="mobile-entry-detail__tags-list">
                            {editTagSchemas.map(s => (
                                <TagItem
                                    key={s.id}
                                    schema={{id: s.id, name: s.name, type: s.type as 'number' | 'string' | 'boolean', range_min: s.range_min ?? null, range_max: s.range_max ?? null}}
                                    value={tagDraft[s.id] ?? tagDraft[s.name] ?? undefined}
                                    mode="edit"
                                    onChange={(v) => setTagDraft(prev => {
                                        const nextValue = normalizeComparableTagValue(v)
                                        if (getComparableTagValue(prev, s) === nextValue) return prev
                                        return {...prev, [s.id]: nextValue}
                                    })}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前词条还没有已添加标签</div>
                    )}
                </div>

                <EntryTypeCreator
                    open={typeCreatorOpen}
                    projectId={projectId}
                    existingNames={entryTypes.map(et => et.name)}
                    onClose={() => setTypeCreatorOpen(false)}
                    onSaved={(created) => void handleTypeCreated(created)}
                />
                <TagCreator
                    open={tagCreatorOpen}
                    projectId={projectId}
                    entryTypes={entryTypes}
                    existingNames={entryTags.localTagSchemas.map(s => s.name)}
                    existingCount={entryTags.localTagSchemas.length}
                    onClose={() => setTagCreatorOpen(false)}
                    onSaved={handleTagSchemaSaved}
                />
                <EntryImageLightbox
                    open={lightboxOpen}
                    images={lightboxImages}
                    currentIndex={lightboxIndex}
                    infoTitle={title || entry.title || '未命名词条'}
                    onClose={() => setLightboxOpen(false)}
                    onIndexChange={setLightboxIndex}
                    onSetCover={handleSetCover}
                    onRemove={handleRemoveImage}
                    onAddImage={() => {
                        setLightboxOpen(false)
                        setImageAddModalOpen(true)
                    }}
                    onInsertMarkdown={handleInsertImageMarkdown}
                />
                <EntryImageAddModal
                    open={imageAddModalOpen}
                    projectId={projectId}
                    entryTitle={title || entry.title || null}
                    entrySummary={summary || entry.summary || null}
                    entryType={entryType || entry.type || null}
                    existingImages={images}
                    onClose={() => setImageAddModalOpen(false)}
                    onUploadLocal={handleUploadImages}
                    onAddAiImages={handleAddAiImages}
                    onInsertImage={(image) => {
                        const nextIndex = images.findIndex(item => item.path === image.path && item.url === image.url)
                        handleInsertImageMarkdown(nextIndex >= 0 ? nextIndex : images.length)
                    }}
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

    const viewTagMap = tagDraft
    const viewTagSchemas = entryTags.browseVisibleTagSchemas
    const viewImages = normalizeEntryImages(entry.images)
    const viewMarkdownSource = buildMarkdownPreviewSource(entry.content ?? '', viewImages)

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

            {viewImages.length > 0 && (
                <div className="mobile-entry-detail__images mobile-entry-detail__images--view">
                    <div className="mobile-entry-detail__image-grid">
                        {viewImages.map((image, index) => {
                            const src = toEntryImageSrc(image)
                            return (
                                <div className="mobile-entry-detail__image-thumb mobile-entry-detail__image-thumb--static" key={`${image.path ?? image.url ?? index}-${index}`}>
                                    {src ? (
                                        <img src={src} alt={getImageLabel(image, index)}/>
                                    ) : (
                                        <span>无预览</span>
                                    )}
                                    {image.is_cover && <span className="mobile-entry-detail__image-badge">主图</span>}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {entry.content ? (
                <div className="mobile-entry-detail__markdown" data-color-mode={colorMode}>
                    <MarkdownPreview
                        source={viewMarkdownSource}
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
