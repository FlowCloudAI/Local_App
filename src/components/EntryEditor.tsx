import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import {Button, MarkdownEditor, RollingBox, Select, TagItem, useAlert} from 'flowcloudai-ui'
import {
    type Category,
    db_create_entry,
    db_create_relation,
    db_delete_relation,
    db_get_entry,
    db_list_entries,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_relations_for_entry,
    db_replace_outgoing_links,
    db_update_entry,
    db_update_relation,
    type Entry,
    type EntryBrief,
    type EntryLink,
    type EntryRelation,
    entryTypeKey,
    type EntryTypeView,
    import_entry_images,
    type TagSchema,
} from '../api'
import {openUrl} from '@tauri-apps/plugin-opener'
import EntryEditorSidebar from './EntryEditorSidebar'
import EntryImageLightbox from './EntryImageLightbox'
import HighLightTagItem from './HighLightTagItem'
import TagCreator from './TagCreator'
import {buildEntryTagsPayload, ensureTypeTargetTagValues, getSchemaDefaultValue} from './entryTagUtils'
import EntryTypeIcon from './project-editor/EntryTypeIcon'
import './EntryEditor.css'
import {
    buildInternalEntryMarkdown,
    buildMarkdownPreviewSource,
    type InternalEntryLink,
    isSafeExternalHref,
    parseInternalEntryHref,
    parseInternalEntryLinks,
    resolveMarkdownAnchor,
} from './utils/entryMarkdown'
import {type EntryImage, getCoverImage, normalizeEntryImages, toEntryImageSrc,} from './utils/entryImage'
import {
    areTagMapsEqual,
    buildAutoVisibleTagSchemaIds,
    getComparableTagValue,
    isSchemaImplantedForType,
    mergeUniqueStringValues,
    normalizeComparableTagValue,
} from './utils/entryTag'
import {
    areRelationDraftsEqual,
    buildRelationDraft,
    hasInvalidRelationDraft,
    resolveRelationPayload,
} from './utils/entryRelation'
import {
    buildEntryPath,
    buildTagValueMap,
    findCategoryDuplicatedEntry,
    formatDate,
    getCategoryName,
    getTextareaCaretOffset,
    normalizeComparableContent,
    normalizeComparableText,
    normalizeComparableType,
    normalizeEntryContent,
    normalizeEntryLookupTitle,
    parseDateValue,
    replaceRange,
    resolveActiveWikiDraft,
} from './utils/entryCommon'
import type {EntryRelationDraft} from "./project-editor/EntryRelationCreator.tsx";

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

type LinkPreviewPosition = {
    top: number
    left: number
}

type WikiPopoverPosition = {
    top: number
    left: number
}

type WikiLinkOption =
    | { kind: 'entry'; id: string; title: string; categoryId: string | null }
    | { kind: 'create'; title: string }

