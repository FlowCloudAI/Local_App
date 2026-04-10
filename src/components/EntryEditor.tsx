import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import MDEditor from '@uiw/react-md-editor'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Button, MarkdownEditor, Select, TagItem, useAlert } from 'flowcloudai-ui'
import {
    db_create_entry,
    db_get_entry,
    db_list_entries,
    db_update_entry,
    entryTypeKey,
    type Category,
    type Entry,
    type EntryBrief,
    type EntryTag,
    type EntryTypeView,
    type FCImage,
    type TagSchema,
} from '../api'
import TagCreator from './TagCreator'
import EntryTypeIcon from './project-editor/EntryTypeIcon'
import './EntryEditor.css'

type EditorMode = 'edit' | 'browse'

type WikiDraft = {
    start: number
    end: number
    query: string
}

type LinkPreviewState = {
    title: string
    entryId: string | null
}

type EntryImage = FCImage & {
    is_cover?: boolean
}

type EntryEditorCache = {
    entry: Entry
    draft: EntryDraft
    editorMode: EditorMode
    infoCollapsed: boolean
}

interface EntryEditorProps {
    entryId: string
    projectId: string
    projectName: string
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    openEntryIds?: string[]
    onOpenEntry?: (entry: { id: string; title: string }) => void
    onTitleChange?: (entry: Entry) => void | Promise<void>
    onSaved?: (entry: Entry) => void | Promise<void>
    onTagSchemasChange?: (schemas: TagSchema[]) => void | Promise<void>
    onBack?: () => void | Promise<void>
    onDirtyChange?: (dirty: boolean) => void
}

interface EntryDraft {
    title: string
    summary: string
    content: string
    type: string | null
    tags: Record<string, string | number | boolean | null>
    images: EntryImage[]
}

function normalizeEntryImages(images?: FCImage[] | null): EntryImage[] {
    if (!images?.length) return []

    const normalized = images.map((image) => ({
        ...image,
        is_cover: Boolean((image as EntryImage).is_cover),
    }))

    if (!normalized.some((image) => image.is_cover)) {
        normalized[0] = {
            ...normalized[0],
            is_cover: true,
        }
    }

    return normalized
}

function toEntryImageSrc(image?: FCImage | null): string | undefined {
    const raw = image?.url || image?.path
    if (!raw) return undefined
    if (/^(https?:|data:|blob:|asset:)/i.test(raw)) return raw
    return convertFileSrc(raw)
}

function getCoverImage(images: EntryImage[]): EntryImage | null {
    return images.find((image) => image.is_cover) || images[0] || null
}

function buildTagValueMap(entry: Entry): Record<string, string | number | boolean | null> {
    return Object.fromEntries((entry.tags ?? []).map((tag) => [tag.schema_id ?? tag.name ?? '', normalizeTagRuntimeValue(tag.value)]))
}

function normalizeTagRuntimeValue(value: unknown): string | number | boolean | null {
    if (value == null) return null
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value
    }
    if (Array.isArray(value)) return null

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean') {
            return record.value
        }
    }

    return null
}

function normalizeEntryContent(entry: Entry): string {
    if (typeof entry.content === 'string') return entry.content
    const rawContent = entry['content']
    return typeof rawContent === 'string' ? rawContent : ''
}

function buildDraft(entry: Entry): EntryDraft {
    return {
        title: entry.title ?? '',
        summary: entry.summary ?? '',
        content: normalizeEntryContent(entry),
        type: entry.type ?? null,
        tags: buildTagValueMap(entry),
        images: normalizeEntryImages(entry.images),
    }
}

function normalizeComparableText(value: string): string {
    return value.replace(/\r\n?/g, '\n').trim()
}

function normalizeComparableType(value?: string | null): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

function normalizeComparableTagValue(value: unknown): string | number | boolean | null {
    const normalized = normalizeTagRuntimeValue(value)
    if (typeof normalized === 'string') {
        const trimmed = normalized.trim()
        return trimmed ? trimmed : null
    }
    return normalized
}

function getComparableTagValue(
    tags: Record<string, string | number | boolean | null>,
    schema: TagSchema,
): string | number | boolean | null {
    return normalizeComparableTagValue(tags[schema.id] ?? tags[schema.name] ?? null)
}

function parseDateValue(value?: string | null): number {
    if (!value) return 0
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const timestamp = new Date(withTimezone).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
}

function formatDate(value?: string | null): string {
    const timestamp = parseDateValue(value)
    if (!timestamp) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(timestamp)
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

function extractWikiLinks(content?: string | null): string[] {
    if (!content) return []
    const matches = content.matchAll(/\[\[([^[\]\n]+?)]]/g)
    return [...new Set([...matches].map((match) => match[1].trim()).filter(Boolean))]
}

function buildMarkdownPreviewSource(content: string): string {
    return content.replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
        const title = String(rawTitle).trim()
        return `[${title}](entry://${encodeURIComponent(title)})`
    })
}

