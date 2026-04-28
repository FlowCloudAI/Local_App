import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {listen} from '@tauri-apps/api/event'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, MarkdownEditor, type MarkdownEditorRef, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_generate_entry_summary,
    ai_list_plugins,
    type Category,
    db_create_entry,
    db_create_relation,
    db_delete_entry,
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
    ENTRY_DELETED,
    ENTRY_UPDATED,
    type EntryBrief,
    type EntryDeletedEvent,
    type EntryLink,
    type EntryRelation,
    entryTypeKey,
    type EntryTypeView,
    type EntryUpdatedEvent,
    import_entry_images,
    type PluginInfo,
    setting_get_settings,
    type TagSchema,
} from '../../../api'
import {openUrl} from '@tauri-apps/plugin-opener'
import EntryEditorSidebar from './EntryEditorSidebar'
import EntryImageLightbox from './EntryImageLightbox'
import TagCreator from './TagCreator'
import EntryEditorMetaPanel from './EntryEditorMetaPanel'
import EntryImageAddModal from './EntryImageAddModal'
import EntryEditorWikiLink from './EntryEditorWikiLink'
import EntryEditorLinkPreview from './EntryEditorLinkPreview'
import useWikiLink from '../hooks/useWikiLink'
import useLinkPreview from '../hooks/useLinkPreview'
import useEntryTags from '../hooks/useEntryTags'
import {buildEntryTagsPayload,} from './entryTagUtils'

import './EntryEditor.css'
import {
    buildMarkdownPreviewSource,
    type InternalEntryLink,
    isSafeExternalHref,
    parseInternalEntryHref,
    parseInternalEntryLinks,
    resolveMarkdownAnchor,
} from '../lib/entryMarkdown'
import {type EntryImage, normalizeEntryImages, toEntryImageSrc,} from '../lib/entryImage'
import {areTagMapsEqual, buildAutoVisibleTagSchemaIds,} from '../lib/entryTag'
import {
    areRelationDraftsEqual,
    buildRelationDraft,
    hasInvalidRelationDraft,
    resolveRelationPayload,
} from '../lib/entryRelation'
import {useUndoRedo} from '../../../shared/hooks/useUndoRedo'
import {
    buildTagValueMap,
    findCategoryDuplicatedEntry,
    normalizeComparableContent,
    normalizeComparableText,
    normalizeComparableType,
    normalizeEntryContent,
    normalizeEntryLookupTitle,
    parseDateValue,
} from '../lib/entryCommon'
import {buildTtsVoiceOptions, resolvePreferredTtsPlugin} from '../../plugins/ttsVoice'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelationCreator.tsx'

type EditorMode = 'edit' | 'browse'
type SaveTrigger = 'manual' | 'auto'
type EntryEditorCache = {
    entry: Entry
    draft: EntryDraft
    editorMode: EditorMode
    relations: EntryRelation[]
    relationDrafts: EntryRelationDraft[]
    lastSuccessfulSaveAt: number
}

interface EntryEditorProps {
    entryId: string
    projectId: string
    projectName: string
    aiPluginId?: string | null
    aiModel?: string | null
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    openEntryIds?: string[]
    initialEditorMode?: EditorMode
    onOpenEntry?: (entry: { id: string; title: string }) => void
    onTitleChange?: (entry: Entry) => void | Promise<void>
    onSaved?: (entry: Entry) => void | Promise<void>
    onTagSchemasChange?: (schemas: TagSchema[]) => void | Promise<void>
    onBack?: () => void | Promise<void>
    onDelete?: () => void | Promise<void>
    onDirtyChange?: (dirty: boolean) => void
    onStartCharacterChat?: (entry: Entry) => void | Promise<void>
}

interface EntryDraft {
    title: string
    summary: string
    content: string
    type: string | null
    tags: Record<string, string | number | boolean | null>
    images: EntryImage[]
}

interface EditorHistory {
    draft: EntryDraft
    relationDrafts: EntryRelationDraft[]
}