type EntryEditorCache = {
    entry: Entry
    draft: EntryDraft
    editorMode: EditorMode
    relations: EntryRelation[]
    relationDrafts: EntryRelationDraft[]
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
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)
    const [wikiDraft, setWikiDraft] = useState<WikiDraft | null>(null)
    const [activeWikiOptionIndex, setActiveWikiOptionIndex] = useState(0)
    const [creatingLinkedEntry, setCreatingLinkedEntry] = useState(false)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryCache, setEntryCache] = useState<Record<string, Entry>>({})

    const [wikiPopoverPosition, setWikiPopoverPosition] = useState<WikiPopoverPosition>({ top: 16, left: 16 })
    const [projectDataLoading, setProjectDataLoading] = useState(false)
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [entryRelations, setEntryRelations] = useState<EntryRelation[]>([])
    const [relationDrafts, setRelationDrafts] = useState<EntryRelationDraft[]>([])
    const [, setLinksLoading] = useState(false)
    const [linkPreview, setLinkPreview] = useState<LinkPreviewState | null>(null)
    const [linkPreviewPosition, setLinkPreviewPosition] = useState<LinkPreviewPosition>({ top: 16, left: 16 })
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [localTagSchemas, setLocalTagSchemas] = useState<TagSchema[]>(tagSchemas)
    const [pinnedTagSchemaIds, setPinnedTagSchemaIds] = useState<string[]>([])
    const [tagSchemaPickerValue, setTagSchemaPickerValue] = useState<string | undefined>(undefined)
    const wikiDraftRetainTimerRef = useRef<number | null>(null)
    const cursorSyncRafRef = useRef<number | null>(null)
    const pendingCursorSyncRef = useRef<{ value: string; selectionStart: number | null } | null>(null)
    const entryCacheRef = useRef<Record<string, EntryEditorCache>>({})
    const markdownContainerRef = useRef<HTMLDivElement | null>(null)
    const wikiPopoverRef = useRef<HTMLDivElement | null>(null)
    const previewContainerRef = useRef<HTMLDivElement | null>(null)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const wikiOptionRefs = useRef<Record<number, HTMLButtonElement | null>>({})
    const linkPreviewCloseTimerRef = useRef<number | null>(null)
    const linkPreviewAnchorRef = useRef<HTMLAnchorElement | null>(null)
    const prevWikiDraftRef = useRef<WikiDraft | null>(null)
    const onDirtyChangeRef = useRef(onDirtyChange)
    const projectEntriesRef = useRef(projectEntries)
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntryDetailsStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const canSaveRef = useRef(false)
    const saveActionRef = useRef<(() => void) | null>(null)
    const prevTypeRef = useRef<string | null>(null)
    const autoAddedTagSchemaIdsRef = useRef<Set<string>>(new Set())
    projectEntriesRef.current = projectEntries
    onDirtyChangeRef.current = onDirtyChange
    const { showAlert } = useAlert()

    useEffect(() => {
        setLocalTagSchemas(tagSchemas)
    }, [tagSchemas])

    useEffect(() => {
        setPinnedTagSchemaIds([])
        setTagSchemaPickerValue(undefined)
        prevTypeRef.current = null
        autoAddedTagSchemaIdsRef.current = new Set()
    }, [entryId])

    const clearLinkPreviewCloseTimer = useCallback(() => {
        if (linkPreviewCloseTimerRef.current !== null) {
            window.clearTimeout(linkPreviewCloseTimerRef.current)
            linkPreviewCloseTimerRef.current = null
        }
    }, [])

    const closeLinkPreview = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = null
        setLinkPreview(null)
    }, [clearLinkPreviewCloseTimer])

    const scheduleLinkPreviewClose = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewCloseTimerRef.current = window.setTimeout(() => {
            linkPreviewAnchorRef.current = null
            setLinkPreview(null)
            linkPreviewCloseTimerRef.current = null
        }, 90)
    }, [clearLinkPreviewCloseTimer])

    useEffect(() => {
        onDirtyChangeRef.current?.(false)
    }, [entryId])

    useEffect(() => {
        const openEntryIdSet = new Set(openEntryIds)
        entryCacheRef.current = Object.fromEntries(
            Object.entries(entryCacheRef.current).filter(([cachedEntryId]) => openEntryIdSet.has(cachedEntryId)),
        )
    }, [openEntryIds])

    useEffect(() => {
        let cancelled = false
        const cachedState = entryCacheRef.current[entryId]
        setLoading(true)
        setSaving(false)
        setError(null)
        closeLinkPreview()
        setWikiDraft(null)
        setOutgoingLinks([])
        setIncomingLinks([])
        setEntryRelations([])
        setRelationDrafts([])

        if (cachedState) {
            setEntry(cachedState.entry)
            setDraft(cachedState.draft)
            setEditorMode(cachedState.editorMode)
            setEntryRelations(cachedState.relations)
            setRelationDrafts(cachedState.relationDrafts)
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

        setLinksLoading(true)
        Promise.all([
            db_list_outgoing_links(entryId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId).catch(() => [] as EntryRelation[]),
        ])
            .then(([outgoing, incoming, relations]) => {
                if (cancelled) return
                setOutgoingLinks(outgoing)
                setIncomingLinks(incoming)
                setEntryRelations(relations)
                setRelationDrafts(relations.map((relation) => buildRelationDraft(entryId, relation)))
            })
            .finally(() => {
                if (cancelled) return
                setLinksLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [closeLinkPreview, entryId])

    // projectId 变化时重置词条列表状态
    useEffect(() => {
        projectEntriesStatusRef.current = 'idle'
        projectEntryDetailsStatusRef.current = 'idle'
        projectEntriesLoadPromiseRef.current = null
        projectEntriesRef.current = []
        setProjectEntries([])
    }, [projectId])

    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        const initialDraftState = buildDraft(entry)
        const initialVisibleTagSchemaIds = buildAutoVisibleTagSchemaIds(localTagSchemas, initialDraftState.tags, initialDraftState.type)
        setPinnedTagSchemaIds((current) => (current.length === 0 ? initialVisibleTagSchemaIds : current))
    }, [entry, entryId, localTagSchemas])

    const ensureProjectEntryDetailsLoaded = useCallback(async (briefs: EntryBrief[]) => {
        if (!briefs.length || projectEntryDetailsStatusRef.current !== 'idle') return
        projectEntryDetailsStatusRef.current = 'loading'
        try {
            const results = await Promise.all(
                briefs
                    .filter((brief) => brief.id !== entryId)
                    .map(async (brief) => {
                        try {
                            const detail = await db_get_entry(brief.id)
                            return [brief.id, detail] as const
                        } catch {
                            return null
                        }
                    }),
            )
            setEntryCache((current) => ({
                ...current,
                ...Object.fromEntries(results.filter(Boolean) as Array<readonly [string, Entry]>),
            }))
            projectEntryDetailsStatusRef.current = 'loaded'
        } catch {
            projectEntryDetailsStatusRef.current = 'idle'
        }
    }, [entryId])

    // 按需加载：进入编辑模式或需要双链时调用
    const ensureProjectEntriesLoaded = useCallback(async () => {
        if (projectEntriesStatusRef.current === 'loaded') return
        if (projectEntriesLoadPromiseRef.current) return projectEntriesLoadPromiseRef.current

        projectEntriesStatusRef.current = 'loading'
        projectEntriesLoadPromiseRef.current = (async () => {
            setProjectDataLoading(true)
            try {
                const briefs = await db_list_entries({ projectId, limit: 1000, offset: 0 })
                projectEntriesRef.current = briefs
                setProjectEntries(briefs)
                projectEntriesStatusRef.current = 'loaded'
                void ensureProjectEntryDetailsLoaded(briefs)
            } catch {
                projectEntriesStatusRef.current = 'idle'
            } finally {
                setProjectDataLoading(false)
                projectEntriesLoadPromiseRef.current = null
            }
        })()

        return projectEntriesLoadPromiseRef.current
    }, [ensureProjectEntryDetailsLoaded, projectId])

    useEffect(() => {
        void ensureProjectEntriesLoaded()
    }, [ensureProjectEntriesLoaded])

    useEffect(() => {
        return () => {
            if (wikiDraftRetainTimerRef.current) {
                window.clearTimeout(wikiDraftRetainTimerRef.current)
            }
            if (linkPreviewCloseTimerRef.current !== null) {
                window.clearTimeout(linkPreviewCloseTimerRef.current)
            }
            if (cursorSyncRafRef.current !== null) {
                cancelAnimationFrame(cursorSyncRafRef.current)
            }
            pendingCursorSyncRef.current = null
        }
    }, [])

    const updateWikiPopoverPosition = useCallback((textarea?: HTMLTextAreaElement | null, activeDraft?: WikiDraft | null) => {
        const container = markdownContainerRef.current
        const draftToUse = activeDraft ?? prevWikiDraftRef.current
        const input = textarea ?? container?.querySelector('textarea') ?? null
        const popover = wikiPopoverRef.current
        if (!container || !input || !draftToUse || !popover) return

        const containerRect = container.getBoundingClientRect()
        const inputRect = input.getBoundingClientRect()
        const { left, top, lineHeight } = getTextareaCaretOffset(input, draftToUse.end)
        const gap = 10
        const baseLeft = inputRect.left - containerRect.left + left
        const baseTop = inputRect.top - containerRect.top + top
        const maxLeft = Math.max(12, container.clientWidth - popover.offsetWidth - 12)
        const maxTop = Math.max(12, container.clientHeight - popover.offsetHeight - 12)
        const preferBelow = baseTop + lineHeight + gap + popover.offsetHeight <= container.clientHeight - 12
        const nextLeft = Math.min(Math.max(12, baseLeft), maxLeft)
        const nextTop = preferBelow
            ? Math.min(baseTop + lineHeight + gap, maxTop)
            : Math.max(12, baseTop - popover.offsetHeight - gap)

        setWikiPopoverPosition((current) => (
            current.left === nextLeft && current.top === nextTop
                ? current
                : { left: nextLeft, top: nextTop }
        ))
    }, [])

    // 懒加载：链接预览时按需拉取单条词条详情
    useEffect(() => {
        const id = linkPreview?.entryId
        if (!id) return
        let cancelled = false
        void db_get_entry(id)
            .then((detail) => {
                if (!cancelled) {
                    setEntryCache((current) => ({ ...current, [detail.id]: detail }))
                }
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [linkPreview?.entryId])

    useEffect(() => {
        if (!linkPreview) return
        const handleViewportChange = () => closeLinkPreview()
        window.addEventListener('resize', handleViewportChange)
        window.addEventListener('scroll', handleViewportChange, true)
        return () => {
            window.removeEventListener('resize', handleViewportChange)
            window.removeEventListener('scroll', handleViewportChange, true)
        }
    }, [closeLinkPreview, linkPreview])

    const typeOptions = useMemo(
        () => entryTypes.map((entryType) => ({
            key: entryTypeKey(entryType),
            entryType,
        })),
        [entryTypes],
    )
    const builtinTypeOptions = useMemo(
        () => typeOptions.filter(({ entryType }) => entryType.kind === 'builtin'),
        [typeOptions],
    )
    const customTypeOptions = useMemo(
        () => typeOptions
            .filter(({ entryType }) => entryType.kind === 'custom')
            .map(({ key, entryType }) => ({ value: key, label: entryType.name })),
        [typeOptions],
    )

    const trimmedTitle = useMemo(() => normalizeComparableText(draft.title), [draft.title])
    const trimmedSummary = useMemo(() => normalizeComparableText(draft.summary), [draft.summary])
    const normalizedContent = useMemo(() => normalizeComparableContent(draft.content), [draft.content])
    const initialDraft = useMemo(() => (entry ? buildDraft(entry) : null), [entry])
    const initialRelationDrafts = useMemo(
        () => entryRelations.map((relation) => buildRelationDraft(entryId, relation)),
        [entryId, entryRelations],
    )
    const comparableInitial = useMemo(() => {
        if (!initialDraft) return null
        return {
            title: normalizeComparableText(initialDraft.title),
            summary: normalizeComparableText(initialDraft.summary),
            content: normalizeComparableContent(initialDraft.content),
            type: normalizeComparableType(initialDraft.type),
            tags: initialDraft.tags,
            images: initialDraft.images,
        }
    }, [initialDraft])
    const hasRelationChanges = useMemo(
        () => !areRelationDraftsEqual(relationDrafts, initialRelationDrafts),
        [initialRelationDrafts, relationDrafts],
    )
    const hasInvalidRelationDrafts = useMemo(
        () => relationDrafts.some((item) => hasInvalidRelationDraft(item, entryId)),
        [entryId, relationDrafts],
    )
    const hasChanges = Boolean(
        comparableInitial && (
            trimmedTitle !== comparableInitial.title
            || trimmedSummary !== comparableInitial.summary
            || normalizedContent !== comparableInitial.content
            || normalizeComparableType(draft.type) !== comparableInitial.type
            || !areTagMapsEqual(draft.tags, comparableInitial.tags, localTagSchemas)
            || !areImagesEqual(draft.images, comparableInitial.images)
            || hasRelationChanges
        ),
    )
    const canSave = Boolean(entry && trimmedTitle && hasChanges && !hasInvalidRelationDrafts && !loading && !saving)

    useEffect(() => {
        onDirtyChangeRef.current?.(hasChanges)
    }, [hasChanges])

    useEffect(() => {
        if (!entry) return
        if (hasChanges) {
            entryCacheRef.current[entryId] = {
                entry,
                draft,
                editorMode,
                relations: entryRelations,
                relationDrafts,
            }
            return
        }
        delete entryCacheRef.current[entryId]
    }, [draft, editorMode, entry, entryId, entryRelations, hasChanges, relationDrafts])

    const coverImage = useMemo(() => getCoverImage(draft.images), [draft.images])
    const coverSrc = useMemo(() => toEntryImageSrc(coverImage), [coverImage])
    const lightboxImages = useMemo(() => draft.images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [draft.images])

    const filteredLinkSuggestions = useMemo(() => {
        if (!wikiDraft) return []
        const query = normalizeEntryLookupTitle(wikiDraft.query)
        return projectEntries
            .filter((item) => item.id !== entryId)
            .filter((item) => !query || normalizeEntryLookupTitle(item.title).includes(query))
            .slice(0, 8)
    }, [wikiDraft, projectEntries, entryId])

    const hasExactCategorySuggestion = useMemo(() => {
        const query = normalizeEntryLookupTitle(wikiDraft?.query)
        if (!query) return false
        return projectEntries.some((item) => (
            item.id !== entryId
            && (item.category_id ?? null) === (entry?.category_id ?? null)
            && normalizeEntryLookupTitle(item.title) === query
        ))
    }, [wikiDraft, projectEntries, entryId, entry?.category_id])

    const wikiLinkOptions = useMemo<WikiLinkOption[]>(() => {
        const options: WikiLinkOption[] = filteredLinkSuggestions.map((item) => ({
            kind: 'entry',
            id: item.id,
            title: item.title,
            categoryId: item.category_id ?? null,
        }))
        if (!hasExactCategorySuggestion && wikiDraft?.query.trim()) {
            options.push({
                kind: 'create',
                title: wikiDraft.query.trim(),
            })
        }
        return options
    }, [filteredLinkSuggestions, hasExactCategorySuggestion, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) return
        const rafId = requestAnimationFrame(() => updateWikiPopoverPosition())
        return () => cancelAnimationFrame(rafId)
    }, [filteredLinkSuggestions.length, hasExactCategorySuggestion, updateWikiPopoverPosition, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) return
        const handleResize = () => updateWikiPopoverPosition()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [updateWikiPopoverPosition, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) {
            setActiveWikiOptionIndex(0)
            wikiOptionRefs.current = {}
            return
        }
        setActiveWikiOptionIndex((current) => {
            if (wikiLinkOptions.length <= 0) return 0
            return Math.min(current, wikiLinkOptions.length - 1)
        })
    }, [wikiDraft, wikiLinkOptions.length])

    useEffect(() => {
        if (!wikiDraft) return
        if (wikiLinkOptions.length <= 0) return
        const activeElement = wikiOptionRefs.current[activeWikiOptionIndex]
        if (!activeElement) return
        activeElement.scrollIntoView({
            block: 'nearest',
        })
    }, [activeWikiOptionIndex, wikiDraft, wikiLinkOptions.length])

    // 预览源码缓存：draft.content 不变时不重算
    const previewContent = useMemo(() => buildMarkdownPreviewSource(draft.content), [draft.content])

    const backlinks = useMemo(() => {
        const linkedEntryIds = new Set(incomingLinks.map((link) => link.a_id))
        return Object.values(entryCache)
            .filter((item) => item.id !== entryId && linkedEntryIds.has(item.id))
            .sort((left, right) => parseDateValue(right.updated_at as string | null | undefined) - parseDateValue(left.updated_at as string | null | undefined))
            .map((item) => ({
                id: item.id,
                project_id: item.project_id,
                category_id: item.category_id ?? null,
                title: item.title,
                summary: item.summary ?? null,
                type: item.type ?? null,
                cover: null,
                updated_at: String(item.updated_at ?? ''),
                content: item.content,
            }))
    }, [entryCache, entryId, incomingLinks])

    const infoTitle = trimmedTitle || entry?.title || '未命名词条'
    const isBrowseMode = editorMode === 'browse'

    const linkPreviewEntry = useMemo(() => {
        if (!linkPreview) return null
        if (linkPreview.entryId) return entryCache[linkPreview.entryId] ?? null
        const normalizedLinkTitle = normalizeEntryLookupTitle(linkPreview.title)
        return Object.values(entryCache).find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedLinkTitle
        )) ?? null
    }, [entryCache, linkPreview])
    const autoVisibleTagSchemaIds = useMemo(
        () => buildAutoVisibleTagSchemaIds(localTagSchemas, draft.tags, draft.type),
        [draft.tags, draft.type, localTagSchemas],
    )
    const visibleTagSchemaIds = useMemo(
        () => mergeUniqueStringValues([...pinnedTagSchemaIds, ...autoVisibleTagSchemaIds]),
        [autoVisibleTagSchemaIds, pinnedTagSchemaIds],
    )
    const visibleTagSchemaIdSet = useMemo(
        () => new Set(visibleTagSchemaIds),
        [visibleTagSchemaIds],
    )
    const visibleTagSchemas = useMemo(
        () => localTagSchemas.filter((schema) => visibleTagSchemaIdSet.has(schema.id)),
        [localTagSchemas, visibleTagSchemaIdSet],
    )
    const implantedTagSchemaIdSet = useMemo(
        () => new Set(
            visibleTagSchemas
                .filter((schema) => isSchemaImplantedForType(schema, draft.type))
                .map((schema) => schema.id),
        ),
        [draft.type, visibleTagSchemas],
    )
    const availableTagSchemaOptions = useMemo(
        () => localTagSchemas
            .filter((schema) => !visibleTagSchemaIdSet.has(schema.id))
            .map((schema) => ({ value: schema.id, label: schema.name })),
        [localTagSchemas, visibleTagSchemaIdSet],
    )
    const entryPathLabel = useMemo(
        () => buildEntryPath(projectName, categories, entry?.category_id ?? null, infoTitle),
        [projectName, categories, entry?.category_id, infoTitle],
    )
    const browseVisibleTagSchemas = useMemo(
        () => visibleTagSchemas.filter((schema) => (
            implantedTagSchemaIdSet.has(schema.id) || getComparableTagValue(draft.tags, schema) !== null
        )),
        [draft.tags, implantedTagSchemaIdSet, visibleTagSchemas],
    )
    const entryCreatedAtText = formatDate(entry?.['created_at'] as string | null | undefined)
    const entryUpdatedAtText = formatDate(entry?.updated_at as string | null | undefined)
    const coverHintText = isBrowseMode ? '暂无主图' : '点击上传主图'

    useEffect(() => {
        if (!autoVisibleTagSchemaIds.length) return
        setPinnedTagSchemaIds((current) => {
            const next = mergeUniqueStringValues([...current, ...autoVisibleTagSchemaIds])
            return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next
        })
    }, [autoVisibleTagSchemaIds])

    useEffect(() => {
        const prevType = prevTypeRef.current
        const nextType = draft.type
        let workingTags = draft.tags
        const removedSchemaIds: string[] = []

        if (prevType !== null && prevType !== nextType && autoAddedTagSchemaIdsRef.current.size > 0) {
            const schemasToCheck = localTagSchemas.filter((schema) => autoAddedTagSchemaIdsRef.current.has(schema.id))
            let tagsModified = false
            const nextTags = {...workingTags}

            for (const schema of schemasToCheck) {
                if (!isSchemaImplantedForType(schema, nextType)) {
                    const currentValue = getComparableTagValue(workingTags, schema)
                    const defaultValue = getSchemaDefaultValue(schema)

                    if (currentValue === defaultValue || (currentValue === null && defaultValue === null)) {
                        delete nextTags[schema.id]
                        delete nextTags[schema.name]
                        autoAddedTagSchemaIdsRef.current.delete(schema.id)
                        removedSchemaIds.push(schema.id)
                        tagsModified = true
                    }
                }
            }

            if (tagsModified) {
                workingTags = nextTags
            }
        }

        const {tags: ensuredTags, addedSchemaIds} = ensureTypeTargetTagValues(workingTags, localTagSchemas, nextType)

        addedSchemaIds.forEach((id) => autoAddedTagSchemaIdsRef.current.add(id))
        prevTypeRef.current = nextType

        if (ensuredTags !== workingTags || workingTags !== draft.tags) {
            setDraft((current) => ({...current, tags: ensuredTags}))
        }

        if (removedSchemaIds.length > 0) {
            setPinnedTagSchemaIds((current) => current.filter((id) => !removedSchemaIds.includes(id)))
        }
    }, [entryId, localTagSchemas, draft.type, draft.tags])

    const handleSave = useCallback(async () => {
        if (!entry || !canSave) return

        setSaving(true)
        setError(null)

        try {
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, entry.category_id ?? null, trimmedTitle, entry.id)
            if (duplicatedEntry) {
                const message = '当前分类下已存在同名词条，请更换标题。'
                setError(message)
                void showAlert(message, 'warning', 'toast', 1800)
                return
            }

            const updated = await db_update_entry({
                id: entry.id,
                categoryId: entry.category_id ?? null,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                content: normalizedContent === '' ? null : normalizedContent,
                type: draft.type,
                tags: buildEntryTagsPayload(draft.tags, localTagSchemas, entry.tags),
                images: draft.images,
            })

            // 同步出链：将正文中的内部链接替换到 entry_links 表
            const internalLinks = parseInternalEntryLinks(normalizedContent)
            const targetIds: string[] = []
            for (const link of internalLinks) {
                if (link.entryId) {
                    targetIds.push(link.entryId)
                } else {
                    const normalizedTitle = normalizeEntryLookupTitle(link.title)
                    const matched = projectEntriesRef.current.find(
                        (item) => normalizeEntryLookupTitle(item.title) === normalizedTitle,
                    )
                    if (matched) {
                        targetIds.push(matched.id)
                    }
                }
            }
            const uniqueTargetIds = [...new Set(targetIds)]
            const newLinks = await db_replace_outgoing_links(projectId, entry.id, uniqueTargetIds)
            setOutgoingLinks(newLinks)

            const currentRelationMap = new Map(entryRelations.map((relation) => [relation.id, relation]))
            const nextRelationIds = new Set(relationDrafts.map((item) => item.id).filter(Boolean) as string[])

            for (const draftRelation of relationDrafts) {
                if (hasInvalidRelationDraft(draftRelation, entry.id)) {
                    setError('存在未完成的词条关系，请先选择目标词条。')
                    setSaving(false)
                    return
                }

                const payload = resolveRelationPayload(entry.id, draftRelation)
                const existing = draftRelation.id ? currentRelationMap.get(draftRelation.id) : undefined

                if (!existing) {
                    await db_create_relation({
                        projectId,
                        aId: payload.aId,
                        bId: payload.bId,
                        relation: payload.relation,
                        content: payload.content,
                    })
                    continue
                }

                const endpointChanged = existing.a_id !== payload.aId || existing.b_id !== payload.bId
                if (endpointChanged) {
                    await db_delete_relation(existing.id)
                    await db_create_relation({
                        projectId,
                        aId: payload.aId,
                        bId: payload.bId,
                        relation: payload.relation,
                        content: payload.content,
                    })
                    continue
                }

                if (existing.relation !== payload.relation || normalizeComparableText(existing.content ?? '') !== payload.content) {
                    await db_update_relation({
                        id: existing.id,
                        relation: payload.relation,
                        content: payload.content,
                    })
                }
            }

            for (const existingRelation of entryRelations) {
                if (nextRelationIds.has(existingRelation.id)) continue
                await db_delete_relation(existingRelation.id)
            }

            const refreshed = await db_get_entry(updated.id)
            const refreshedRelations = await db_list_relations_for_entry(updated.id)
            setEntry(refreshed)
            setDraft(buildDraft(refreshed))
            setEntryRelations(refreshedRelations)
            setRelationDrafts(refreshedRelations.map((relation) => buildRelationDraft(updated.id, relation)))
            setEntryCache((current) => ({ ...current, [refreshed.id]: refreshed }))
            setProjectEntries((current) => {
                const next = current.map((item) => (
                    item.id === refreshed.id
                        ? {
                            ...item,
                            title: refreshed.title,
                            summary: refreshed.summary ?? null,
                            type: refreshed.type ?? null,
                            updated_at: String(refreshed.updated_at ?? ''),
                        }
                        : item
                ))
                projectEntriesRef.current = next
                return next
            })
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
    }, [entry, canSave, trimmedTitle, trimmedSummary, normalizedContent, draft.type, draft.tags, draft.images, localTagSchemas, projectId, entryRelations, relationDrafts, onTitleChange, onSaved, showAlert])

    useEffect(() => {
        canSaveRef.current = canSave
        saveActionRef.current = () => {
            void handleSave()
        }
    }, [canSave, handleSave])

    useEffect(() => {
        function handleSaveShortcut(event: KeyboardEvent) {
            if (event.defaultPrevented || event.repeat) return
            if (!(event.ctrlKey || event.metaKey)) return
            if (event.key.toLowerCase() !== 's') return
            event.preventDefault()
            if (!canSaveRef.current) return
            saveActionRef.current?.()
        }

        window.addEventListener('keydown', handleSaveShortcut)
        return () => {
            window.removeEventListener('keydown', handleSaveShortcut)
        }
    }, [])

    function applyWikiLink(linkedEntry: { title: string; id: string }) {
        if (!wikiDraft) return
        const inserted = buildInternalEntryMarkdown(linkedEntry.title, linkedEntry.id)
        setDraft((current) => ({
            ...current,
            content: replaceRange(current.content, wikiDraft.start, wikiDraft.end, inserted),
        }))
        setWikiDraft(null)
    }

    async function handleCreateLinkedEntry() {
        const title = wikiDraft?.query.trim()
        if (!title || hasExactCategorySuggestion) return
        setCreatingLinkedEntry(true)
        try {
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, entry?.category_id ?? null, title)
            if (duplicatedEntry) {
                await showAlert('当前分类下已存在同名词条，请直接选择已有词条。', 'warning', 'toast', 1800)
                setActiveWikiOptionIndex(0)
                return
            }

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
            setProjectEntries((current) => {
                const next = [brief, ...current]
                projectEntriesRef.current = next
                return next
            })
            setEntryCache((current) => ({ ...current, [created.id]: created }))
            applyWikiLink({ title: created.title, id: created.id })
            void showAlert('已创建并插入双链', 'success', 'toast', 1000)
        } catch (e) {
            setError(String(e))
        } finally {
            setCreatingLinkedEntry(false)
        }
    }

    function handleWikiOptionCommit(option: WikiLinkOption | undefined) {
        if (!option) return
        if (option.kind === 'entry') {
            applyWikiLink({ title: option.title, id: option.id })
            return
        }
        if (creatingLinkedEntry) return
        void handleCreateLinkedEntry()
    }

    function handleWikiKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
        if (!wikiDraft || !wikiLinkOptions.length) return
        if (event.nativeEvent.isComposing) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current + 1) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current - 1 + wikiLinkOptions.length) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()
            handleWikiOptionCommit(wikiLinkOptions[activeWikiOptionIndex])
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            setWikiDraft(null)
        }
    }

    function handleMarkdownCursorSync(textarea: HTMLTextAreaElement) {
        // 快速检查：不含 [[ 时无需解析，直接清除
        if (!textarea.value.includes('[[')) {
            pendingCursorSyncRef.current = null
            if (prevWikiDraftRef.current !== null) {
                prevWikiDraftRef.current = null
                setWikiDraft(null)
            }
            return
        }
        // RAF 合帧：同一帧内只执行一次，但始终使用最后一次输入快照
        pendingCursorSyncRef.current = {
            value: textarea.value,
            selectionStart: textarea.selectionStart,
        }
        if (cursorSyncRafRef.current !== null) return
        cursorSyncRafRef.current = requestAnimationFrame(() => {
            cursorSyncRafRef.current = null
            const pending = pendingCursorSyncRef.current
            pendingCursorSyncRef.current = null
            if (!pending) return
            const next = resolveActiveWikiDraft(pending.value, pending.selectionStart)
            const prev = prevWikiDraftRef.current
            const changed = next?.query !== prev?.query || next?.start !== prev?.start || next?.end !== prev?.end
            if (changed) {
                prevWikiDraftRef.current = next
                setWikiDraft(next)
                if (next) {
                    updateWikiPopoverPosition(textarea, next)
                }
            }
        })
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
            const importedImages = await import_entry_images(projectId, paths)
            setDraft((current) => {
                const nextImages = [...current.images]
                importedImages.forEach((image, index) => {
                    nextImages.push({
                        ...image,
                        alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${nextImages.length + 1}`),
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
        setLightboxIndex((current) => Math.min(current, Math.max(0, draft.images.length - 2)))
    }

    function findProjectEntry(link: InternalEntryLink): EntryBrief | undefined {
        if (link.entryId) {
            const targetById = projectEntriesRef.current.find((item) => item.id === link.entryId)
            if (targetById) return targetById
        }
        const normalizedTitle = normalizeEntryLookupTitle(link.title)
        if (!normalizedTitle) return undefined
        return projectEntriesRef.current.find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedTitle
        ))
    }

    function handleOpenLinkedEntry(link: InternalEntryLink) {
        const target = findProjectEntry(link)
        if (!target) {
            setLinkPreview({ title: link.title, entryId: null })
            return
        }
        onOpenEntry?.({ id: target.id, title: target.title })
    }

    function resolveEntryAnchor(target: EventTarget | null): HTMLAnchorElement | null {
        const anchor = resolveMarkdownAnchor(target)
        if (!anchor) return null
        const href = anchor.getAttribute('href') ?? ''
        return parseInternalEntryHref(href, anchor.textContent ?? '') ? anchor : null
    }

    function getEntryLinkFromAnchor(anchor: HTMLAnchorElement): InternalEntryLink | null {
        const href = anchor.getAttribute('href') ?? ''
        return parseInternalEntryHref(href, anchor.textContent ?? '')
    }

    function updateLinkPreviewPosition(anchor: HTMLAnchorElement) {
        const gap = 12
        const viewportPadding = 12
        const anchorRect = anchor.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const panelWidth = Math.min(320, Math.max(260, viewportWidth - viewportPadding * 2))
        const panelHeight = 260
        const preferRight = anchorRect.right + gap + panelWidth <= viewportWidth - viewportPadding
        const nextLeft = preferRight
            ? anchorRect.right + gap
            : Math.max(viewportPadding, anchorRect.left - panelWidth - gap)
        const preferBelow = anchorRect.bottom + gap + panelHeight <= viewportHeight - viewportPadding
        const centeredTop = anchorRect.top + anchorRect.height / 2 - panelHeight / 2
        const nextTop = preferBelow
            ? anchorRect.bottom + gap
            : Math.min(
                Math.max(viewportPadding, centeredTop),
                Math.max(viewportPadding, viewportHeight - panelHeight - viewportPadding),
            )

        setLinkPreviewPosition((current) => (
            current.left === nextLeft && current.top === nextTop
                ? current
                : { left: nextLeft, top: nextTop }
        ))
    }

    function openLinkPreview(anchor: HTMLAnchorElement, link: InternalEntryLink) {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = anchor
        updateLinkPreviewPosition(anchor)
        void ensureProjectEntriesLoaded().then(() => {
            if (linkPreviewAnchorRef.current !== anchor) return
            const target = findProjectEntry(link)
            setLinkPreview({ title: target?.title ?? link.title, entryId: target?.id ?? null })
        })
    }

    function handleAddVisibleTagSchema(schemaId: string) {
        if (!schemaId) return
        setPinnedTagSchemaIds((current) => (current.includes(schemaId) ? current : [...current, schemaId]))
        setTagSchemaPickerValue(undefined)
    }

    async function handleTagSchemaSaved(schema: TagSchema) {
        const nextSchemas = [...localTagSchemas, schema]
        setLocalTagSchemas(nextSchemas)
        setPinnedTagSchemaIds((current) => (current.includes(schema.id) ? current : [...current, schema.id]))
        setTagSchemaPickerValue(undefined)
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
            <RollingBox className="entry-editor-page__scroll" thumbSize="thin">
                <div className="entry-editor-shell">
                <section className={`entry-editor-workspace${editorMode === 'edit' ? ' is-editing' : ''}`}>
                    <div className="entry-editor-workspace__header">
                        <div className="entry-editor-workspace__toolbar">
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
                        <span className="entry-editor-workspace__meta">
                            {editorMode === 'edit'
                                ? (projectDataLoading ? '正在索引项目词条…' : `${projectEntries.length} 个词条可用于双链联想`)
                                : '单击双链查看预览，双击或按钮可在新页签打开。'}
                        </span>
                    </div>

                    <div className="entry-editor-workspace__body">
                        <div className="entry-editor-meta-layout">
                            <div className="entry-editor-cover-panel">
                                <button
                                    type="button"
                                    className={`entry-editor-cover ${coverSrc ? 'has-image' : ''}`}
                                    onClick={() => {
                                        if (lightboxImages.length) {
                                            setLightboxIndex(Math.max(0, lightboxImages.findIndex((image) => image.is_cover)))
                                            setLightboxOpen(true)
                                        } else if (!isBrowseMode) {
                                            void handleUploadImages()
                                        }
                                    }}
                                >
                                    {coverSrc ? (
                                        <img src={coverSrc} alt={coverImage?.alt || infoTitle} className="entry-editor-cover__image" />
                                    ) : (
                                        <div className="entry-editor-cover__placeholder">
                                            <span className="entry-editor-cover__mark">{infoTitle[0] ?? '词'}</span>
                                            <span className="entry-editor-cover__hint">{coverHintText}</span>
                                        </div>
                                    )}
                                </button>

                                <div className="entry-editor-cover__toolbar">
                                    {!isBrowseMode && (
                                        <Button variant="outline" size="sm" onClick={() => void handleUploadImages()}>
                                            添加图片
                                        </Button>
                                    )}
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
                                    {isBrowseMode ? (
                                        <div className="entry-editor-readonly-title">{infoTitle}</div>
                                    ) : (
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
                                    )}
                                </div>

                                <div className="entry-editor-meta-panel__section">
                                    <label className="entry-editor-field-label">摘要</label>
                                    {isBrowseMode ? (
                                        <div className={`entry-editor-readonly-summary${trimmedSummary ? '' : ' is-empty'}`}>
                                            {trimmedSummary || '暂无摘要'}
                                        </div>
                                    ) : (
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
                                    )}
                                </div>

                                <div className="entry-editor-meta-panel__section">
                                    <div className="entry-editor-field-label-row">
                                        <label className="entry-editor-field-label">词条类型</label>
                                        {!isBrowseMode && <span className="entry-editor-field-note">切换后会同步影响植入标签的重点显示</span>}
                                    </div>
                                    {isBrowseMode ? (
                                        <div className="entry-editor-type-grid">
                                            {draft.type ? (
                                                (() => {
                                                    const selectedType = typeOptions.find(({ key }) => key === draft.type)
                                                    return selectedType ? (
                                                        <span
                                                            className="entry-editor-type-chip active is-readonly"
                                                            style={{ '--entry-editor-chip-color': selectedType.entryType.color } as CSSProperties}
                                                        >
                                                            <EntryTypeIcon entryType={selectedType.entryType} className="entry-editor-type-chip__icon" />
                                                            <span>{selectedType.entryType.name}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="entry-editor-type-chip is-readonly">未设置</span>
                                                    )
                                                })()
                                            ) : (
                                                <span className="entry-editor-type-chip is-readonly">未设置</span>
                                            )}
                                        </div>
                                    ) : (
                                        <>
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
                                                        className="entry-editor-select"
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
                                        </>
                                    )}
                                </div>
                                <div className="entry-editor-meta-panel__section">
                                    <div className="entry-editor-field-label-row">
                                        <label className="entry-editor-field-label">标签</label>
                                        {!isBrowseMode && (
                                            <div className="entry-editor-tag-actions">
                                                {availableTagSchemaOptions.length > 0 && (
                                                    <div className="entry-editor-tag-picker">
                                                        <Select
                                                            className="entry-editor-select"
                                                            options={availableTagSchemaOptions}
                                                            value={tagSchemaPickerValue}
                                                            onChange={(value) => {
                                                                if (typeof value !== 'string') return
                                                                handleAddVisibleTagSchema(value)
                                                            }}
                                                            placeholder="添加已有标签"
                                                            searchable
                                                        />
                                                    </div>
                                                )}
                                                <Button variant="ghost" size="sm" onClick={() => setTagCreatorOpen(true)}>
                                                    + 新建标签
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="entry-editor-field-note">
                                        {draft.type
                                            ? '当前词条类型的植入标签会重点显示；切换类型后，原有标签只会取消强调，不会被删除。'
                                            : '未设置词条类型时，仅显示已添加的标签。'}
                                    </div>
                                    {localTagSchemas.length === 0 ? (
                                        <div className="entry-editor-empty-tip">当前项目还没有标签定义，先创建一个再给词条填写。</div>
                                    ) : isBrowseMode ? (
                                        browseVisibleTagSchemas.length > 0 ? (
                                            <div className="entry-editor-tags-grid entry-editor-tags-grid--browse">
                                                {browseVisibleTagSchemas.map((schema) => {
                                                    const value = getComparableTagValue(draft.tags, schema)
                                                    const isImplanted = implantedTagSchemaIdSet.has(schema.id)
                                                    return (
                                                        <div
                                                            key={`${entryId}-${schema.id}`}
                                                            className="entry-editor-tag-card"
                                                        >
                                                            {isImplanted ? (
                                                                <HighLightTagItem
                                                                    schema={{
                                                                        id: schema.id,
                                                                        name: schema.name,
                                                                        type: schema.type as 'number' | 'string' | 'boolean',
                                                                        range_min: schema.range_min ?? null,
                                                                        range_max: schema.range_max ?? null,
                                                                    }}
                                                                    value={value}
                                                                    implanted
                                                                    mode="show"
                                                                />
                                                            ) : (
                                                                <TagItem
                                                                    schema={{
                                                                        id: schema.id,
                                                                        name: schema.name,
                                                                        type: schema.type as 'number' | 'string' | 'boolean',
                                                                        range_min: schema.range_min ?? null,
                                                                        range_max: schema.range_max ?? null,
                                                                    }}
                                                                    value={value ?? undefined}
                                                                    mode="show"
                                                                />
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ) : (
                                            <div className="entry-editor-empty-tip">当前词条还没有标签值。</div>
                                        )
                                    ) : (
                                        visibleTagSchemas.length > 0 ? (
                                            <div className="entry-editor-tags-grid entry-editor-tags-grid--edit">
                                                {visibleTagSchemas.map((schema) => (
                                                    <div
                                                        key={`${entryId}-${schema.id}`}
                                                        className="entry-editor-tag-card"
                                                    >
                                                        {implantedTagSchemaIdSet.has(schema.id) ? (
                                                            <HighLightTagItem
                                                                schema={{
                                                                    id: schema.id,
                                                                    name: schema.name,
                                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                                    range_min: schema.range_min ?? null,
                                                                    range_max: schema.range_max ?? null,
                                                                }}
                                                                value={draft.tags[schema.id] ?? draft.tags[schema.name] ?? null}
                                                                implanted
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
                                                        ) : (
                                                            <TagItem
                                                                schema={{
                                                                    id: schema.id,
                                                                    name: schema.name,
                                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                                    range_min: schema.range_min ?? null,
                                                                    range_max: schema.range_max ?? null,
                                                                }}
                                                                value={draft.tags[schema.id] ?? draft.tags[schema.name] ?? undefined}
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
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="entry-editor-empty-tip">当前词条还没有已添加标签，可从已有标签中选择，或新建一个标签。</div>
                                        )
                                    )}
                                    <div className="entry-editor-entry-meta">
                                        <span>路径：{entryPathLabel}</span>
                                        <span>分类：{getCategoryName(categories, entry?.category_id ?? null)}</span>
                                        <span>创建于 {entryCreatedAtText}</span>
                                        <span>更新于 {entryUpdatedAtText}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        {editorMode === 'edit' ? (
                            <div className="entry-editor-markdown">
                                <div ref={markdownContainerRef} className="entry-editor-markdown-anchor">
                                    <MarkdownEditor
                                        key={entryId}
                                        value={draft.content}
                                        onChange={(value) => setDraft((current) => (
                                            current.content === value
                                                ? current
                                                : { ...current, content: value }
                                        ))}
                                        minHeight={720}
                                        placeholder="在这里写正文。输入 [[ 可以快速插入双链。"
                                        textareaProps={{
                                            onKeyDown: (event) => handleWikiKeyDown(event),
                                            onKeyUp: (event) => handleMarkdownCursorSync(event.currentTarget),
                                            onClick: (event) => handleMarkdownCursorSync(event.currentTarget),
                                            onSelect: (event) => handleMarkdownCursorSync(event.currentTarget),
                                            onScroll: (event) => updateWikiPopoverPosition(event.currentTarget as unknown as HTMLTextAreaElement),
                                            onBlur: () => {
                                                if (wikiDraftRetainTimerRef.current) {
                                                    window.clearTimeout(wikiDraftRetainTimerRef.current)
                                                }
                                                wikiDraftRetainTimerRef.current = window.setTimeout(() => setWikiDraft(null), 120)
                                            },
                                        }}
                                    />

                                    {wikiDraft && (
                                        <div
                                            ref={wikiPopoverRef}
                                            className="entry-editor-wikilink-popover"
                                            style={{
                                                top: `${wikiPopoverPosition.top}px`,
                                                left: `${wikiPopoverPosition.left}px`,
                                            }}
                                        >
                                            <div className="entry-editor-wikilink-popover__header">
                                                <span>插入双链</span>
                                                <span className="entry-editor-wikilink-popover__query">
                                                    {wikiDraft.query || '继续输入词条名…'}
                                                </span>
                                            </div>

                                            <div className="entry-editor-wikilink-popover__list">
                                                {wikiLinkOptions.map((option, optionIndex) => (
                                                    option.kind === 'entry' ? (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            className={`entry-editor-wikilink-option${optionIndex === activeWikiOptionIndex ? ' is-active' : ''}`}
                                                            ref={(element) => {
                                                                wikiOptionRefs.current[optionIndex] = element
                                                            }}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onMouseEnter={() => setActiveWikiOptionIndex(optionIndex)}
                                                            onClick={() => handleWikiOptionCommit(option)}
                                                        >
                                                            <span className="entry-editor-wikilink-option__title">{option.title}</span>
                                                            <span className="entry-editor-wikilink-option__meta">
                                                                {getCategoryName(categories, option.categoryId)}
                                                            </span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            key={`create-${option.title}`}
                                                            type="button"
                                                            className={`entry-editor-wikilink-option is-create${optionIndex === activeWikiOptionIndex ? ' is-active' : ''}`}
                                                            ref={(element) => {
                                                                wikiOptionRefs.current[optionIndex] = element
                                                            }}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onMouseEnter={() => setActiveWikiOptionIndex(optionIndex)}
                                                            onClick={() => handleWikiOptionCommit(option)}
                                                            disabled={creatingLinkedEntry}
                                                        >
                                                            <span className="entry-editor-wikilink-option__title">
                                                                {creatingLinkedEntry ? '创建中…' : `创建新词条：${option.title}`}
                                                            </span>
                                                            <span className="entry-editor-wikilink-option__meta">
                                                                创建后会立即插入双链
                                                            </span>
                                                        </button>
                                                    )
                                                ))}

                                                {!wikiLinkOptions.length && (hasExactCategorySuggestion || !wikiDraft.query.trim()) && (
                                                    <div className="entry-editor-wikilink-empty">
                                                        {wikiDraft.query.trim() ? '没有更多匹配项' : '继续输入词条名以搜索'}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div
                                ref={previewContainerRef}
                                className="entry-editor-preview"
                                onClick={(e) => {
                                    const anchor = resolveMarkdownAnchor(e.target)
                                    if (!anchor) return
                                    e.preventDefault()
                                    const href = anchor.getAttribute('href') ?? ''
                                    const internalLink = getEntryLinkFromAnchor(anchor)
                                    if (internalLink) {
                                        void ensureProjectEntriesLoaded().then(() => {
                                            handleOpenLinkedEntry(internalLink)
                                        })
                                        return
                                    }
                                    if (isSafeExternalHref(href)) {
                                        void openUrl(href).catch((error) => {
                                            console.error('open external link failed', error)
                                            void showAlert('打开链接失败', 'error', 'toast', 1500)
                                        })
                                        return
                                    }
                                    void showAlert('无效链接，已阻止跳转', 'warning', 'toast', 1500)
                                }}
                                onMouseOver={(e) => {
                                    const anchor = resolveEntryAnchor(e.target)
                                    if (!anchor) return
                                    const internalLink = getEntryLinkFromAnchor(anchor)
                                    if (!internalLink) return
                                    if (linkPreviewAnchorRef.current === anchor) {
                                        clearLinkPreviewCloseTimer()
                                        updateLinkPreviewPosition(anchor)
                                        return
                                    }
                                    openLinkPreview(anchor, internalLink)
                                }}
                                onMouseOut={(e) => {
                                    const anchor = resolveEntryAnchor(e.target)
                                    if (!anchor) return
                                    const relatedTarget = e.relatedTarget
                                    if (
                                        relatedTarget instanceof Node
                                        && (anchor.contains(relatedTarget) || linkPreviewPanelRef.current?.contains(relatedTarget))
                                    ) {
                                        return
                                    }
                                    scheduleLinkPreviewClose()
                                }}
                                onScroll={closeLinkPreview}
                            >
                                <MarkdownEditor
                                    mode="preview"
                                    value={previewContent}
                                    onChange={() => {}}
                                    background={"transparent"}
                                    autoHeight
                                />

                                {linkPreview && (
                                    <div
                                        ref={linkPreviewPanelRef}
                                        className="entry-editor-link-preview"
                                        style={{
                                            top: `${linkPreviewPosition.top}px`,
                                            left: `${linkPreviewPosition.left}px`,
                                        }}
                                        onMouseEnter={clearLinkPreviewCloseTimer}
                                        onMouseLeave={(e) => {
                                            const relatedTarget = e.relatedTarget
                                            if (
                                                relatedTarget instanceof Node
                                                && linkPreviewAnchorRef.current?.contains(relatedTarget)
                                            ) {
                                                return
                                            }
                                            scheduleLinkPreviewClose()
                                        }}
                                    >
                                        <div className="entry-editor-link-preview__header">
                                            <span>双链预览</span>
                                            <span>单击相关词条以进入</span>
                                        </div>

                                        {linkPreviewEntry ? (
                                            <div className="entry-editor-link-preview__body">
                                                <div className="entry-editor-link-preview__media">
                                                    {(() => {
                                                        const previewCoverSrc = toEntryImageSrc(getCoverImage(normalizeEntryImages(linkPreviewEntry.images)))
                                                        return previewCoverSrc ? (
                                                            <img src={previewCoverSrc} alt={linkPreviewEntry.title} />
                                                        ) : (
                                                            <div className="entry-editor-link-preview__placeholder">
                                                                {linkPreviewEntry.title[0] ?? '词'}
                                                            </div>
                                                        )
                                                    })()}
                                                </div>
                                                <div className="entry-editor-link-preview__content">
                                                    <h3>{linkPreviewEntry.title}</h3>
                                                    <p className="entry-editor-link-preview__summary">
                                                        {linkPreviewEntry.summary || '暂无摘要'}
                                                    </p>
                                                    <p className="entry-editor-link-preview__hint">单击相关词条以进入</p>
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

                    <EntryEditorSidebar
                        entryId={entryId}
                        entry={entry}
                        editorMode={editorMode}
                        saving={saving}
                        projectDataLoading={projectDataLoading}
                        relationDrafts={relationDrafts}
                        outgoingLinks={outgoingLinks}
                        backlinks={backlinks}
                        projectEntries={projectEntries}
                        entryCache={entryCache}
                        categories={categories}
                        onOpenEntry={onOpenEntry}
                        onRelationDraftsChange={setRelationDrafts}
                    />

                    {(error || loading) && (
                        <div className={`entry-editor-feedback ${error ? 'is-error' : ''}`}>
                            {error || '正在加载词条…'}
                        </div>
                    )}
                </div>
            </RollingBox>

            <EntryImageLightbox
                open={lightboxOpen}
                images={lightboxImages}
                currentIndex={lightboxIndex}
                infoTitle={infoTitle}
                onClose={() => setLightboxOpen(false)}
                onIndexChange={setLightboxIndex}
                onSetCover={handleSetCover}
                onRemove={handleRemoveImage}
                onAddImage={() => void handleUploadImages()}
            />

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