function resolveActiveWikiDraft(value: string, cursor: number | null): WikiDraft | null {
    if (cursor == null) return null
    const beforeCursor = value.slice(0, cursor)
    const start = beforeCursor.lastIndexOf('[[')
    if (start === -1) return null
    const tail = beforeCursor.slice(start + 2)
    if (tail.includes(']]') || /[\r\n]/.test(tail)) return null
    return {
        start,
        end: cursor,
        query: tail,
    }
}

function replaceRange(value: string, start: number, end: number, nextText: string): string {
    return `${value.slice(0, start)}${nextText}${value.slice(end)}`
}

function areTagMapsEqual(
    left: Record<string, string | number | boolean | null>,
    right: Record<string, string | number | boolean | null>,
    schemas: TagSchema[],
): boolean {
    for (const schema of schemas) {
        if (getComparableTagValue(left, schema) !== getComparableTagValue(right, schema)) return false
    }
    return true
}

function areImagesEqual(left: EntryImage[], right: EntryImage[]): boolean {
    if (left.length !== right.length) return false
    return left.every((image, index) => {
        const target = right[index]
        return image.path === target.path
            && image.url === target.url
            && image.alt === target.alt
            && Boolean(image.is_cover) === Boolean(target.is_cover)
    })
}

function buildSavedTags(
    draftTags: Record<string, string | number | boolean | null>,
    tagSchemas: TagSchema[],
    originalTags?: EntryTag[] | null,
): EntryTag[] | null {
    const schemaIds = new Set(tagSchemas.map((schema) => schema.id))
    const preservedExtras = (originalTags ?? []).filter((tag) => !tag.schema_id || !schemaIds.has(tag.schema_id))
    const schemaTags = tagSchemas
        .map((schema) => ({
            schema_id: schema.id,
            value: draftTags[schema.id] ?? draftTags[schema.name] ?? null,
        }))
        .filter((tag) => tag.value !== null && tag.value !== '')
    const merged = [...preservedExtras, ...schemaTags]
    return merged.length ? merged : null
}

function getCategoryName(categories: Category[], categoryId?: string | null): string {
    if (!categoryId) return '未分类'
    return categories.find((category) => category.id === categoryId)?.name ?? '未分类'
}

function formatCategoryMeta(categories: Category[], categoryId?: string | null): string {
    return `所属分类：${getCategoryName(categories, categoryId)}`
}

function buildEntryPath(projectName: string, categories: Category[], categoryId: string | null | undefined, entryTitle: string): string {
    const categoryMap = new Map(categories.map(category => [category.id, category]))
    const path: string[] = [entryTitle]
    let currentId = categoryId ?? null

    while (currentId) {
        const current = categoryMap.get(currentId)
        if (!current) break
        path.unshift(current.name)
        currentId = current.parent_id ?? null
    }

    path.unshift(projectName)
    return path.join('-')
}