const AUTO_SAVE_CHECK_INTERVAL_MS = 1000
const AUTO_SAVE_FAILURE_COOLDOWN_MS = 10000
const AUTO_SAVE_SECONDS = 30

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
                                        aiPluginId = null,
                                        aiModel = null,
                                        categories,
                                        entryTypes,
                                        tagSchemas,
                                        openEntryIds = [],
                                        initialEditorMode = 'browse',
                                        onOpenEntry,
                                        onTitleChange,
                                        onSaved,
                                        onTagSchemasChange,
                                        onBack,
                                        onDelete,
                                        onDirtyChange,
                                        onStartCharacterChat,
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
    const autoSaveSeconds = AUTO_SAVE_SECONDS
    const [editorFontSize, setEditorFontSize] = useState(14)
    const [autoSaveStatus, setAutoSaveStatus] = useState('')
    const [generatingSummary, setGeneratingSummary] = useState(false)
    const [editorMode, setEditorMode] = useState<EditorMode>(initialEditorMode)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryCache, setEntryCache] = useState<Record<string, Entry>>({})

    const [projectDataLoading, setProjectDataLoading] = useState(false)
    const [ttsVoiceOptions, setTtsVoiceOptions] = useState<{ value: string; label: string }[]>([
        {value: '', label: '请先在设置中选择默认 TTS 插件'},
    ])
    const [ttsVoiceSelectable, setTtsVoiceSelectable] = useState(false)
    const [ttsVoicePluginName, setTtsVoicePluginName] = useState<string | null>(null)
    const [ttsVoiceHint, setTtsVoiceHint] = useState('请先在设置中选择默认 TTS 插件')
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [entryRelations, setEntryRelations] = useState<EntryRelation[]>([])
    const [relationDrafts, setRelationDrafts] = useState<EntryRelationDraft[]>([])
    const [, setLinksLoading] = useState(false)
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [imageAddModalOpen, setImageAddModalOpen] = useState(false)
    const entryCacheRef = useRef<Record<string, EntryEditorCache>>({})
    const markdownContainerRef = useRef<HTMLDivElement | null>(null)
    const wikiPopoverRef = useRef<HTMLDivElement | null>(null)
    const previewContainerRef = useRef<HTMLDivElement | null>(null)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const onDirtyChangeRef = useRef(onDirtyChange)
    const projectEntriesRef = useRef(projectEntries)
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntryDetailsStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const canSaveRef = useRef(false)
    const saveActionRef = useRef<(() => void) | null>(null)
    const editorRef = useRef<MarkdownEditorRef>(null)
    const isApplyingHistoryRef = useRef(false)
    const historyInitializedRef = useRef<string | null>(null)
    const entryRef = useRef<Entry | null>(null)
    const hasChangesRef = useRef(false)
    const onSavedRef = useRef(onSaved)
    const onTitleChangeRef = useRef(onTitleChange)
    const lastSuccessfulSaveAtRef = useRef(0)
    const lastAutoSaveAttemptAtRef = useRef(0)

    const undoRedo = useUndoRedo<EditorHistory>({draft, relationDrafts: []})
    const {showAlert} = useAlert()

    useEffect(() => {
        lastSuccessfulSaveAtRef.current = Date.now()
    }, [])

    useEffect(() => {
        projectEntriesRef.current = projectEntries
        onDirtyChangeRef.current = onDirtyChange
        entryRef.current = entry
        onSavedRef.current = onSaved
        onTitleChangeRef.current = onTitleChange
    }, [projectEntries, onDirtyChange, entry, onSaved, onTitleChange])

    useEffect(() => {
        let cancelled = false

        void setting_get_settings()
            .then((settings) => {
                if (cancelled) return
                setEditorFontSize(settings.editor_font_size ?? 14)
            })
            .catch((loadError) => {
                console.error('加载编辑器字体设置失败', loadError)
            })

        function handleFontSizeChange(event: Event) {
            const fontSize = (event as CustomEvent<{ fontSize: number }>).detail.fontSize
            setEditorFontSize(fontSize ?? 14)
        }

        window.addEventListener('fc:editor-font-size-change', handleFontSizeChange)

        return () => {
            cancelled = true
            window.removeEventListener('fc:editor-font-size-change', handleFontSizeChange)
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        void Promise.all([
            setting_get_settings(),
            ai_list_plugins('tts'),
        ])
            .then(([settings, plugins]) => {
                if (cancelled) return

                const selectedPlugin = resolvePreferredTtsPlugin(plugins as PluginInfo[], settings.tts.plugin_id)
                setTtsVoicePluginName(selectedPlugin?.name ?? null)
                setTtsVoiceOptions(buildTtsVoiceOptions(selectedPlugin, '跟随全局默认'))

                if (!selectedPlugin) {
                    setTtsVoiceSelectable(false)
                    setTtsVoiceHint('当前没有可用的 TTS 插件')
                    return
                }

                if (selectedPlugin.supported_voices.length === 0) {
                    setTtsVoiceSelectable(false)
                    setTtsVoiceHint(`插件「${selectedPlugin.name}」未声明可选音色`)
                    return
                }

                setTtsVoiceSelectable(true)
                if (settings.tts.plugin_id) {
                    setTtsVoiceHint(`使用「${selectedPlugin.name}」提供的音色列表`)
                    return
                }
                setTtsVoiceHint(`当前未设置默认 TTS 插件，暂按「${selectedPlugin.name}」的音色列表展示`)
            })
            .catch((loadError) => {
                if (cancelled) return
                console.error('加载 TTS 音色列表失败', loadError)
                setTtsVoiceSelectable(false)
                setTtsVoicePluginName(null)
                setTtsVoiceOptions([{value: '', label: '音色列表加载失败'}])
                setTtsVoiceHint('音色列表加载失败')
            })

        return () => {
            cancelled = true
        }
    }, [])

    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: draft.tags,
        draftType: draft.type,
        entryId,
        onTagsChange: (nextTags) => setDraft((current) => (
            areTagMapsEqual(current.tags, nextTags, tagSchemas) ? current : {...current, tags: nextTags}
        )),
    })

    const wikiLink = useWikiLink({
        entryId,
        entryCategoryId: entry?.category_id,
        projectEntries,
        content: draft.content,
        containerRef: markdownContainerRef,
        popoverRef: wikiPopoverRef,
        onContentChange: (nextContent) => setDraft((current) => (
            current.content === nextContent ? current : {...current, content: nextContent}
        )),
        onCreateEntry: async (title) => {
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, entry?.category_id ?? null, title)
            if (duplicatedEntry) {
                await showAlert('当前分类下已存在同名词条，请直接选择已有词条。', 'warning', 'toast', 1800)
                return null
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
            setEntryCache((current) => ({...current, [created.id]: created}))
            return {id: created.id, title: created.title}
        },
        onShowAlert: (message, type) => {
            void showAlert(message, type, 'toast', 1000)
        },
    })

    const linkPreview = useLinkPreview({
        entryCache,
        projectEntries,
        ensureProjectEntriesLoaded: () => ensureProjectEntriesLoaded(),
        onOpenEntry,
    })


    useEffect(() => {
        onDirtyChangeRef.current?.(false)
        setAutoSaveStatus('')
        lastAutoSaveAttemptAtRef.current = 0
        lastSuccessfulSaveAtRef.current = Date.now()
        // Reset history tracking when switching entries
        historyInitializedRef.current = null
        undoRedo.reset({
            draft: {title: '', summary: '', content: '', type: null, tags: {}, images: []},
            relationDrafts: []
        })
    }, [entryId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        linkPreview.closeLinkPreview()
        wikiLink.setWikiDraft?.(null)
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
            lastSuccessfulSaveAtRef.current = cachedState.lastSuccessfulSaveAt
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
                setEditorMode(initialEditorMode)
                lastSuccessfulSaveAtRef.current = Date.now()
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkPreview.closeLinkPreview, wikiLink.setWikiDraft, entryId])

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
        const initialVisibleTagSchemaIds = buildAutoVisibleTagSchemaIds(entryTags.localTagSchemas, initialDraftState.tags, initialDraftState.type)
        entryTags.setPinnedTagSchemaIds((current) => (current.length === 0 ? initialVisibleTagSchemaIds : current))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry, entryId, entryTags.localTagSchemas, entryTags.setPinnedTagSchemaIds])

    // Initialize history once per entry load (fires when both entry and relations are ready)
    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        if (historyInitializedRef.current === entryId) return
        historyInitializedRef.current = entryId
        undoRedo.reset({draft, relationDrafts})
    }, [entry, entryId, draft, relationDrafts]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-push history snapshot on draft/relation changes (debounced to avoid per-keystroke entries)
    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        if (historyInitializedRef.current !== entryId) return
        if (isApplyingHistoryRef.current) {
            isApplyingHistoryRef.current = false
            return
        }
        undoRedo.pushDebounced({draft, relationDrafts})
    }, [draft, relationDrafts]) // eslint-disable-line react-hooks/exhaustive-deps

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
                const briefs = await db_list_entries({projectId, limit: 1000, offset: 0})
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


    const typeOptions = useMemo(
        () => entryTypes.map((entryType) => ({
            key: entryTypeKey(entryType),
            entryType,
        })),
        [entryTypes],
    )
    useMemo(
        () => typeOptions.filter(({entryType}) => entryType.kind === 'builtin'),
        [typeOptions],
    );
    useMemo(
        () => typeOptions
            .filter(({entryType}) => entryType.kind === 'custom')
            .map(({key, entryType}) => ({value: key, label: entryType.name})),
        [typeOptions],
    );
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
            || !areTagMapsEqual(draft.tags, comparableInitial.tags, entryTags.localTagSchemas)
            || !areImagesEqual(draft.images, comparableInitial.images)
            || hasRelationChanges
        ),
    )
    const canSave = Boolean(entry && trimmedTitle && hasChanges && !hasInvalidRelationDrafts && !loading && !saving)

    const handleGenerateSummary = useCallback(async () => {
        if (generatingSummary || loading || saving) return
        if (!aiPluginId) {
            await showAlert('当前还没有可用的 AI 插件，请先在右侧 AI 面板选择或配置模型。', 'warning', 'toast', 2200)
            return
        }

        const fallbackTitle = normalizeComparableText(draft.title) || entry?.title || '未命名词条'
        const draftContent = normalizeComparableContent(draft.content)
        if (!draftContent) {
            await showAlert('正文为空，无法生成摘要。', 'warning', 'toast', 1800)
            return
        }

        setGeneratingSummary(true)
        try {
            const result = await ai_generate_entry_summary({
                pluginId: aiPluginId,
                projectId,
                entryIds: [entryId],
                outputMode: 'entry_field',
                focus: `请概括词条《${fallbackTitle}》的核心设定，输出适合放在摘要字段中的中文。`,
                draftEntry: {
                    entryId,
                    title: fallbackTitle,
                    summary: normalizeComparableText(draft.summary) || null,
                    content: draft.content,
                    entryType: draft.type,
                },
                model: aiModel || null,
            })

            const nextSummary = normalizeComparableText(result.summaryMarkdown)
            if (!nextSummary) {
                throw new Error('AI 未返回可用摘要')
            }

            setDraft((current) => (
                normalizeComparableText(current.summary) === nextSummary
                    ? current
                    : {...current, summary: nextSummary}
            ))
            await showAlert('已生成摘要', 'success', 'nonInvasive', 1500)
        } catch (summaryError) {
            console.error('generate summary failed', summaryError)
            const message = summaryError instanceof Error ? summaryError.message : '生成摘要失败'
            await showAlert(message, 'error', 'toast', 2200)
        } finally {
            setGeneratingSummary(false)
        }
    }, [
        aiModel,
        aiPluginId,
        draft.content,
        draft.summary,
        draft.title,
        draft.type,
        entry?.title,
        entryId,
        generatingSummary,
        loading,
        projectId,
        saving,
        showAlert,
    ])
    useEffect(() => {
        hasChangesRef.current = hasChanges
        onDirtyChangeRef.current?.(hasChanges)
    }, [hasChanges])

    useEffect(() => {
        if (!entry) return
        if (autoSaveSeconds <= 0) {
            setAutoSaveStatus('')
            return
        }
        if (!hasChanges) {
            setAutoSaveStatus('')
            return
        }
        if (!trimmedTitle) {
            setAutoSaveStatus('标题为空，暂不自动保存')
            return
        }
        if (hasInvalidRelationDrafts) {
            setAutoSaveStatus('存在未完成关系，暂不自动保存')
            return
        }
        if (saving) return
        setAutoSaveStatus(`持续编辑中，最多每 ${autoSaveSeconds} 秒自动保存一次`)
    }, [autoSaveSeconds, entry, hasChanges, hasInvalidRelationDrafts, saving, trimmedTitle])

    useEffect(() => {
        if (!entry) return
        if (hasChanges) {
            entryCacheRef.current[entryId] = {
                entry,
                draft,
                editorMode,
                relations: entryRelations,
                relationDrafts,
                lastSuccessfulSaveAt: lastSuccessfulSaveAtRef.current,
            }
            return
        }
        delete entryCacheRef.current[entryId]
    }, [draft, editorMode, entry, entryId, entryRelations, hasChanges, relationDrafts])

    const lightboxImages = useMemo(() => draft.images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [draft.images])


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

    const reloadEntryFromDatabase = useCallback(async (reason: 'external' | 'save' = 'external') => {
        const [refreshed, refreshedOutgoing, refreshedIncoming, refreshedRelations] = await Promise.all([
            db_get_entry(entryId),
            db_list_outgoing_links(entryId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId).catch(() => [] as EntryRelation[]),
        ])

        const previousEntry = entryRef.current

        setEntry(refreshed)
        setDraft(buildDraft(refreshed))
        setOutgoingLinks(refreshedOutgoing)
        setIncomingLinks(refreshedIncoming)
        setEntryRelations(refreshedRelations)
        setRelationDrafts(refreshedRelations.map((relation) => buildRelationDraft(refreshed.id, relation)))
        setEntryCache((current) => ({...current, [refreshed.id]: refreshed}))
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

        const savedDraft = buildDraft(refreshed)
        const savedRelationDrafts = refreshedRelations.map((relation) => buildRelationDraft(refreshed.id, relation))
        historyInitializedRef.current = null
        undoRedo.reset({draft: savedDraft, relationDrafts: savedRelationDrafts})
        lastSuccessfulSaveAtRef.current = Date.now()
        lastAutoSaveAttemptAtRef.current = 0
        setAutoSaveStatus('')

        if (reason === 'external') {
            if (previousEntry && previousEntry.title !== refreshed.title) {
                await onTitleChangeRef.current?.(refreshed)
            }
            await onSavedRef.current?.(refreshed)
        }

        return refreshed
    }, [entryId, undoRedo])

    useEffect(() => {
        const unlisten = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (event) => {
            if (event.payload.entry_id !== entryId) return

            if (hasChangesRef.current) {
                void showAlert('词条已被 AI 在后台更新；当前页面存在未保存修改，已跳过自动覆盖。', 'warning', 'toast', 2200)
                return
            }

            void reloadEntryFromDatabase('external').catch((e) => {
                console.error('reload entry after AI update failed', e)
                void showAlert('词条已更新，但页面刷新失败，请手动重新打开词条。', 'warning', 'toast', 2200)
            })
        })

        return () => {
            unlisten.then((fn) => fn())
        }
    }, [entryId, reloadEntryFromDatabase, showAlert])

    useEffect(() => {
        const unlisten = listen<EntryDeletedEvent>(ENTRY_DELETED, (event) => {
            if (event.payload.entry_id !== entryId) return
            void showAlert('词条已被 AI 删除', 'warning', 'toast', 2500)
            void onBack?.()
        })
        return () => {
            unlisten.then((fn) => fn())
        }
    }, [entryId, onBack, showAlert])

    const handleDelete = useCallback(async () => {
        if (!entry) return
        const confirmed = await showAlert(
            `确定要删除词条「${entry.title}」吗？此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (!confirmed) return
        try {
            await db_delete_entry(entry.id)
            await onDelete?.()
        } catch (e) {
            void showAlert(`删除失败：${String(e)}`, 'error', 'toast', 2200)
        }
    }, [entry, onDelete, showAlert])

    const handleSave = useCallback(async (trigger: SaveTrigger = 'manual') => {
        if (!entry || !canSave) return

        setSaving(true)
        setError(null)
        if (trigger === 'auto') {
            setAutoSaveStatus('正在自动保存…')
        }

        try {
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, entry.category_id ?? null, trimmedTitle, entry.id)
            if (duplicatedEntry) {
                const message = '当前分类下已存在同名词条，请更换标题。'
                setError(message)
                if (trigger === 'manual') {
                    void showAlert(message, 'warning', 'toast', 1800)
                } else {
                    setAutoSaveStatus('标题重复，暂不自动保存')
                }
                return
            }

            await db_update_entry({
                id: entry.id,
                categoryId: entry.category_id ?? null,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                content: normalizedContent === '' ? null : normalizedContent,
                type: draft.type,
                tags: buildEntryTagsPayload(draft.tags, entryTags.localTagSchemas, entry.tags),
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
                    if (trigger === 'auto') {
                        setAutoSaveStatus('存在未完成关系，暂不自动保存')
                    }
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

            const refreshed = await reloadEntryFromDatabase('save')
            if (refreshed.title !== entry.title) {
                await onTitleChange?.(refreshed)
            }
            await onSaved?.(refreshed)
            lastSuccessfulSaveAtRef.current = Date.now()
            lastAutoSaveAttemptAtRef.current = 0
            if (trigger === 'manual') {
                setAutoSaveStatus('')
                void showAlert('词条已保存', 'success', 'nonInvasive', 1000)
            } else {
                setAutoSaveStatus('已自动保存')
            }
        } catch (e) {
            setError(String(e))
            if (trigger === 'auto') {
                lastAutoSaveAttemptAtRef.current = Date.now()
                setAutoSaveStatus('自动保存失败，可手动重试')
            }
        } finally {
            setSaving(false)
        }
    }, [entry, canSave, trimmedTitle, trimmedSummary, normalizedContent, draft.type, draft.tags, draft.images, entryTags.localTagSchemas, projectId, entryRelations, relationDrafts, onTitleChange, onSaved, showAlert, reloadEntryFromDatabase])

    useEffect(() => {
        canSaveRef.current = canSave
        saveActionRef.current = () => {
            void handleSave()
        }
    }, [canSave, handleSave])

    useEffect(() => {
        if (!entry || autoSaveSeconds <= 0) return

        const timer = window.setInterval(() => {
            if (!hasChangesRef.current) return
            if (!canSaveRef.current) return

            const now = Date.now()
            if (lastAutoSaveAttemptAtRef.current > 0 && now - lastAutoSaveAttemptAtRef.current < AUTO_SAVE_FAILURE_COOLDOWN_MS) {
                return
            }
            if (now - lastSuccessfulSaveAtRef.current < autoSaveSeconds * 1000) {
                return
            }

            lastAutoSaveAttemptAtRef.current = now
            void handleSave('auto')
        }, AUTO_SAVE_CHECK_INTERVAL_MS)

        return () => {
            window.clearInterval(timer)
        }
    }, [autoSaveSeconds, entry, handleSave])

    const applyHistory = useCallback((history: EditorHistory) => {
        isApplyingHistoryRef.current = true
        setDraft(history.draft)
        setRelationDrafts(history.relationDrafts)
    }, [])

    const handleUndo = useCallback(() => {
        const prev = undoRedo.undo()
        if (prev) applyHistory(prev)
    }, [undoRedo, applyHistory])

    const handleRedo = useCallback(() => {
        const next = undoRedo.redo()
        if (next) applyHistory(next)
    }, [undoRedo, applyHistory])

    useEffect(() => {
        function handleKeyShortcut(event: KeyboardEvent) {
            if (event.defaultPrevented || event.repeat) return
            if (!(event.ctrlKey || event.metaKey)) return

            const key = event.key.toLowerCase()

            if (key === 's') {
                event.preventDefault()
                if (!canSaveRef.current) return
                saveActionRef.current?.()
                return
            }

            // Undo/redo — only when focus is NOT inside the MarkdownEditor textarea
            // (the textarea handles its own Ctrl+Z via onKeyDown)
            const textarea = editorRef.current?.getTextareaElement()
            if (textarea && document.activeElement === textarea) return

            if (key === 'z' && !event.shiftKey) {
                event.preventDefault()
                handleUndo()
                return
            }
            if ((key === 'z' && event.shiftKey) || key === 'y') {
                event.preventDefault()
                handleRedo()
            }
        }

        window.addEventListener('keydown', handleKeyShortcut)
        return () => {
            window.removeEventListener('keydown', handleKeyShortcut)
        }
    }, [handleUndo, handleRedo])


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

    async function handleTagSchemaSaved(schema: TagSchema) {
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
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
                                {onDelete && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="entry-editor-delete-button"
                                        disabled={loading || saving}
                                        onClick={() => void handleDelete()}
                                    >
                                        删除词条
                                    </Button>
                                )}
                            </div>
                            <span className="entry-editor-workspace__meta">
                            {editorMode === 'edit'
                                ? (
                                    autoSaveStatus
                                        ? `${projectDataLoading ? '正在索引项目词条…' : `${projectEntries.length} 个词条可用于双链联想`} · ${autoSaveStatus}`
                                        : (projectDataLoading ? '正在索引项目词条…' : `${projectEntries.length} 个词条可用于双链联想`)
                                )
                                : '单击双链查看预览，双击或按钮可在新页签打开。'}
                        </span>
                        </div>

                        <div className="entry-editor-workspace__body">
                            <EntryEditorMetaPanel
                                entryId={entryId}
                                entry={entry}
                                draft={draft}
                                editorMode={editorMode}
                                loading={loading}
                                saving={saving}
                                generatingSummary={generatingSummary}
                                projectName={projectName}
                                categories={categories}
                                entryTypes={entryTypes}
                                localTagSchemas={entryTags.localTagSchemas}
                                visibleTagSchemas={entryTags.visibleTagSchemas}
                                browseVisibleTagSchemas={entryTags.browseVisibleTagSchemas}
                                implantedTagSchemaIdSet={entryTags.implantedTagSchemaIdSet}
                                availableTagSchemaOptions={entryTags.availableTagSchemaOptions}
                                tagSchemaPickerValue={entryTags.tagSchemaPickerValue}
                                ttsVoiceOptions={ttsVoiceOptions}
                                ttsVoiceSelectable={ttsVoiceSelectable}
                                ttsVoicePluginName={ttsVoicePluginName}
                                ttsVoiceHint={ttsVoiceHint}
                                onDraftChange={setDraft}
                                onOpenImageAddModal={() => setImageAddModalOpen(true)}
                                onViewImageSet={() => {
                                    setLightboxIndex(0)
                                    setLightboxOpen(true)
                                }}
                                onGenerateSummary={handleGenerateSummary}
                                onAddVisibleTagSchema={entryTags.handleAddVisibleTagSchema}
                                onOpenTagCreator={() => setTagCreatorOpen(true)}
                                onStartCharacterChat={entry ? () => {
                                    void onStartCharacterChat?.(entry)
                                } : undefined}
                            />
                            {editorMode === 'edit' ? (
                                <div className="entry-editor-markdown">
                                    <div ref={markdownContainerRef} className="entry-editor-markdown-anchor">
                                        <MarkdownEditor
                                            ref={editorRef}
                                            key={entryId}
                                            value={draft.content}
                                            onChange={(value) => setDraft((current) => (
                                                current.content === value
                                                    ? current
                                                    : {...current, content: value}
                                            ))}
                                            fontSizeScale={editorFontSize / 14}
                                            minHeight={720}
                                            placeholder="在这里写正文。输入 [[ 可以快速插入双链。"
                                            onKeyDown={(event) => {
                                                if (!(event.ctrlKey || event.metaKey) || event.repeat) return
                                                const key = event.key.toLowerCase()
                                                if (key === 'z' && !event.shiftKey) {
                                                    event.preventDefault()
                                                    handleUndo()
                                                } else if ((key === 'z' && event.shiftKey) || key === 'y') {
                                                    event.preventDefault()
                                                    handleRedo()
                                                }
                                            }}
                                            textareaProps={{
                                                onKeyDown: (event) => wikiLink.handleWikiKeyDown(event),
                                                onKeyUp: (event) => wikiLink.handleMarkdownCursorSync(event.currentTarget),
                                                onClick: (event) => wikiLink.handleMarkdownCursorSync(event.currentTarget),
                                                onSelect: (event) => wikiLink.handleMarkdownCursorSync(event.currentTarget),
                                                onScroll: (event) => wikiLink.updateWikiPopoverPosition(event.currentTarget as unknown as HTMLTextAreaElement),
                                                onBlur: () => wikiLink.handleTextareaBlur(),
                                            }}
                                        />

                                        <EntryEditorWikiLink
                                            wikiDraft={wikiLink.wikiDraft}
                                            wikiPopoverPosition={wikiLink.wikiPopoverPosition}
                                            wikiLinkOptions={wikiLink.wikiLinkOptions}
                                            activeWikiOptionIndex={wikiLink.activeWikiOptionIndex}
                                            creatingLinkedEntry={wikiLink.creatingLinkedEntry}
                                            hasExactCategorySuggestion={wikiLink.hasExactCategorySuggestion}
                                            categories={categories}
                                            popoverRef={wikiPopoverRef}
                                            optionRefs={wikiLink.wikiOptionRefs}
                                            onOptionCommit={wikiLink.handleWikiOptionCommit}
                                            onActiveIndexChange={wikiLink.setActiveWikiOptionIndex}
                                        />
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
                                                linkPreview.handleOpenLinkedEntry(internalLink)
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
                                        if (linkPreview.linkPreviewAnchorRef.current === anchor) {
                                            linkPreview.clearLinkPreviewCloseTimer()
                                            linkPreview.updateLinkPreviewPosition(anchor)
                                            return
                                        }
                                        linkPreview.openLinkPreview(anchor, internalLink)
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
                                        linkPreview.scheduleLinkPreviewClose()
                                    }}
                                    onScroll={linkPreview.closeLinkPreview}
                                >
                                    <MarkdownEditor
                                        mode="preview"
                                        value={previewContent}
                                        onChange={() => {
                                        }}
                                        background={"transparent"}
                                        fontSizeScale={editorFontSize / 14}
                                        autoHeight
                                    />

                                    <EntryEditorLinkPreview
                                        linkPreview={linkPreview.linkPreview}
                                        linkPreviewPosition={linkPreview.linkPreviewPosition}
                                        linkPreviewEntry={linkPreview.linkPreviewEntry}
                                        panelRef={linkPreviewPanelRef}
                                        anchorRef={linkPreview.linkPreviewAnchorRef}
                                        onClearCloseTimer={linkPreview.clearLinkPreviewCloseTimer}
                                        onScheduleClose={linkPreview.scheduleLinkPreviewClose}
                                    />
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
                onAddImage={() => {
                    setLightboxOpen(false)
                    setImageAddModalOpen(true)
                }}
            />

            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={entryTypes}
                existingNames={entryTags.localTagSchemas.map((schema) => schema.name)}
                existingCount={entryTags.localTagSchemas.length}
                onClose={() => setTagCreatorOpen(false)}
                onSaved={(schema) => void handleTagSchemaSaved(schema)}
            />

            <EntryImageAddModal
                open={imageAddModalOpen}
                projectId={projectId}
                onClose={() => setImageAddModalOpen(false)}
                onUploadLocal={handleUploadImages}
                onAddAiImages={(aiImages) => {
                    setDraft((current) => {
                        const nextImages = [...current.images]
                        aiImages.forEach((image, index) => {
                            nextImages.push({
                                ...image,
                                is_cover: nextImages.length === 0 && index === 0,
                            })
                        })
                        return {
                            ...current,
                            images: nextImages,
                        }
                    })
                }}
            />
        </div>
    )
}
