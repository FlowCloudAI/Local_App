import {logger} from '../../../shared/logger'
import MarkdownPreview from '@uiw/react-markdown-preview'
import {listen} from '@tauri-apps/api/event'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {openUrl} from '@tauri-apps/plugin-opener'
import {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {Button, Input, MarkdownEditor, type MarkdownEditorRef, Select, TagItem, useAlert, useTheme} from 'flowcloudai-ui'
import {
    type Category,
    type CustomEntryType,
    db_create_entry,
    db_get_entry,
    db_delete_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_list_entries,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_relations_for_entry,
    db_list_tag_schemas,
    db_save_entry_bundle,
    import_entry_images,
    type Entry,
    type EntryBrief,
    ENTRY_DELETED,
    type EntryDeletedEvent,
    type EntryLink,
    type EntryRelation,
    ENTRY_UPDATED,
    type EntryUpdatedEvent,
    type EntryTypeView,
    entryTypeKey,
    type TagSchema,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import TagCreator from '../../../features/entries/components/TagCreator'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {
    buildTagValueMap,
    findCategoryDuplicatedEntry,
    normalizeEntryLookupTitle,
    replaceRange,
    resolveActiveWikiDraft,
} from '../../../features/entries/lib/entryCommon'
import {
    buildInternalEntryMarkdown,
    buildMarkdownPreviewSource,
    isSafeExternalHref,
    parseInternalEntryHref,
    resolveMarkdownAnchor,
} from '../../../features/entries/lib/entryMarkdown'
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
import {
    areRelationDraftsEqual,
    buildRelationDraft,
    hasInvalidRelationDraft,
} from '../../../features/entries/lib/entryRelation'
import useEntryTags from '../../../features/entries/hooks/useEntryTags'
import {buildEntryTagsPayload, type EntryTagRuntimeValue} from '../../../features/entries/components/entryTagUtils'
import EntryImageAddModal from '../../../features/entries/components/EntryImageAddModal'
import EntryImageLightbox from '../../../features/entries/components/EntryImageLightbox'
import EntryRelationCreator, {type EntryRelationDraft} from '../../../features/project-editor/components/EntryRelationCreator'
import './MobileEntryDetail.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeBack: (handler: (() => boolean | Promise<boolean>) | null) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

type Mode = 'view' | 'edit'
type TagValueMap = Record<string, EntryTagRuntimeValue>
type MobileWikiDraft = { start: number; end: number; query: string }
type MobileMarkdownTool = 'heading' | 'bold' | 'italic' | 'quote' | 'list' | 'link' | 'wiki' | 'image'
type MobileWikiOption =
    | { kind: 'entry'; id: string; title: string; categoryId: string | null }
    | { kind: 'create'; title: string }

interface MarkdownTransformResult {
    value: string
    selectionStart: number
    selectionEnd: number
}

const MOBILE_MARKDOWN_TOOLS: Array<{ tool: MobileMarkdownTool; label: string }> = [
    {tool: 'heading', label: '标题'},
    {tool: 'bold', label: '加粗'},
    {tool: 'italic', label: '斜体'},
    {tool: 'quote', label: '引用'},
    {tool: 'list', label: '列表'},
    {tool: 'link', label: '链接'},
    {tool: 'wiki', label: '双链'},
    {tool: 'image', label: '图片'},
]

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

function buildExcerpt(value?: string | null, maxLength = 64): string {
    const normalized = stripMarkdown(value ?? '')
    if (!normalized) return ''
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function replaceSelection(
    value: string,
    start: number,
    end: number,
    nextValue: string,
    nextSelectionStart: number,
    nextSelectionEnd = nextSelectionStart,
): MarkdownTransformResult {
    return {
        value: `${value.slice(0, start)}${nextValue}${value.slice(end)}`,
        selectionStart: nextSelectionStart,
        selectionEnd: nextSelectionEnd,
    }
}

function transformInlineMarkdown(
    value: string,
    start: number,
    end: number,
    before: string,
    after: string,
    placeholder: string,
): MarkdownTransformResult {
    const selected = value.slice(start, end) || placeholder
    const nextValue = `${before}${selected}${after}`
    const selectionStart = start + before.length
    return replaceSelection(value, start, end, nextValue, selectionStart, selectionStart + selected.length)
}

function transformMarkdownLines(
    value: string,
    start: number,
    end: number,
    lineMapper: (line: string) => string,
): MarkdownTransformResult {
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const nextLineBreak = value.indexOf('\n', end)
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
    const target = value.slice(lineStart, lineEnd)
    const mapped = target.split('\n').map(lineMapper).join('\n')
    return replaceSelection(value, lineStart, lineEnd, mapped, lineStart, lineStart + mapped.length)
}

function transformMarkdownContent(
    tool: Exclude<MobileMarkdownTool, 'image'>,
    value: string,
    start: number,
    end: number,
): MarkdownTransformResult {
    switch (tool) {
        case 'heading':
            return transformMarkdownLines(value, start, end, line => line.replace(/^#{1,6}\s+/, '').replace(/^/, '## '))
        case 'bold':
            return transformInlineMarkdown(value, start, end, '**', '**', '加粗文字')
        case 'italic':
            return transformInlineMarkdown(value, start, end, '*', '*', '斜体文字')
        case 'quote':
            return transformMarkdownLines(value, start, end, line => line.startsWith('> ') ? line : `> ${line}`)
        case 'list':
            return transformMarkdownLines(value, start, end, line => /^[-*]\s+/.test(line) ? line : `- ${line}`)
        case 'link': {
            const selected = value.slice(start, end) || '链接文本'
            const nextValue = `[${selected}]()`
            const cursor = start + nextValue.length - 1
            return replaceSelection(value, start, end, nextValue, cursor)
        }
        case 'wiki': {
            const selected = value.slice(start, end)
            const nextValue = selected ? `[[${selected}]]` : '[['
            const cursor = start + nextValue.length
            return replaceSelection(value, start, end, nextValue, cursor)
        }
    }
}

function MobileEntryDetailActionIcon({type}: { type: 'ai' | 'edit' | 'more' | 'check' | 'delete' }) {
    if (type === 'ai') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 3.5c1.8 4.4 3.4 6 8 8-4.6 2-6.2 3.6-8 8-1.8-4.4-3.4-6-8-8 4.6-2 6.2-3.6 8-8Z"/>
            </svg>
        )
    }
    if (type === 'edit') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 19h4.1L18.7 9.4a2.2 2.2 0 0 0-3.1-3.1L6 15.9 5 19Z"/>
                <path d="m14.5 7.5 2 2"/>
            </svg>
        )
    }
    if (type === 'check') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="m5.5 12.5 4.1 4.1 8.9-9.2"/>
            </svg>
        )
    }
    if (type === 'delete') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5.5 7h13"/>
                <path d="M9 7V5.5h6V7"/>
                <path d="M8 10v8"/>
                <path d="M12 10v8"/>
                <path d="M16 10v8"/>
                <path d="M7 7.5 8 20h8l1-12.5"/>
            </svg>
        )
    }
    return (
        <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M6.5 12h.01"/>
            <path d="M12 12h.01"/>
            <path d="M17.5 12h.01"/>
        </svg>
    )
}