export default function EntryEditor({
    entryId,
    projectId,
    projectName,
    categories,
    entryTypes,
    tagSchemas,
    openEntryIds = [],
    onOpenEntry,
    onTitleChange,
    onSaved,
    onTagSchemasChange,
    onBack,
    onDirtyChange,
}: EntryEditorProps) {
    const [entry, setEntry] = useState<Entry | null>(null)
    const [draft, setDraft] = useState<EntryDraft>({
        title: '',
        summary: '',
        content: '',
        type: null,
        tags: {},
        images: [],
    })
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [editorMode, setEditorMode] = useState<EditorMode>('browse')
    const [infoCollapsed, setInfoCollapsed] = useState(false)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)
    const [wikiDraft, setWikiDraft] = useState<WikiDraft | null>(null)
    const [creatingLinkedEntry, setCreatingLinkedEntry] = useState(false)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryCache, setEntryCache] = useState<Record<string, Entry>>({})
    const [backlinksExpanded, setBacklinksExpanded] = useState(false)
    const [projectDataLoading, setProjectDataLoading] = useState(false)
    const [linkPreview, setLinkPreview] = useState<LinkPreviewState | null>(null)
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [localTagSchemas, setLocalTagSchemas] = useState<TagSchema[]>(tagSchemas)
    const wikiDraftRetainTimerRef = useRef<number | null>(null)
    const entryCacheRef = useRef<Record<string, EntryEditorCache>>({})
    const { showAlert } = useAlert()

    useEffect(() => {
        setLocalTagSchemas(tagSchemas)
    }, [tagSchemas])

    useEffect(() => {
        onDirtyChange?.(false)
    }, [entryId, onDirtyChange])

    useEffect(() => {
        const openEntryIdSet = new Set(openEntryIds)
        const nextCache = Object.fromEntries(
            Object.entries(entryCacheRef.current).filter(([cachedEntryId]) => openEntryIdSet.has(cachedEntryId)),
        )
        entryCacheRef.current = nextCache
    }, [openEntryIds])

    useEffect(() => {
        let cancelled = false
        const cachedState = entryCacheRef.current[entryId]
        setLoading(true)
        setSaving(false)
        setError(null)
        setLinkPreview(null)
        setWikiDraft(null)

        if (cachedState) {
            setEntry(cachedState.entry)
            setDraft(cachedState.draft)
            setEditorMode(cachedState.editorMode)
            setInfoCollapsed(cachedState.infoCollapsed)
            setLoading(false)
            return () => {
                cancelled = true
            }
        }

        void db_get_entry(entryId)
            .then((result) => {
                if (cancelled) return
                setEntry(result)
                setDraft(buildDraft(result))
                setEditorMode('browse')
                setInfoCollapsed(false)
            })
            .catch((e) => {
                if (cancelled) return
                setEntry(null)
                setError(String(e))
            })
            .finally(() => {
                if (cancelled) return
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [entryId])

    useEffect(() => {
        let cancelled = false
        setProjectDataLoading(true)

        async function loadProjectEntries() {
            try {
                const briefs = await db_list_entries({
                    projectId,
                    limit: 1000,
                    offset: 0,
                })
                if (cancelled) return
                setProjectEntries(briefs)

                const details = await Promise.all(
                    briefs.map(async (brief) => {
                        try {
                            const detail = await db_get_entry(brief.id)
                            return [brief.id, detail] as const
                        } catch {
                            return null
                        }
                    }),
                )
                if (cancelled) return
                setEntryCache(Object.fromEntries(details.filter(Boolean) as Array<readonly [string, Entry]>))
            } finally {
                if (!cancelled) {
                    setProjectDataLoading(false)
                }
            }
        }

        void loadProjectEntries()

        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        return () => {
            if (wikiDraftRetainTimerRef.current) {
                window.clearTimeout(wikiDraftRetainTimerRef.current)
            }
        }
    }, [])

    const typeOptions = useMemo(
        () => entryTypes.map((entryType) => ({
            key: entryTypeKey(entryType),
            entryType,
        })),
        [entryTypes],
    )
    const builtinTypeOptions = typeOptions.filter(({entryType}) => entryType.kind === 'builtin')
    const customTypeOptions = typeOptions
        .filter(({entryType}) => entryType.kind === 'custom')
        .map(({key, entryType}) => ({
            value: key,
            label: entryType.name,
        }))

    const trimmedTitle = normalizeComparableText(draft.title)
    const trimmedSummary = normalizeComparableText(draft.summary)
    const trimmedContent = normalizeComparableText(draft.content)
    const initialDraft = entry ? buildDraft(entry) : null
    const hasChanges = Boolean(
        initialDraft && (
            trimmedTitle !== normalizeComparableText(initialDraft.title)
            || trimmedSummary !== normalizeComparableText(initialDraft.summary)
            || trimmedContent !== normalizeComparableText(initialDraft.content)
            || normalizeComparableType(draft.type) !== normalizeComparableType(initialDraft.type)
            || !areTagMapsEqual(draft.tags, initialDraft.tags, localTagSchemas)
            || !areImagesEqual(draft.images, initialDraft.images)
        ),
    )
    const canSave = Boolean(entry && trimmedTitle && hasChanges && !loading && !saving)

    useEffect(() => {
        onDirtyChange?.(hasChanges)
    }, [hasChanges, onDirtyChange])

    useEffect(() => {
        if (!entry) return
        if (hasChanges) {
            entryCacheRef.current[entryId] = {
                entry,
                draft,
                editorMode,
                infoCollapsed,
            }
            return
        }
        delete entryCacheRef.current[entryId]
    }, [draft, editorMode, entry, entryId, hasChanges, infoCollapsed])

    const coverImage = useMemo(() => getCoverImage(draft.images), [draft.images])
    const coverSrc = useMemo(() => toEntryImageSrc(coverImage), [coverImage])
    const lightboxImages = useMemo(() => draft.images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [draft.images])

    const filteredLinkSuggestions = useMemo(() => {
        if (!wikiDraft) return []
        const query = wikiDraft.query.trim().toLowerCase()
        return projectEntries
            .filter((item) => item.id !== entryId)
            .filter((item) => !query || item.title.toLowerCase().includes(query))
            .slice(0, 8)
    }, [wikiDraft, projectEntries, entryId])

    const hasExactSuggestion = useMemo(() => {
        const query = wikiDraft?.query.trim().toLowerCase()
        if (!query) return false
        return projectEntries.some((item) => item.title.trim().toLowerCase() === query)
    }, [wikiDraft, projectEntries])

    const backlinks = useMemo(() => {
        if (!trimmedTitle) return []
        return Object.values(entryCache)
            .filter((item) => item.id !== entryId)
            .filter((item) => extractWikiLinks(item.content).includes(trimmedTitle))
            .sort((left, right) => parseDateValue(right.updated_at as string | null | undefined) - parseDateValue(left.updated_at as string | null | undefined))
    }, [entryCache, entryId, trimmedTitle])

    const infoTitle = trimmedTitle || entry?.title || '未命名词条'

    const linkPreviewEntry = useMemo(() => {
        if (!linkPreview) return null
        if (linkPreview.entryId) return entryCache[linkPreview.entryId] ?? null
        return Object.values(entryCache).find((item) => item.title === linkPreview.title) ?? null
    }, [entryCache, linkPreview])
    const entryPathLabel = useMemo(
        () => buildEntryPath(projectName, categories, entry?.category_id ?? null, infoTitle),
        [projectName, categories, entry?.category_id, infoTitle],
    )

    async function handleSave() {
        if (!entry || !canSave) return

        setSaving(true)
        setError(null)

        try {
            const updated = await db_update_entry({
                id: entry.id,
                categoryId: entry.category_id ?? null,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                content: trimmedContent || null,
                type: draft.type,
                tags: buildSavedTags(draft.tags, localTagSchemas, entry.tags),
                images: draft.images,
            })
            const refreshed = await db_get_entry(updated.id)
            setEntry(refreshed)
            setDraft(buildDraft(refreshed))
            setEntryCache((current) => ({ ...current, [refreshed.id]: refreshed }))
            setProjectEntries((current) => current.map((item) => (
                item.id === refreshed.id
                    ? {
                        ...item,
                        title: refreshed.title,
                        summary: refreshed.summary ?? null,
                        type: refreshed.type ?? null,
                        updated_at: String(refreshed.updated_at ?? ''),
                    }
                    : item
            )))
            if (refreshed.title !== entry.title) {
                await onTitleChange?.(refreshed)
            }
            await onSaved?.(refreshed)
            void showAlert('词条已保存', 'success', 'toast', 1000)
        } catch (e) {
            setError(String(e))
        } finally {
            setSaving(false)
        }
    }

    function applyWikiLink(title: string) {
        if (!wikiDraft) return
        const inserted = `[[${title}]]`
        setDraft((current) => ({
            ...current,
            content: replaceRange(current.content, wikiDraft.start, wikiDraft.end, inserted),
        }))
        setWikiDraft(null)
    }

    async function handleCreateLinkedEntry() {
        const title = wikiDraft?.query.trim()
        if (!title || hasExactSuggestion) return
        setCreatingLinkedEntry(true)
        try {
            const created = await db_create_entry({
                projectId,
                categoryId: entry?.category_id ?? null,
                title,
                summary: null,
                content: null,
                type: null,
                tags: null,
                images: null,
            })
            const brief: EntryBrief = {
                id: created.id,
                project_id: created.project_id,
                category_id: created.category_id ?? null,
                title: created.title,
                summary: created.summary ?? null,
                type: created.type ?? null,
                cover: null,
                updated_at: String(created.updated_at ?? ''),
            }
            setProjectEntries((current) => [brief, ...current])
            setEntryCache((current) => ({ ...current, [created.id]: created }))
            applyWikiLink(created.title)
            void showAlert('已创建并插入双链', 'success', 'toast', 1000)
        } catch (e) {
            setError(String(e))
        } finally {
            setCreatingLinkedEntry(false)
        }
    }

    function handleMarkdownCursorSync(textarea: HTMLTextAreaElement) {
        setWikiDraft(resolveActiveWikiDraft(textarea.value, textarea.selectionStart))
    }

    async function handleUploadImages() {
        try {
            const selected = await openFileDialog({
                multiple: true,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
            if (!paths.length) return
            setDraft((current) => {
                const nextImages = [...current.images]
                paths.forEach((path, index) => {
                    nextImages.push({
                        path,
                        alt: path.split(/[\\/]/).pop() ?? `图片 ${nextImages.length + 1}`,
                        is_cover: nextImages.length === 0 && index === 0,
                    })
                })
                return {
                    ...current,
                    images: nextImages,
                }
            })
        } catch (e) {
            setError(String(e))
        }
    }

    function handleSetCover(targetIndex: number) {
        setDraft((current) => ({
            ...current,
            images: current.images.map((image, index) => ({
                ...image,
                is_cover: index === targetIndex,
            })),
        }))
    }

    function handleRemoveImage(targetIndex: number) {
        setDraft((current) => {
            const nextImages = current.images.filter((_, index) => index !== targetIndex)
            if (nextImages.length > 0 && !nextImages.some((image) => image.is_cover)) {
                nextImages[0] = {
                    ...nextImages[0],
                    is_cover: true,
                }
            }
            return {
                ...current,
                images: nextImages,
            }
        })
    }

    function handleOpenLinkedEntryByTitle(title: string) {
        const target = projectEntries.find((item) => item.title === title)
        if (!target) {
            setLinkPreview({ title, entryId: null })
            return
        }
        onOpenEntry?.({ id: target.id, title: target.title })
    }

    async function handleTagSchemaSaved(schema: TagSchema) {
        const nextSchemas = [...localTagSchemas, schema]
        setLocalTagSchemas(nextSchemas)
        setDraft((current) => ({
            ...current,
            tags: {
                ...current.tags,
                [schema.id]: current.tags[schema.id] ?? current.tags[schema.name] ?? null,
            },
        }))
        await onTagSchemasChange?.(nextSchemas)
        setTagCreatorOpen(false)
    }

    return (
        <div className="entry-editor-page">
            <div className={`entry-editor-shell ${infoCollapsed ? 'is-collapsed' : ''}`}>
                <section className="entry-editor-hero">
                    <div className="entry-editor-hero__bar">
                        <div className="entry-editor-hero__title-block">
                            <button
                                type="button"
                                className="entry-editor-back-button"
                                onClick={onBack}
                                disabled={!onBack}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                        d="M14.5 6.5L9 12l5.5 5.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                <span>返回</span>
                            </button>
                            <button
                                type="button"
                                className="entry-editor-collapse"
                                onClick={() => setInfoCollapsed((current) => !current)}
                                aria-label={infoCollapsed ? '展开信息区' : '收起信息区'}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                        d={infoCollapsed ? 'M7 10l5 5 5-5' : 'M7 14l5-5 5 5'}
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                            <div>
                                <h1 className="entry-editor-hero__title">{infoTitle}</h1>
                                <p className="entry-editor-hero__path">{entryPathLabel}</p>
                                <p className="entry-editor-hero__meta">
                                    {entry ? `更新于 ${formatDate(entry.updated_at as string | null | undefined)}` : '正在读取词条…'}
                                </p>
                            </div>
                        </div>

                        <div className="entry-editor-hero__actions">
                            <div className="entry-editor-mode-switch">
                                <button
                                    type="button"
                                    className={`entry-editor-mode-chip${editorMode === 'browse' ? ' active' : ''}`}
                                    onClick={() => setEditorMode('browse')}
                                >
                                    浏览
                                </button>
                                <button
                                    type="button"
                                    className={`entry-editor-mode-chip${editorMode === 'edit' ? ' active' : ''}`}
                                    onClick={() => setEditorMode('edit')}
                                >
                                    编辑
                                </button>
                            </div>
                            <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
                                {saving ? '保存中…' : '保存修改'}
                            </Button>
                        </div>
                    </div>

                    {!infoCollapsed && (
                        <div className="entry-editor-hero__content">
                            <div className="entry-editor-cover-panel">
                                <button
                                    type="button"
                                    className={`entry-editor-cover ${coverSrc ? 'has-image' : ''}`}
                                    onClick={() => {
                                        if (lightboxImages.length) {
                                            setLightboxIndex(Math.max(0, lightboxImages.findIndex((image) => image.is_cover)))
                                            setLightboxOpen(true)
                                        } else {
                                            void handleUploadImages()
                                        }
                                    }}
                                >
                                    {coverSrc ? (
                                        <img src={coverSrc} alt={coverImage?.alt || infoTitle} className="entry-editor-cover__image" />
                                    ) : (
                                        <div className="entry-editor-cover__placeholder">
                                            <span className="entry-editor-cover__mark">{infoTitle[0] ?? '词'}</span>
                                            <span className="entry-editor-cover__hint">点击上传主图</span>
                                        </div>
                                    )}
                                </button>

                                <div className="entry-editor-cover__toolbar">
                                    <Button variant="outline" size="sm" onClick={() => void handleUploadImages()}>
                                        添加图片
                                    </Button>
                                    {coverImage && (
                                        <Button variant="ghost" size="sm" onClick={() => setLightboxOpen(true)}>
                                            查看设定集
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div className="entry-editor-meta-panel">
                                <div className="entry-editor-meta-panel__section">
                                    <label className="entry-editor-field-label">标题</label>
                                    <input
                                        className="entry-editor-title-input"
                                        value={draft.title}
                                        onChange={(event) => setDraft((current) => (
                                            normalizeComparableText(current.title) === normalizeComparableText(event.target.value)
                                                ? current
                                                : { ...current, title: event.target.value }
                                        ))}
                                        placeholder="输入词条标题"
                                        disabled={saving || loading}
                                    />
                                </div>

                                <div className="entry-editor-meta-panel__section">
                                    <label className="entry-editor-field-label">摘要</label>
                                    <textarea
                                        className="entry-editor-summary-input"
                                        value={draft.summary}
                                        onChange={(event) => setDraft((current) => (
                                            normalizeComparableText(current.summary) === normalizeComparableText(event.target.value)
                                                ? current
                                                : { ...current, summary: event.target.value }
                                        ))}
                                        placeholder="用一两句话概括这个词条的核心信息"
                                        rows={2}
                                        disabled={saving || loading}
                                    />
                                </div>

                                <div className="entry-editor-meta-panel__section">
                                    <div className="entry-editor-field-label-row">
                                        <label className="entry-editor-field-label">词条类型</label>
                                        <span className="entry-editor-field-note">切换后会同步影响筛选与卡片标记</span>
                                    </div>
                                    <div className="entry-editor-type-grid">
                                        <button
                                            type="button"
                                            className={`entry-editor-type-chip${draft.type === null ? ' active' : ''}`}
                                            onClick={() => setDraft((current) => (
                                                normalizeComparableType(current.type) === null
                                                    ? current
                                                    : { ...current, type: null }
                                            ))}
                                        >
                                            不设置
                                        </button>
                                        {builtinTypeOptions.map(({ key, entryType }) => (
                                            <button
                                                key={key}
                                                type="button"
                                                className={`entry-editor-type-chip${draft.type === key ? ' active' : ''}`}
                                                style={{ '--entry-editor-chip-color': entryType.color } as CSSProperties}
                                                onClick={() => setDraft((current) => ({
                                                    ...current,
                                                    type: normalizeComparableType(current.type) === key ? null : key,
                                                }))}
                                            >
                                                <EntryTypeIcon entryType={entryType} className="entry-editor-type-chip__icon" />
                                                <span>{entryType.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {customTypeOptions.length > 0 && (
                                        <div className="entry-editor-custom-type">
                                            <label className="entry-editor-field-label">自定义类型</label>
                                            <Select
                                                options={customTypeOptions}
                                                value={draft.type && customTypeOptions.some(option => option.value === draft.type) ? draft.type : undefined}
                                                onChange={(value) => setDraft((current) => {
                                                    const nextType = normalizeComparableType(typeof value === 'string' ? value : null)
                                                    return normalizeComparableType(current.type) === nextType
                                                        ? current
                                                        : {
                                                            ...current,
                                                            type: nextType,
                                                        }
                                                })}
                                                placeholder="搜索并选择自定义词条类型"
                                                searchable
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="entry-editor-meta-panel__section">
                                    <div className="entry-editor-field-label-row">
                                        <label className="entry-editor-field-label">标签</label>
                                        <Button variant="ghost" size="sm" onClick={() => setTagCreatorOpen(true)}>
                                            + 新建标签 Schema
                                        </Button>
                                    </div>
                                    {localTagSchemas.length === 0 ? (
                                        <div className="entry-editor-empty-tip">当前项目还没有标签定义，先创建一个再给词条填写。</div>
                                    ) : (
                                        <div className="entry-editor-tags-grid">
                                            {localTagSchemas.map((schema) => (
                                                <div key={schema.id} className="entry-editor-tag-card">
                                                    <div className="entry-editor-tag-card__header">
                                                        <span className="entry-editor-tag-card__title">{schema.name}</span>
                                                        <span className="entry-editor-tag-card__meta">
                                                            {formatCategoryMeta(categories, entry?.category_id ?? null)}
                                                        </span>
                                                    </div>
                                                    <TagItem
                                                        key={`${entryId}-${schema.id}`}
                                                        schema={{
                                                            id: schema.id,
                                                            name: schema.name,
                                                            type: schema.type as 'number' | 'string' | 'boolean',
                                                            range_min: schema.range_min ?? null,
                                                            range_max: schema.range_max ?? null,
                                                        }}
                                                        value={draft.tags[schema.id] ?? undefined}
                                                        mode="edit"
                                                        onChange={(value) => setDraft((current) => {
                                                            const nextValue = normalizeComparableTagValue(value)
                                                            const currentValue = getComparableTagValue(current.tags, schema)
                                                            if (currentValue === nextValue) return current
                                                            return {
                                                                ...current,
                                                                tags: {
                                                                    ...current.tags,
                                                                    [schema.id]: nextValue,
                                                                },
                                                            }
                                                        })}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                <section className="entry-editor-workspace">
                    <div className="entry-editor-workspace__header">
                        <div>
                            <h2 className="entry-editor-workspace__title">正文编辑</h2>
                            <p className="entry-editor-workspace__desc">
                                {editorMode === 'edit'
                                    ? '输入 [[ 可搜索当前项目词条并插入双链。'
                                    : '单击双链查看预览，双击或按钮可在新页签打开。'}
                            </p>
                        </div>
                        <span className="entry-editor-workspace__meta">
                            {projectDataLoading ? '正在索引项目词条…' : `${projectEntries.length} 个词条可用于双链联想`}
                        </span>
                    </div>

                    <div className="entry-editor-workspace__body">
                        {editorMode === 'edit' ? (
                            <div className="entry-editor-markdown">
                                <MarkdownEditor
                                    key={entryId}
                                    value={draft.content}
                                    onChange={(value) => setDraft((current) => (
                                        normalizeComparableText(current.content) === normalizeComparableText(value)
                                            ? current
                                            : { ...current, content: value }
                                    ))}
                                    minHeight={720}
                                    placeholder="在这里写正文。输入 [[ 可以快速插入双链。"
                                    textareaProps={{
                                        onKeyUp: (event) => handleMarkdownCursorSync(event.currentTarget),
                                        onClick: (event) => handleMarkdownCursorSync(event.currentTarget),
                                        onSelect: (event) => handleMarkdownCursorSync(event.currentTarget),
                                        onBlur: () => {
                                            if (wikiDraftRetainTimerRef.current) {
                                                window.clearTimeout(wikiDraftRetainTimerRef.current)
                                            }
                                            wikiDraftRetainTimerRef.current = window.setTimeout(() => setWikiDraft(null), 120)
                                        },
                                    }}
                                />

                                {wikiDraft && (
                                    <div className="entry-editor-wikilink-popover">
                                        <div className="entry-editor-wikilink-popover__header">
                                            <span>插入双链</span>
                                            <span className="entry-editor-wikilink-popover__query">
                                                {wikiDraft.query || '继续输入词条名…'}
                                            </span>
                                        </div>

                                        <div className="entry-editor-wikilink-popover__list">
                                            {filteredLinkSuggestions.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    className="entry-editor-wikilink-option"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => applyWikiLink(item.title)}
                                                >
                                                    <span className="entry-editor-wikilink-option__title">{item.title}</span>
                                                    <span className="entry-editor-wikilink-option__meta">
                                                        {getCategoryName(categories, item.category_id)}
                                                    </span>
                                                </button>
                                            ))}

                                            {!hasExactSuggestion && wikiDraft.query.trim() && (
                                                <button
                                                    type="button"
                                                    className="entry-editor-wikilink-option is-create"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => void handleCreateLinkedEntry()}
                                                    disabled={creatingLinkedEntry}
                                                >
                                                    <span className="entry-editor-wikilink-option__title">
                                                        {creatingLinkedEntry ? '创建中…' : `创建新词条：${wikiDraft.query.trim()}`}
                                                    </span>
                                                    <span className="entry-editor-wikilink-option__meta">
                                                        创建后会立即插入双链
                                                    </span>
                                                </button>
                                            )}

                                            {!filteredLinkSuggestions.length && (hasExactSuggestion || !wikiDraft.query.trim()) && (
                                                <div className="entry-editor-wikilink-empty">
                                                    {wikiDraft.query.trim() ? '没有更多匹配项' : '继续输入词条名以搜索'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="entry-editor-preview">
                                <MDEditor.Markdown
                                    source={buildMarkdownPreviewSource(draft.content)}
                                    style={{ whiteSpace: 'pre-wrap', background: 'transparent' }}
                                    components={{
                                        a: ({ href, children }) => {
                                            if (typeof href === 'string' && href.startsWith('entry://')) {
                                                const title = decodeURIComponent(href.replace('entry://', ''))
                                                return (
                                                    <button
                                                        type="button"
                                                        className="entry-editor-inline-link"
                                                        onClick={() => {
                                                            const target = projectEntries.find((item) => item.title === title)
                                                            setLinkPreview({
                                                                title,
                                                                entryId: target?.id ?? null,
                                                            })
                                                        }}
                                                        onDoubleClick={() => handleOpenLinkedEntryByTitle(title)}
                                                    >
                                                        {children}
                                                    </button>
                                                )
                                            }
                                            return <a href={href}>{children}</a>
                                        },
                                    }}
                                />

                                {linkPreview && (
                                    <div className="entry-editor-link-preview">
                                        <div className="entry-editor-link-preview__header">
                                            <span>双链预览</span>
                                            <button
                                                type="button"
                                                className="entry-editor-link-preview__close"
                                                onClick={() => setLinkPreview(null)}
                                            >
                                                关闭
                                            </button>
                                        </div>

                                        {linkPreviewEntry ? (
                                            <div className="entry-editor-link-preview__body">
                                                <div className="entry-editor-link-preview__media">
                                                    {toEntryImageSrc(getCoverImage(normalizeEntryImages(linkPreviewEntry.images))) ? (
                                                        <img
                                                            src={toEntryImageSrc(getCoverImage(normalizeEntryImages(linkPreviewEntry.images)))}
                                                            alt={linkPreviewEntry.title}
                                                        />
                                                    ) : (
                                                        <div className="entry-editor-link-preview__placeholder">
                                                            {linkPreviewEntry.title[0] ?? '词'}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="entry-editor-link-preview__content">
                                                    <h3>{linkPreviewEntry.title}</h3>
                                                    <p className="entry-editor-link-preview__summary">
                                                        {linkPreviewEntry.summary || '暂无摘要'}
                                                    </p>
                                                    <p className="entry-editor-link-preview__excerpt">
                                                        {buildExcerpt(linkPreviewEntry.content)}
                                                    </p>
                                                    <div className="entry-editor-link-preview__actions">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleOpenLinkedEntryByTitle(linkPreviewEntry.title)}
                                                        >
                                                            在页签中打开
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="entry-editor-link-preview__empty">
                                                当前项目中没有找到名为“{linkPreview.title}”的词条。
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                <section className={`entry-editor-backlinks ${backlinksExpanded ? 'is-expanded' : ''}`}>
                    <button
                        type="button"
                        className="entry-editor-backlinks__toggle"
                        onClick={() => setBacklinksExpanded((current) => !current)}
                    >
                        <span>反向链接</span>
                        <span className="entry-editor-backlinks__count">{backlinks.length}</span>
                    </button>

                    {backlinksExpanded && (
                        <div className="entry-editor-backlinks__body">
                            {backlinks.length === 0 ? (
                                <div className="entry-editor-empty-tip">
                                    目前还没有其他词条通过 `[[{infoTitle}]]` 引用它。
                                </div>
                            ) : (
                                <div className="entry-editor-backlinks__list">
                                    {backlinks.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className="entry-editor-backlinks__item"
                                            onClick={() => onOpenEntry?.({ id: item.id, title: item.title })}
                                        >
                                            <span className="entry-editor-backlinks__item-title">{item.title}</span>
                                            <span className="entry-editor-backlinks__item-meta">
                                                {getCategoryName(categories, item.category_id)} · {formatDate(item.updated_at as string | null | undefined)}
                                            </span>
                                            <span className="entry-editor-backlinks__item-excerpt">{buildExcerpt(item.content, 96)}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {(error || loading) && (
                    <div className={`entry-editor-feedback ${error ? 'is-error' : ''}`}>
                        {error || '正在加载词条…'}
                    </div>
                )}
            </div>

            {lightboxOpen && lightboxImages.length > 0 && (
                <div className="entry-editor-lightbox" onClick={(event) => {
                    if (event.target === event.currentTarget) setLightboxOpen(false)
                }}>
                    <div className="entry-editor-lightbox__dialog">
                        <div className="entry-editor-lightbox__toolbar">
                            <div className="entry-editor-lightbox__meta">
                                <span>{lightboxIndex + 1} / {lightboxImages.length}</span>
                                {lightboxImages[lightboxIndex]?.is_cover && <span className="entry-editor-lightbox__badge">主图</span>}
                            </div>
                            <div className="entry-editor-lightbox__actions">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSetCover(lightboxIndex)}
                                >
                                    设为主图
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveImage(lightboxIndex)}
                                >
                                    移除
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setLightboxOpen(false)}
                                >
                                    关闭
                                </Button>
                            </div>
                        </div>

                        <div className="entry-editor-lightbox__main">
                            {lightboxImages[lightboxIndex]?.src ? (
                                <img
                                    src={lightboxImages[lightboxIndex].src}
                                    alt={lightboxImages[lightboxIndex].alt || infoTitle}
                                    className="entry-editor-lightbox__image"
                                />
                            ) : (
                                <div className="entry-editor-lightbox__empty">图片路径不可预览</div>
                            )}
                        </div>

                        <div className="entry-editor-lightbox__thumbs">
                            {lightboxImages.map((image, index) => (
                                <button
                                    key={`${image.path ?? image.url ?? index}-${index}`}
                                    type="button"
                                    className={`entry-editor-lightbox__thumb${index === lightboxIndex ? ' active' : ''}`}
                                    onClick={() => setLightboxIndex(index)}
                                >
                                    {image.src ? (
                                        <img src={image.src} alt={image.alt || `${infoTitle} ${index + 1}`} />
                                    ) : (
                                        <span>{index + 1}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={entryTypes}
                existingNames={localTagSchemas.map((schema) => schema.name)}
                existingCount={localTagSchemas.length}
                onClose={() => setTagCreatorOpen(false)}
                onSaved={(schema) => void handleTagSchemaSaved(schema)}
            />
        </div>
    )
}