function MobileMarkdownToolIcon({tool}: { tool: MobileMarkdownTool }) {
    if (tool === 'heading') return <span className="mobile-entry-detail__markdown-tool-text">H</span>
    if (tool === 'bold') return <span className="mobile-entry-detail__markdown-tool-text">B</span>
    if (tool === 'italic') return <span className="mobile-entry-detail__markdown-tool-text">I</span>
    if (tool === 'quote') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8 7H5.8C4.8 8.4 4.3 9.8 4.3 11.8v4.4H10v-5.7H7.1c.1-1 .4-2 1-3.5Z"/>
                <path d="M18 7h-2.2c-1 1.4-1.5 2.8-1.5 4.8v4.4H20v-5.7h-2.9c.1-1 .4-2 1-3.5Z"/>
            </svg>
        )
    }
    if (tool === 'list') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8 7h11"/>
                <path d="M8 12h11"/>
                <path d="M8 17h11"/>
                <path d="M4.5 7h.01"/>
                <path d="M4.5 12h.01"/>
                <path d="M4.5 17h.01"/>
            </svg>
        )
    }
    if (tool === 'link') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M9.5 14.5 14.5 9.5"/>
                <path d="M10.5 7.5 12 6a4 4 0 0 1 5.7 5.7l-1.5 1.5"/>
                <path d="M13.5 16.5 12 18a4 4 0 0 1-5.7-5.7l1.5-1.5"/>
            </svg>
        )
    }
    if (tool === 'image') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <rect x="4" y="5" width="16" height="14" rx="2"/>
                <path d="m7 16 3.2-3.2 2.3 2.3 2.7-3.1L19 16"/>
                <path d="M8.5 8.8h.01"/>
            </svg>
        )
    }
    return <span className="mobile-entry-detail__markdown-tool-text">[[</span>
}

/**
 * 词条页：查看 / 编辑同屏（mode 切换），避免「详情 → 编辑」再多压一级。
 * params.mode === 'edit' 时（如新建词条后）直接进入编辑态。
 */
export default function MobileEntryDetail({push, pop, replace, navigateToTab, setBeforeBack, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const entryId = params?.entryId as string
    const {showAlert} = useAlert()
    const {theme} = useTheme()
    const pageRef = useRef<HTMLDivElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)
    const contentEditorRef = useRef<MarkdownEditorRef>(null)
    const immersiveContentEditorRef = useRef<MarkdownEditorRef>(null)
    const wikiDraftRetainTimerRef = useRef<number | null>(null)

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
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [entryRelations, setEntryRelations] = useState<EntryRelation[]>([])
    const [relationDrafts, setRelationDrafts] = useState<EntryRelationDraft[]>([])
    const [immersiveEditorOpen, setImmersiveEditorOpen] = useState(false)
    const [wikiDraft, setWikiDraft] = useState<MobileWikiDraft | null>(null)
    const [activeWikiOptionIndex, setActiveWikiOptionIndex] = useState(0)
    const [creatingLinkedEntry, setCreatingLinkedEntry] = useState(false)

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
    const initialRelationDrafts = useMemo(
        () => entryRelations.map(relation => buildRelationDraft(entryId, relation)),
        [entryId, entryRelations],
    )

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

    const reloadEntryState = useCallback(async () => {
        const [e, types, cats, schemas, briefs, outgoing, incoming, relations] = await Promise.all([
            db_get_entry(entryId),
            db_list_all_entry_types(projectId),
            db_list_categories(projectId),
            db_list_tag_schemas(projectId),
            db_list_entries({projectId, limit: 1000, offset: 0}),
            db_list_outgoing_links(entryId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId).catch(() => [] as EntryRelation[]),
        ])
        setEntry(e)
        setEntryTypes(types)
        setCategories(cats)
        setTagSchemas(schemas)
        setProjectEntries(briefs)
        setOutgoingLinks(outgoing)
        setIncomingLinks(incoming)
        setEntryRelations(relations)
        setRelationDrafts(relations.map(relation => buildRelationDraft(entryId, relation)))
        syncForm(e)
        return e
    }, [entryId, projectId, syncForm])

    const isDirty = mode === 'edit' && !!entry && (
        title !== entry.title
        || content !== (entry.content ?? '')
        || summary !== (entry.summary ?? '')
        || entryType !== (entry.type ?? null)
        || categoryId !== (entry.category_id ?? null)
        || !areTagMapsEqual(tagDraft, buildTagValueMap(entry), tagSchemas)
        || !areImagesEqual(images, normalizeEntryImages(entry.images))
        || !areRelationDraftsEqual(relationDrafts, initialRelationDrafts)
    )

    useEffect(() => {
        if (!entryId) return
        setLoading(true)
        reloadEntryState().catch(logger.error).finally(() => setLoading(false))
    }, [entryId, reloadEntryState])

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
        setBeforeBack(async () => {
            if (immersiveEditorOpen) {
                setImmersiveEditorOpen(false)
                return false
            }
            return confirmDiscard()
        })
        return () => setBeforeBack(null)
    }, [confirmDiscard, immersiveEditorOpen, mode, setBeforeBack])

    useEffect(() => {
        const updatedListener = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (event) => {
            if (event.payload.entry_id !== entryId) return
            if (mode === 'edit' && isDirty) {
                void showAlert('词条已在后台更新；当前页面存在未保存修改，已跳过自动覆盖。', 'warning', 'nonInvasive', 2200)
                return
            }
            void reloadEntryState()
                .then((updatedEntry) => {
                    replace({
                        type: 'entryDetail',
                        params: {
                            ...(params ?? {}),
                            projectId,
                            entryId,
                            displayName: updatedEntry.title,
                            mode,
                        },
                    })
                    void showAlert('词条已在后台更新，页面已刷新。', 'success', 'nonInvasive', 1500)
                })
                .catch((error) => {
                    logger.error('刷新后台更新的词条失败', error)
                    void showAlert('词条已更新，但页面刷新失败，请重新打开词条。', 'warning', 'nonInvasive', 2200)
                })
        })
        const deletedListener = listen<EntryDeletedEvent>(ENTRY_DELETED, (event) => {
            if (event.payload.entry_id !== entryId) return
            void showAlert('词条已在后台删除。', 'warning', 'nonInvasive', 2200)
            pop()
        })

        return () => {
            updatedListener.then((fn) => fn())
            deletedListener.then((fn) => fn())
        }
    }, [entryId, isDirty, mode, params, pop, projectId, reloadEntryState, replace, showAlert])

    // 取消：已有可回退的查看态则回查看；否则（极端情况无 entry）回退页面。
    const handleCancel = useCallback(async () => {
        if (!await confirmDiscard()) return
        if (entry) {
            syncForm(entry)
            setRelationDrafts(initialRelationDrafts)
            setImmersiveEditorOpen(false)
            setMode('view')
        } else {
            pop()
        }
    }, [confirmDiscard, entry, initialRelationDrafts, pop, syncForm])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    const handleOpenLinkedEntry = useCallback((targetId: string) => {
        if (targetId === entryId) return
        const target = projectEntries.find(item => item.id === targetId)
        push({
            type: 'entryDetail',
            params: {
                projectId,
                entryId: targetId,
                displayName: target?.title ?? '词条',
            },
        })
    }, [entryId, projectEntries, projectId, push])

    const handleMarkdownClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const anchor = resolveMarkdownAnchor(event.target)
        if (!anchor) return

        const href = anchor.getAttribute('href') ?? ''
        const internalLink = parseInternalEntryHref(href, anchor.textContent ?? '')
        if (internalLink) {
            event.preventDefault()
            if (internalLink.entryId) {
                handleOpenLinkedEntry(internalLink.entryId)
                return
            }
            const targetTitle = internalLink.title.trim()
            const target = projectEntries.find(item => item.title.trim() === targetTitle)
            if (!target) {
                void showAlert(`未找到词条「${targetTitle}」`, 'warning', 'nonInvasive', 1800)
                return
            }
            handleOpenLinkedEntry(target.id)
            return
        }

        if (isSafeExternalHref(href)) {
            event.preventDefault()
            void openUrl(href).catch((error) => {
                logger.error('打开链接失败', error)
                void showAlert('打开链接失败', 'error', 'nonInvasive', 1800)
            })
            return
        }

        if (href) {
            event.preventDefault()
            void showAlert('无效链接，已阻止跳转', 'warning', 'nonInvasive', 1500)
        }
    }, [handleOpenLinkedEntry, projectEntries, showAlert])

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            await showAlert('请输入词条标题', 'warning', 'nonInvasive', 2000)
            return
        }
        if (!entry) return
        if (relationDrafts.some(draft => hasInvalidRelationDraft(draft, entryId))) {
            await showAlert('存在未完成关系，请先选择目标词条或删除该关系。', 'warning', 'nonInvasive', 2400)
            return
        }
        setSaving(true)
        const tags = buildEntryTagsPayload(tagDraft, entryTags.localTagSchemas, entry.tags)
        try {
            const savedBundle = await db_save_entry_bundle({
                id: entryId,
                projectId,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                categoryId: categoryId || null,
                tags,
                images,
                relationDrafts,
            })
            setEntry(savedBundle.entry)
            syncForm(savedBundle.entry)
            setOutgoingLinks(savedBundle.outgoingLinks)
            setIncomingLinks(savedBundle.incomingLinks)
            setEntryRelations(savedBundle.relations)
            setRelationDrafts(savedBundle.relations.map(relation => buildRelationDraft(entryId, relation)))
            setAiFocus({projectId, entryId})
            // 同步页面标题（顶部标题取自 params.displayName）。
            replace({type: 'entryDetail', params: {...(params ?? {}), projectId, entryId, displayName: title.trim(), mode: 'view'}})
            setImmersiveEditorOpen(false)
            setMode('view')
        } catch (e) {
            await showAlert(`保存失败：${String(e)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setSaving(false)
        }
    }, [title, content, summary, entryType, categoryId, relationDrafts, tagDraft, entryTags.localTagSchemas, entry, entryId, images, projectId, params, replace, setAiFocus, showAlert, syncForm])

    const handleDelete = useCallback(async () => {
        const result = await showAlert(`确定删除词条「${entry?.title ?? ''}」？此操作不可撤销。`, 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await db_delete_entry(entryId)
            pop()
        } catch (e) {
            await showAlert(`删除失败：${String(e)}`, 'error', 'nonInvasive', 3000)
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

    const entryBriefById = useMemo(
        () => new Map(projectEntries.map(item => [item.id, item])),
        [projectEntries],
    )
    const categoryNameById = useMemo(
        () => new Map(categories.map(item => [item.id, item.name])),
        [categories],
    )

    const wikiLinkSuggestions = useMemo(() => {
        if (!wikiDraft) return []
        const query = normalizeEntryLookupTitle(wikiDraft.query)
        return projectEntries
            .filter((item) => item.id !== entryId)
            .filter((item) => !query || normalizeEntryLookupTitle(item.title).includes(query))
            .slice(0, 8)
    }, [entryId, projectEntries, wikiDraft])

    const hasExactCategorySuggestion = useMemo(() => {
        const query = normalizeEntryLookupTitle(wikiDraft?.query)
        if (!query) return false
        return projectEntries.some((item) => (
            item.id !== entryId
            && (item.category_id ?? null) === (categoryId ?? null)
            && normalizeEntryLookupTitle(item.title) === query
        ))
    }, [categoryId, entryId, projectEntries, wikiDraft])

    const wikiLinkOptions = useMemo<MobileWikiOption[]>(() => {
        const options: MobileWikiOption[] = wikiLinkSuggestions.map((item) => ({
            kind: 'entry',
            id: item.id,
            title: item.title,
            categoryId: item.category_id ?? null,
        }))
        const pendingTitle = wikiDraft?.query.trim()
        if (pendingTitle && !hasExactCategorySuggestion) {
            options.push({kind: 'create', title: pendingTitle})
        }
        return options
    }, [hasExactCategorySuggestion, wikiDraft, wikiLinkSuggestions])

    useEffect(() => {
        if (!wikiDraft) {
            setActiveWikiOptionIndex(0)
            return
        }
        setActiveWikiOptionIndex((current) => {
            if (wikiLinkOptions.length <= 0) return 0
            return Math.min(current, wikiLinkOptions.length - 1)
        })
    }, [wikiDraft, wikiLinkOptions.length])

    useEffect(() => () => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
        }
    }, [])

    const getContentTextarea = useCallback(() => (
        immersiveEditorOpen
            ? immersiveContentEditorRef.current?.getTextareaElement() ?? contentEditorRef.current?.getTextareaElement() ?? null
            : contentEditorRef.current?.getTextareaElement() ?? immersiveContentEditorRef.current?.getTextareaElement() ?? null
    ), [immersiveEditorOpen])

    const syncWikiDraftFromTextarea = useCallback((textarea: HTMLTextAreaElement | null, nextContent: string = content) => {
        if (!textarea) {
            setWikiDraft(null)
            return
        }
        const nextDraft = resolveActiveWikiDraft(nextContent, textarea.selectionStart)
        setWikiDraft((current) => {
            if (
                current?.start === nextDraft?.start
                && current?.end === nextDraft?.end
                && current?.query === nextDraft?.query
            ) {
                return current
            }
            return nextDraft
        })
    }, [content])

    const applyWikiLink = useCallback((linkedEntry: { id: string; title: string }, draft: MobileWikiDraft | null = wikiDraft) => {
        if (!draft) return
        const inserted = buildInternalEntryMarkdown(linkedEntry.title, linkedEntry.id)
        const nextContent = replaceRange(content, draft.start, draft.end, inserted)
        const nextCursor = draft.start + inserted.length
        setContent(nextContent)
        setWikiDraft(null)
        window.requestAnimationFrame(() => {
            const textarea = getContentTextarea()
            textarea?.focus()
            textarea?.setSelectionRange(nextCursor, nextCursor)
        })
    }, [content, getContentTextarea, wikiDraft])

    const handleCreateLinkedEntry = useCallback(async () => {
        const draft = wikiDraft
        const nextTitle = draft?.query.trim()
        if (!draft || !nextTitle || hasExactCategorySuggestion || creatingLinkedEntry) return

        setCreatingLinkedEntry(true)
        try {
            const nextCategoryId = categoryId ?? null
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, nextCategoryId, nextTitle)
            if (duplicatedEntry) {
                await showAlert('当前分类下已存在同名词条，请直接选择已有词条。', 'warning', 'nonInvasive', 1800)
                setActiveWikiOptionIndex(0)
                return
            }

            const created = await db_create_entry({
                projectId,
                categoryId: nextCategoryId,
                title: nextTitle,
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
            applyWikiLink({id: created.id, title: created.title}, draft)
            await showAlert('已创建并插入双链', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('创建双链词条失败', error)
            await showAlert(`创建词条失败：${String(error)}`, 'error', 'nonInvasive', 2200)
        } finally {
            setCreatingLinkedEntry(false)
        }
    }, [applyWikiLink, categoryId, creatingLinkedEntry, hasExactCategorySuggestion, projectId, showAlert, wikiDraft])

    const handleWikiOptionCommit = useCallback((option: MobileWikiOption | undefined) => {
        if (!option) return
        if (option.kind === 'entry') {
            applyWikiLink({id: option.id, title: option.title})
            return
        }
        void handleCreateLinkedEntry()
    }, [applyWikiLink, handleCreateLinkedEntry])

    const handleContentChange = useCallback((nextContent: string) => {
        setContent(nextContent)
        window.requestAnimationFrame(() => {
            syncWikiDraftFromTextarea(getContentTextarea(), nextContent)
        })
    }, [getContentTextarea, syncWikiDraftFromTextarea])

    const handleContentKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (!wikiDraft || wikiLinkOptions.length <= 0) return
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

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            handleWikiOptionCommit(wikiLinkOptions[activeWikiOptionIndex])
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            setWikiDraft(null)
        }
    }, [activeWikiOptionIndex, handleWikiOptionCommit, wikiDraft, wikiLinkOptions])

    const handleContentBlur = useCallback(() => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
        }
        wikiDraftRetainTimerRef.current = window.setTimeout(() => {
            setWikiDraft(null)
            wikiDraftRetainTimerRef.current = null
        }, 120)
    }, [])

    const handleContentFocus = useCallback(() => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
            wikiDraftRetainTimerRef.current = null
        }
        syncWikiDraftFromTextarea(getContentTextarea())
    }, [getContentTextarea, syncWikiDraftFromTextarea])

    const handleMarkdownTool = useCallback((tool: MobileMarkdownTool) => {
        if (tool === 'image') {
            setImageAddModalOpen(true)
            return
        }
        const textarea = getContentTextarea()
        const start = textarea?.selectionStart ?? content.length
        const end = textarea?.selectionEnd ?? start
        const result = transformMarkdownContent(tool, content, start, end)
        setContent(result.value)
        window.requestAnimationFrame(() => {
            const nextTextarea = getContentTextarea()
            nextTextarea?.focus()
            nextTextarea?.setSelectionRange(result.selectionStart, result.selectionEnd)
            syncWikiDraftFromTextarea(nextTextarea ?? null, result.value)
        })
    }, [content, getContentTextarea, syncWikiDraftFromTextarea])

    useEffect(() => {
        if (!immersiveEditorOpen) return
        window.requestAnimationFrame(() => {
            const textarea = immersiveContentEditorRef.current?.getTextareaElement()
            textarea?.focus()
            syncWikiDraftFromTextarea(textarea ?? null)
        })
    }, [immersiveEditorOpen, syncWikiDraftFromTextarea])

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
            await showAlert(`导入图片失败：${String(error)}`, 'error', 'nonInvasive', 3000)
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
            void showAlert('当前图片还没有可用于正文引用的 uuid，请先保存词条后再插入。', 'warning', 'nonInvasive', 1800)
            return
        }
        const textarea = getContentTextarea()
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
            const nextTextarea = getContentTextarea()
            nextTextarea?.focus()
            nextTextarea?.setSelectionRange(nextCursor, nextCursor)
        })
    }, [content, entry?.title, getContentTextarea, images, showAlert, title])

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
        const wikiPanel = wikiDraft ? (
            <div className="mobile-entry-detail__wiki-panel" role="listbox" aria-label="词条链接候选">
                <div className="mobile-entry-detail__wiki-panel-title">插入词条链接</div>
                {wikiLinkOptions.length > 0 ? (
                    <div className="mobile-entry-detail__wiki-options">
                        {wikiLinkOptions.map((option, index) => {
                            const active = index === activeWikiOptionIndex
                            const isCreatingOption = option.kind === 'create'
                            const optionKey = option.kind === 'entry'
                                ? `entry-${option.id}`
                                : `create-${option.title}`
                            const categoryName = option.kind === 'entry' && option.categoryId
                                ? categoryNameById.get(option.categoryId)
                                : null
                            return (
                                <button
                                    type="button"
                                    key={optionKey}
                                    role="option"
                                    aria-selected={active}
                                    className={`mobile-entry-detail__wiki-option${active ? ' is-active' : ''}${isCreatingOption ? ' mobile-entry-detail__wiki-option--create' : ''}`}
                                    disabled={isCreatingOption && creatingLinkedEntry}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActiveWikiOptionIndex(index)}
                                    onFocus={() => setActiveWikiOptionIndex(index)}
                                    onClick={() => handleWikiOptionCommit(option)}
                                >
                                    <span className="mobile-entry-detail__wiki-option-title">
                                        {option.kind === 'entry' ? option.title : `创建「${option.title}」`}
                                    </span>
                                    <span className="mobile-entry-detail__wiki-option-meta">
                                        {option.kind === 'entry'
                                            ? (categoryName ?? '未分类')
                                            : (creatingLinkedEntry ? '创建中…' : '新词条')}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <div className="mobile-entry-detail__wiki-empty">没有匹配词条</div>
                )}
            </div>
        ) : null
        const markdownTextareaProps = {
            onKeyDown: handleContentKeyDown,
            onKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onClick: (event: ReactMouseEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onSelect: (event: ReactSyntheticEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onFocus: handleContentFocus,
            onBlur: handleContentBlur,
        }
        return (
            <div className="mobile-page mobile-entry-detail mobile-entry-detail--edit">
                <MobilePageTopBar
                    className="mobile-entry-detail__edit-topbar"
                    sticky
                    edgeToEdge
                    ariaLabel="词条编辑操作"
                    left={<MobileTopActionPill
                        actions={[{
                            key: 'cancel',
                            label: '取消编辑',
                            icon: <MobileBackIcon/>,
                            disabled: saving,
                            onClick: () => void handleCancel(),
                        }]}
                    />}
                    center={<div className="mobile-entry-detail__edit-heading">
                        <span>编辑词条</span>
                        <small>{saving ? '保存中…' : isDirty ? '有未保存修改' : '已同步'}</small>
                    </div>}
                    right={<MobileTopActionPill
                        actions={[{
                            key: 'save',
                            label: saving ? '保存中' : '保存词条',
                            icon: saving ? <MobileEntryDetailActionIcon type="more"/> : <MobileEntryDetailActionIcon type="check"/>,
                            kind: 'add',
                            disabled: saving,
                            onClick: () => void handleSave(),
                        }]}
                    />}
                />

                <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--identity">
                    <div className="mobile-entry-detail__section-header">
                        <span>基础信息</span>
                    </div>
                    <Input
                        placeholder="词条标题"
                        value={title}
                        onValueChange={setTitle}
                        className="mobile-entry-detail__title-input"
                    />

                    <div className="mobile-entry-detail__meta-row">
                        <label className="mobile-entry-detail__field">
                            <span>类型</span>
                            <Select
                                value={entryType ?? ''}
                                onChange={v => setEntryType(v ? String(v) : null)}
                                options={typeOptions}
                                placeholder="类型"
                                className="mobile-entry-detail__meta-select"
                            />
                        </label>
                        <label className="mobile-entry-detail__field">
                            <span>分类</span>
                            <Select
                                value={categoryId ?? ''}
                                onChange={v => setCategoryId(v ? String(v) : null)}
                                options={categoryOptions}
                                placeholder="分类"
                                className="mobile-entry-detail__meta-select"
                            />
                        </label>
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
                </section>

                <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--content">
                    <div className="mobile-entry-detail__section-header">
                        <span>正文</span>
                        <button
                            type="button"
                            className="mobile-entry-detail__section-action"
                            onClick={() => setImmersiveEditorOpen(true)}
                        >
                            沉浸
                        </button>
                    </div>
                    <div className="mobile-entry-detail__content-field">
                        <MarkdownEditor
                            ref={contentEditorRef}
                            value={content}
                            onValueChange={handleContentChange}
                            placeholder="正文内容…输入 [[ 插入词条双链"
                            minHeight={260}
                            maxHeight={560}
                            showSplitToggle={false}
                            showAiButton={false}
                            hideFullscreen
                            toolbarCommands={[]}
                            extraCommands={[]}
                            textareaProps={markdownTextareaProps}
                            tokens={{
                                background: 'transparent',
                                toolbarBackground: 'transparent',
                                borderColor: 'transparent',
                                editorTextBackground: 'transparent',
                                previewBackground: 'transparent',
                                textColor: 'var(--fc-color-text)',
                                mutedTextColor: 'var(--fc-color-text-secondary)',
                            }}
                            className="mobile-entry-detail__content-input"
                        />
                        {!immersiveEditorOpen && wikiPanel}
                    </div>
                </section>

                <section className="mobile-entry-detail__images mobile-entry-detail__form-section">
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
                </section>

                <section className="mobile-entry-detail__tags mobile-entry-detail__form-section">
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
                </section>

                <section className="mobile-entry-detail__relations mobile-entry-detail__form-section">
                    <div className="mobile-entry-detail__relations-header">
                        <div className="mobile-entry-detail__relations-label">关系</div>
                    </div>
                    <EntryRelationCreator
                        drafts={relationDrafts}
                        entries={projectEntries}
                        categories={categories}
                        currentEntryId={entryId}
                        disabled={saving}
                        onChange={setRelationDrafts}
                        onOpenEntry={(target) => {
                            void (async () => {
                                if (!await confirmDiscard()) return
                                handleOpenLinkedEntry(target.id)
                            })()
                        }}
                    />
                </section>

                {immersiveEditorOpen && (
                    <div className="mobile-entry-detail__immersive" role="dialog" aria-label="沉浸正文编辑">
                        <MobilePageTopBar
                            className="mobile-entry-detail__immersive-topbar"
                            edgeToEdge
                            ariaLabel="沉浸正文编辑操作"
                            left={<MobileTopActionPill
                                actions={[{
                                    key: 'close',
                                    label: '退出沉浸编辑',
                                    icon: <MobileBackIcon/>,
                                    onClick: () => setImmersiveEditorOpen(false),
                                }]}
                            />}
                            center={<div className="mobile-entry-detail__edit-heading">
                                <span>正文编辑</span>
                                <small>{isDirty ? '有未保存修改' : '已同步'}</small>
                            </div>}
                            right={<MobileTopActionPill
                                actions={[{
                                    key: 'save',
                                    label: saving ? '保存中' : '保存词条',
                                    icon: saving ? <MobileEntryDetailActionIcon type="more"/> : <MobileEntryDetailActionIcon type="check"/>,
                                    kind: 'add',
                                    disabled: saving,
                                    onClick: () => void handleSave(),
                                }]}
                            />}
                        />
                        <div className="mobile-entry-detail__immersive-body">
                            <MarkdownEditor
                                ref={immersiveContentEditorRef}
                                value={content}
                                onValueChange={handleContentChange}
                                placeholder="正文内容…输入 [[ 插入词条双链"
                                autoHeight={false}
                                height="100%"
                                minHeight={420}
                                showSplitToggle={false}
                                showAiButton={false}
                                hideFullscreen
                                toolbarCommands={[]}
                                extraCommands={[]}
                                textareaProps={markdownTextareaProps}
                                tokens={{
                                    background: 'transparent',
                                    toolbarBackground: 'transparent',
                                    borderColor: 'transparent',
                                    editorTextBackground: 'transparent',
                                    previewBackground: 'transparent',
                                    textColor: 'var(--fc-color-text)',
                                    mutedTextColor: 'var(--fc-color-text-secondary)',
                                }}
                                className="mobile-entry-detail__immersive-editor"
                            />
                            {wikiPanel}
                        </div>
                        <div className="mobile-entry-detail__markdown-toolbar" role="toolbar" aria-label="Markdown 常用工具">
                            {MOBILE_MARKDOWN_TOOLS.map(item => (
                                <button
                                    key={item.tool}
                                    type="button"
                                    className="mobile-entry-detail__markdown-tool"
                                    aria-label={item.label}
                                    title={item.label}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => handleMarkdownTool(item.tool)}
                                >
                                    <MobileMarkdownToolIcon tool={item.tool}/>
                                </button>
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
    const viewRelationDrafts = entryRelations
        .map(relation => buildRelationDraft(entryId, relation))
        .filter(relation => relation.otherEntryId)
    const hasConnections = viewRelationDrafts.length > 0 || outgoingLinks.length > 0 || incomingLinks.length > 0
    const entryMenuItems: MobileAnchoredMenuItem[] = [
        {key: 'delete', label: '删除词条', description: '永久删除当前词条', icon: <MobileEntryDetailActionIcon type="delete"/>, danger: true, onSelect: () => void handleDelete()},
    ]

    return (
        <div ref={pageRef} className="mobile-page mobile-entry-detail">
            <MobilePageTopBar
                className="mobile-entry-detail__view-topbar"
                sticky
                edgeToEdge
                ariaLabel="词条查看操作"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}
                />}
                right={<MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'ai',
                            label: 'AI 讨论',
                            icon: <MobileEntryDetailActionIcon type="ai"/>,
                            onClick: handleAiDiscuss,
                        },
                        {
                            key: 'edit',
                            label: '编辑词条',
                            icon: <MobileEntryDetailActionIcon type="edit"/>,
                            kind: 'add',
                            onClick: enterEdit,
                        },
                        {
                            key: 'menu',
                            label: '更多操作',
                            icon: <MobileEntryDetailActionIcon type="more"/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        },
                    ]}
                />}
            />

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

            {hasConnections && (
                <div className="mobile-entry-detail__connections">
                    <h3 className="mobile-entry-detail__section-title">关联</h3>
                    {viewRelationDrafts.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">结构化关系</div>
                            {viewRelationDrafts.map((relation, index) => {
                                const target = relation.otherEntryId ? entryBriefById.get(relation.otherEntryId) : null
                                const directionLabel = relation.direction === 'two_way'
                                    ? '双向'
                                    : relation.direction === 'incoming' ? '来自对方' : '指向对方'
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={relation.id ?? `relation-${index}`}
                                        disabled={!target}
                                        onClick={() => relation.otherEntryId && handleOpenLinkedEntry(relation.otherEntryId)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {target?.title ?? '词条不存在或已删除'}
                                        </span>
                                        <span className="mobile-entry-detail__connection-meta">
                                            {directionLabel}{relation.content ? ` · ${relation.content}` : ''}
                                        </span>
                                        {target?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(target.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    {outgoingLinks.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">正文提到</div>
                            {outgoingLinks.map(link => {
                                const target = entryBriefById.get(link.b_id)
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={link.id}
                                        disabled={!target}
                                        onClick={() => handleOpenLinkedEntry(link.b_id)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {target?.title ?? '词条不存在或已删除'}
                                        </span>
                                        {target?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(target.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    {incomingLinks.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">被这些词条提到</div>
                            {incomingLinks.map(link => {
                                const source = entryBriefById.get(link.a_id)
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={link.id}
                                        disabled={!source}
                                        onClick={() => handleOpenLinkedEntry(link.a_id)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {source?.title ?? '词条不存在或已删除'}
                                        </span>
                                        {source?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(source.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {entry.content ? (
                <div className="mobile-entry-detail__markdown" data-color-mode={colorMode} onClick={handleMarkdownClick}>
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

            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="词条操作"
                items={entryMenuItems}
            />
        </div>
    )
}
