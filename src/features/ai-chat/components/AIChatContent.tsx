import {logger} from '../../../shared/logger'
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {MessageBox, type MessageBoxBlock, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_list_plugins,
    ai_play_tts,
    db_get_entry,
    db_list_entries,
    type Entry,
    type EntryBrief,
    type PluginInfo,
    setting_get_settings,
    setting_has_api_key,
} from '../../../api'
import type {AiContextValue, Conversation} from '../model/AiControllerTypes'
import type {DockableSidePanelMode} from '../../../shared/ui/layout/DockableSidePanel'
import {DockPanelSearchInput, DockPanelSegmentedControl} from '../../../shared/ui/layout/DockPanelSidebarControls'
import {resolvePreferredTtsPlugin, resolveVoiceIdWithPlugin} from '../../plugins/ttsVoice'
import useLinkPreview from '../../entries/hooks/useLinkPreview'
import useWikiLink from '../../entries/hooks/useWikiLink'
import EntryEditorLinkPreview from '../../entries/components/EntryEditorLinkPreview'
import EntryEditorWikiLink from '../../entries/components/EntryEditorWikiLink'
import {
    buildInternalEntryMarkdown,
    type InternalEntryLink,
    parseInternalEntryHref,
    resolveMarkdownAnchor,
} from '../../entries/lib/entryMarkdown'
import {normalizeEntryLookupTitle} from '../../entries/lib/entryCommon'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import '../../../shared/ui/layout/DockPanelScaffold.css'
import './AIChatContent.css'

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500
const DEFAULT_ROLEPLAY_VOICE_ID = 'Ethan'
const AI_CHAT_ENTRY_LINK_PREFIX = '#fc-entry-link?'
type AiConversationFilter = 'all' | 'default' | 'character' | 'report'
type AiConversationStatusFilter = 'active' | 'archived'

const AI_CONVERSATION_FILTER_OPTIONS: Array<{ key: AiConversationFilter; label: string }> = [
    {key: 'all', label: '全部'},
    {key: 'default', label: '通用'},
    {key: 'character', label: '角色聊天'},
    {key: 'report', label: '矛盾检测'},
]

const AI_CONVERSATION_STATUS_OPTIONS: Array<{ key: AiConversationStatusFilter; label: string }> = [
    {key: 'active', label: '当前'},
    {key: 'archived', label: '归档'},
]

function matchesConversationFilter(conversation: Conversation, filter: AiConversationFilter) {
    if (filter === 'all') return true
    if (filter === 'default') return !conversation.mode || conversation.mode === 'default'
    if (filter === 'character') return conversation.mode === 'character'
    if (filter === 'report') return conversation.mode === 'report'
    return false
}

function compareConversationsForList(a: Conversation, b: Conversation) {
    const pinnedDiff = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt))
    if (pinnedDiff !== 0) return pinnedDiff
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt)
    return b.timestamp - a.timestamp
}

function buildConversationSearchText(conversation: Conversation) {
    return [
        conversation.title,
        conversation.characterName,
        conversation.reportContext?.projectName,
        conversation.reportContext?.scopeSummary,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
}

function buildAiChatEntryHref(link: InternalEntryLink): string {
    const params = new URLSearchParams()
    if (link.entryId) params.set('entryId', link.entryId)
    params.set('title', link.title)
    return `${AI_CHAT_ENTRY_LINK_PREFIX}${params.toString()}`
}

function parseAiChatEntryHref(href: string, fallbackTitle = ''): InternalEntryLink | null {
    if (href.startsWith(AI_CHAT_ENTRY_LINK_PREFIX)) {
        const params = new URLSearchParams(href.slice(AI_CHAT_ENTRY_LINK_PREFIX.length))
        const title = (params.get('title') ?? fallbackTitle).trim()
        const entryId = params.get('entryId')?.trim() || null
        if (!title && !entryId) return null
        return {title, entryId}
    }

    return parseInternalEntryHref(href, fallbackTitle)
}

function buildRenderableAiChatMarkdown(content: string): string {
    return content
        .replace(/\[([^\]\n]+?)]\((entry:\/\/[^)\s]+|entry-title:\/\/[^)]+)\)/g, (_match, rawTitle, rawHref) => {
            const title = String(rawTitle).trim()
            const link = parseInternalEntryHref(String(rawHref), title)
            if (!link) return _match
            return `[${title}](${buildAiChatEntryHref(link)})`
        })
        .replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
            const title = String(rawTitle).trim()
            if (!title) return _match
            return `[${title}](${buildAiChatEntryHref({title, entryId: null})})`
        })
}

function buildRenderableAiChatBlocks(blocks?: MessageBoxBlock[]): MessageBoxBlock[] | undefined {
    if (!blocks) return undefined
    return blocks.map((block) => (
        block.type === 'content'
            ? {...block, content: buildRenderableAiChatMarkdown(block.content)}
            : block
    ))
}

interface AIChatContentProps {
    controller: AiContextValue
    panelMode?: DockableSidePanelMode
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
}

export default function AIChatContent({
                                           controller,
                                           panelMode,
                                           onTogglePanelMode,
                                           onToggleCollapsed,
                                           onOpenEntry,
                                       }: AIChatContentProps) {
    const ctx = controller
    const activeConversation = ctx.activeConversation
    const isCharacterConversation = activeConversation?.mode === 'character'
    const isReportConversation = activeConversation?.mode === 'report'
    const isArchivedConversation = Boolean(activeConversation?.archivedAt)
    const {showAlert} = useAlert()

    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [conversationStatusFilter, setConversationStatusFilter] = useState<AiConversationStatusFilter>('active')
    const [conversationFilter, setConversationFilter] = useState<AiConversationFilter>('all')
    const [conversationSearch, setConversationSearch] = useState('')
    const renameInputRef = useRef<HTMLInputElement>(null)

    const startRename = (event: React.MouseEvent, conv: { id: string; title: string }) => {
        event.stopPropagation()
        setRenamingId(conv.id)
        setRenameValue(conv.title)
        setTimeout(() => renameInputRef.current?.select(), 0)
    }

    const commitRename = async () => {
        if (renamingId) await ctx.renameConversation(renamingId, renameValue)
        setRenamingId(null)
    }

    const handleRenameKey = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') void commitRename()
        if (event.key === 'Escape') setRenamingId(null)
    }

    const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false)
    const pluginSwitcherRef = useRef<HTMLDivElement>(null)

    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
    const modelSwitcherRef = useRef<HTMLDivElement>(null)
    const [inputLimitMessage, setInputLimitMessage] = useState('')

    useEffect(() => {
        if (!isPluginMenuOpen) return
        const handleClick = (event: MouseEvent) => {
            if (pluginSwitcherRef.current && !pluginSwitcherRef.current.contains(event.target as Node)) {
                setIsPluginMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isPluginMenuOpen])

    useEffect(() => {
        if (!isModelMenuOpen) return
        const handleClick = (event: MouseEvent) => {
            if (modelSwitcherRef.current && !modelSwitcherRef.current.contains(event.target as Node)) {
                setIsModelMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isModelMenuOpen])

    const [autoScroll, setAutoScroll] = useState(true)
    const [roleplayAutoPlayFallback, setRoleplayAutoPlayFallback] = useState<boolean | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const inputWikiContainerRef = useRef<HTMLDivElement | null>(null)
    const inputWikiPopoverRef = useRef<HTMLDivElement | null>(null)
    const focusContextRef = useRef<HTMLDivElement>(null)
    const focusChipTextRefs = useRef<Record<string, HTMLSpanElement | null>>({})
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const projectEntriesRef = useRef<EntryBrief[]>([])
    const lastScrollTopRef = useRef(0)
    const roleplayAutoPlayRef = useRef<string | null>(null)
    const [overflowingFocusChips, setOverflowingFocusChips] = useState<Record<string, boolean>>({})
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryCache, setEntryCache] = useState<Record<string, Entry>>({})
    const charCount = ctx.inputValue.length
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD
    const selectedPluginInfo = ctx.plugins.find((plugin) => plugin.id === ctx.selectedPlugin)
    const showFocusContext = !isCharacterConversation && !isReportConversation
    const linkPreviewProjectId = activeConversation?.reportContext?.projectId ?? ctx.focusContext.projectId
    const filteredConversations = useMemo(() => {
        const keyword = conversationSearch.trim().toLocaleLowerCase()

        return ctx.conversations.filter((conversation) => {
            if (conversationStatusFilter === 'active' && conversation.archivedAt) return false
            if (conversationStatusFilter === 'archived' && !conversation.archivedAt) return false
            if (!matchesConversationFilter(conversation, conversationFilter)) return false
            if (!keyword) return true
            return buildConversationSearchText(conversation).includes(keyword)
        }).sort(compareConversationsForList)
    }, [conversationFilter, conversationSearch, conversationStatusFilter, ctx.conversations])
    const hasConversationSearch = conversationSearch.trim().length > 0
    const focusContextItems = useMemo(() => {
        const focusContext = ctx.focusContext
        return [
            focusContext.projectId
                ? {key: 'project', label: `项目：${focusContext.projectName ?? '加载中'}`}
                : {key: 'project', label: '项目：未引用'},
            focusContext.entryId
                ? {key: 'entry', label: `词条：${focusContext.entryTitle ?? '加载中'}`}
                : null,
        ].filter((item): item is { key: string; label: string } => Boolean(item))
    }, [ctx.focusContext])

    const ensureProjectEntryDetailsLoaded = useCallback(async (briefs: EntryBrief[]) => {
        if (!briefs.length) return
        const results = await Promise.all(
            briefs.map(async (brief) => {
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
    }, [])

    const ensureProjectEntriesLoaded = useCallback(async () => {
        if (!linkPreviewProjectId) return
        if (projectEntriesStatusRef.current === 'loaded') return
        if (projectEntriesLoadPromiseRef.current) return projectEntriesLoadPromiseRef.current

        projectEntriesStatusRef.current = 'loading'
        projectEntriesLoadPromiseRef.current = (async () => {
            try {
                const briefs = await db_list_entries({projectId: linkPreviewProjectId, limit: 1000, offset: 0})
                projectEntriesRef.current = briefs
                setProjectEntries(briefs)
                projectEntriesStatusRef.current = 'loaded'
                void ensureProjectEntryDetailsLoaded(briefs)
            } catch {
                projectEntriesStatusRef.current = 'idle'
            } finally {
                projectEntriesLoadPromiseRef.current = null
            }
        })()

        return projectEntriesLoadPromiseRef.current
    }, [ensureProjectEntryDetailsLoaded, linkPreviewProjectId])

    const linkPreview = useLinkPreview({
        entryCache,
        projectEntries,
        ensureProjectEntriesLoaded,
        onOpenEntry: (entry) => {
            if (!linkPreviewProjectId) return
            onOpenEntry?.(linkPreviewProjectId, entry)
        },
    })
    const {closeLinkPreview} = linkPreview

    useEffect(() => {
        projectEntriesStatusRef.current = 'idle'
        projectEntriesLoadPromiseRef.current = null
        projectEntriesRef.current = []
        setProjectEntries([])
        setEntryCache({})
        closeLinkPreview()
    }, [closeLinkPreview, linkPreviewProjectId])

    const inputWikiLink = useWikiLink({
        entryId: ctx.focusContext.entryId ?? '',
        entryCategoryId: null,
        projectEntries,
        content: ctx.inputValue,
        containerRef: inputWikiContainerRef,
        popoverRef: inputWikiPopoverRef,
        onContentChange: ctx.setInputValue,
        onCreateEntry: async () => null,
        onShowAlert: (message, type) => {
            void showAlert(message, type, 'toast', 1600)
        },
        canCreateEntry: false,
    })
    const sendDisabledReason = isArchivedConversation
        ? '取消归档后继续对话'
        : ctx.isStreaming
            ? '正在生成中'
            : !ctx.inputValue.trim()
                ? '请输入消息'
                : ''

    useLayoutEffect(() => {
        if (!showFocusContext) {
            setOverflowingFocusChips({})
            return
        }

        const measureOverflow = () => {
            const nextState: Record<string, boolean> = {}
            focusContextItems.forEach((item) => {
                const element = focusChipTextRefs.current[item.key]
                nextState[item.key] = Boolean(element && element.scrollWidth > element.clientWidth + 1)
            })
            setOverflowingFocusChips((current) => {
                const currentKeys = Object.keys(current)
                const nextKeys = Object.keys(nextState)
                if (currentKeys.length !== nextKeys.length) return nextState
                for (const key of nextKeys) {
                    if (current[key] !== nextState[key]) return nextState
                }
                return current
            })
        }

        measureOverflow()
        const observer = new ResizeObserver(() => {
            measureOverflow()
        })
        if (focusContextRef.current) observer.observe(focusContextRef.current)
        focusContextItems.forEach((item) => {
            const element = focusChipTextRefs.current[item.key]
            if (element) observer.observe(element)
        })

        return () => observer.disconnect()
    }, [focusContextItems, showFocusContext])

    useEffect(() => {
        if (!autoScroll) return
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current
            if (!container) return
            const roll = container.querySelector('.fc-roll') as HTMLElement | null
            const scrollContainer = roll || container
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        })
    }, [ctx.messages.length, ctx.streamingBlocks, autoScroll])

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current
        if (!container) return
        const roll = container.querySelector('.fc-roll') as HTMLElement | null
        const scrollContainer = roll || container
        const {scrollTop, scrollHeight, clientHeight} = scrollContainer
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        if (scrollTop < lastScrollTopRef.current && distanceFromBottom > 50) {
            setAutoScroll(false)
        } else if (distanceFromBottom <= 50) {
            setAutoScroll(true)
        }
        lastScrollTopRef.current = scrollTop
    }, [])

    const resolveEntryAnchor = useCallback((target: EventTarget | null): HTMLAnchorElement | null => {
        const anchor = resolveMarkdownAnchor(target)
        if (!anchor) return null
        const href = anchor.getAttribute('href') ?? ''
        return parseAiChatEntryHref(href, anchor.textContent ?? '') ? anchor : null
    }, [])

    const getEntryLinkFromAnchor = useCallback((anchor: HTMLAnchorElement): InternalEntryLink | null => {
        const href = anchor.getAttribute('href') ?? ''
        return parseAiChatEntryHref(href, anchor.textContent ?? '')
    }, [])

    const handleEntryLinkClick = useCallback((event: React.MouseEvent) => {
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        event.preventDefault()

        const internalLink = getEntryLinkFromAnchor(anchor)
        if (!internalLink) return
        if (!linkPreviewProjectId) {
            void showAlert('当前对话没有项目上下文，无法打开词条链接。', 'warning', 'toast', 1800)
            return
        }
        void ensureProjectEntriesLoaded().then(() => {
            linkPreview.handleOpenLinkedEntry(internalLink)
        })
    }, [ensureProjectEntriesLoaded, getEntryLinkFromAnchor, linkPreview, linkPreviewProjectId, resolveEntryAnchor, showAlert])

    const handleEntryLinkMouseOver = useCallback((event: React.MouseEvent) => {
        if (!linkPreviewProjectId) return
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        const internalLink = getEntryLinkFromAnchor(anchor)
        if (!internalLink) return
        if (linkPreview.linkPreviewAnchorRef.current === anchor) {
            linkPreview.clearLinkPreviewCloseTimer()
            linkPreview.updateLinkPreviewPosition(anchor)
            return
        }
        linkPreview.openLinkPreview(anchor, internalLink)
    }, [getEntryLinkFromAnchor, linkPreview, linkPreviewProjectId, resolveEntryAnchor])

    const handleEntryLinkMouseOut = useCallback((event: React.MouseEvent) => {
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        const relatedTarget = event.relatedTarget
        if (
            relatedTarget instanceof Node
            && (anchor.contains(relatedTarget) || linkPreviewPanelRef.current?.contains(relatedTarget))
        ) {
            return
        }
        linkPreview.scheduleLinkPreviewClose()
    }, [linkPreview, resolveEntryAnchor])

    const scrollToBottom = useCallback(() => {
        setAutoScroll(true)
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current
            if (!container) return
            const roll = container.querySelector('.fc-roll') as HTMLElement | null
            const scrollContainer = roll || container
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        })
    }, [])

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = 'auto'
        const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 200)
        textarea.style.height = `${nextHeight}px`
    }, [])

    useLayoutEffect(() => {
        resizeTextarea()
    }, [ctx.inputValue, resizeTextarea])

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return

        const target = textarea.closest('.dockable-side-panel') as HTMLElement | null
            ?? textarea.closest('.ai-main') as HTMLElement | null
        if (!target) return

        const ro = new ResizeObserver(() => {
            resizeTextarea()
        })
        ro.observe(target)

        const handleTransitionEnd = () => resizeTextarea()
        target.addEventListener('transitionend', handleTransitionEnd)
        target.addEventListener('animationend', handleTransitionEnd)

        resizeTextarea()

        return () => {
            ro.disconnect()
            target.removeEventListener('transitionend', handleTransitionEnd)
            target.removeEventListener('animationend', handleTransitionEnd)
        }
    }, [resizeTextarea])

    const standardizeInputWikiLinks = useCallback(async (content: string) => {
        if (!content.includes('[[')) return content
        if (!linkPreviewProjectId) return content
        await ensureProjectEntriesLoaded()
        const entries = projectEntriesRef.current
        if (!entries.length) return content

        return content.replace(/\[\[([^[\]\n]+?)]]/g, (match, rawTitle) => {
            const title = String(rawTitle).trim()
            if (!title) return match
            const normalizedTitle = normalizeEntryLookupTitle(title)
            const target = entries.find((entry) => normalizeEntryLookupTitle(entry.title) === normalizedTitle)
            return target ? buildInternalEntryMarkdown(target.title, target.id) : match
        })
    }, [ensureProjectEntriesLoaded, linkPreviewProjectId])

    const handleSendCurrentInput = useCallback(async () => {
        const rawInput = ctx.inputValue
        if (isArchivedConversation || !rawInput.trim() || ctx.isStreaming) return
        const nextInput = await standardizeInputWikiLinks(rawInput)
        await ctx.sendMessage(nextInput)
    }, [ctx, isArchivedConversation, standardizeInputWikiLinks])

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        inputWikiLink.handleWikiKeyDown(event)
        if (event.defaultPrevented) return

        if (
            event.key === 'ArrowLeft'
            || event.key === 'ArrowRight'
            || event.key === 'ArrowUp'
            || event.key === 'ArrowDown'
        ) {
            event.stopPropagation()
            return
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            if (isArchivedConversation || !ctx.inputValue.trim() || ctx.isStreaming) return
            void handleSendCurrentInput()
        }
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.target.value
        if (nextValue.length <= MAX_CHARS) {
            ctx.setInputValue(nextValue)
            if (inputLimitMessage) {
                setInputLimitMessage('')
            }
            if (nextValue.includes('[[')) {
                void ensureProjectEntriesLoaded()
            }
            inputWikiLink.handleMarkdownCursorSync(event.currentTarget)
            return
        }

        const overflow = nextValue.length - MAX_CHARS
        ctx.setInputValue(nextValue.slice(0, MAX_CHARS))
        setInputLimitMessage(`已截断，超出 ${overflow} 字未输入`)
        inputWikiLink.handleMarkdownCursorSync(event.currentTarget)
    }

    const handlePlayRoleMessage = useCallback(async (content: string, overrideVoiceId?: string | null) => {
        const text = content.trim()
        if (!text) {
            await showAlert('当前消息没有可播放的文本内容。', 'warning', 'toast', 1800)
            return
        }

        let settings
        let plugins: PluginInfo[]
        try {
            ;[settings, plugins] = await Promise.all([
                setting_get_settings(),
                ai_list_plugins('tts'),
            ])
        } catch (error) {
            await showAlert(`读取语音设置失败：${String(error)}`, 'error', 'toast', 2600)
            return
        }

        if (plugins.length === 0) {
            await showAlert('当前没有可用的语音插件，请先安装 TTS 插件。', 'warning', 'toast', 2600)
            return
        }

        const selectedPlugin = resolvePreferredTtsPlugin(plugins, settings.tts.plugin_id)

        if (!selectedPlugin) {
            await showAlert('默认语音插件不可用，请在设置中重新选择。', 'warning', 'toast', 2600)
            return
        }

        let hasApiKey = false
        try {
            hasApiKey = await setting_has_api_key(selectedPlugin.id)
        } catch (error) {
            await showAlert(`读取语音插件密钥状态失败：${String(error)}`, 'error', 'toast', 2600)
            return
        }

        if (!hasApiKey) {
            await showAlert(`语音插件「${selectedPlugin.name}」尚未配置 API Key。`, 'warning', 'toast', 2600)
            return
        }

        const model = settings.tts.default_model
        && selectedPlugin.models.includes(settings.tts.default_model)
            ? settings.tts.default_model
            : (selectedPlugin.default_model ?? selectedPlugin.models[0] ?? '')

        if (!model) {
            await showAlert(`语音插件「${selectedPlugin.name}」没有可用模型。`, 'warning', 'toast', 2600)
            return
        }

        const voiceId = resolveVoiceIdWithPlugin(
            selectedPlugin,
            [overrideVoiceId, settings.tts.voice_id],
            DEFAULT_ROLEPLAY_VOICE_ID,
        )

        try {
            await ai_play_tts({
                pluginId: selectedPlugin.id,
                model,
                text,
                voiceId,
            })
        } catch (error) {
            await showAlert(`语音播放失败：${String(error)}`, 'error', 'toast', 2800)
        }
    }, [showAlert])

    useEffect(() => {
        if (!isCharacterConversation || !activeConversation) {
            roleplayAutoPlayRef.current = null
            return
        }
        const latestMessage = ctx.messages[ctx.messages.length - 1]
        if (!latestMessage || latestMessage.role !== 'assistant') return
        const currentKey = `${activeConversation.id}:${latestMessage.id}`
        if (roleplayAutoPlayRef.current === currentKey) return
        let cancelled = false

        const run = async () => {
            let shouldAutoPlay = activeConversation.characterAutoPlay
            if (shouldAutoPlay == null) {
                try {
                    const settings = await setting_get_settings()
                    shouldAutoPlay = settings.tts.auto_play
                } catch {
                    shouldAutoPlay = false
                }
            }
            if (!shouldAutoPlay || cancelled) return
            roleplayAutoPlayRef.current = currentKey
            await handlePlayRoleMessage(latestMessage.content, activeConversation.characterVoiceId)
        }

        void run()
        return () => {
            cancelled = true
        }
    }, [
        activeConversation,
        ctx.messages,
        handlePlayRoleMessage,
        isCharacterConversation,
    ])

    useEffect(() => {
        if (!isCharacterConversation || !activeConversation || activeConversation.characterAutoPlay != null) {
            return
        }

        let cancelled = false
        setting_get_settings()
            .then((settings) => {
                if (cancelled) return
                setRoleplayAutoPlayFallback(settings.tts.auto_play)
            })
            .catch(() => {
                if (cancelled) return
                setRoleplayAutoPlayFallback(true)
            })

        return () => {
            cancelled = true
        }
    }, [activeConversation, isCharacterConversation])

    const effectiveRoleplayAutoPlay = activeConversation?.characterAutoPlay ?? roleplayAutoPlayFallback ?? true

    return (
        <>
            {!ctx.sidebarCollapsed && (
                <div className="ai-sidebar-overlay" onClick={() => ctx.setSidebarCollapsed(true)}/>
            )}
            <aside className="ai-sidebar">
                <div className="ai-sidebar-top">
                    <div className="ai-sidebar-topbar">
                        <div className="ai-sidebar-topbar-title">对话列表</div>
                        <button
                            className="ai-sidebar-close-btn"
                            onClick={() => ctx.setSidebarCollapsed(true)}
                            title="收起侧边栏"
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M9 2L4 7L9 12"/>
                            </svg>
                        </button>
                    </div>
                    <div className="ai-sidebar-controls dock-panel-sidebar-controls">
                        <div className="dock-panel-control-group">
                            <span className="dock-panel-control-label">状态</span>
                            <DockPanelSegmentedControl
                                options={AI_CONVERSATION_STATUS_OPTIONS}
                                value={conversationStatusFilter}
                                onChange={setConversationStatusFilter}
                                ariaLabel="AI 对话状态"
                            />
                        </div>
                        <div className="dock-panel-control-group">
                            <span className="dock-panel-control-label">类型</span>
                            <DockPanelSegmentedControl
                                options={AI_CONVERSATION_FILTER_OPTIONS}
                                value={conversationFilter}
                                onChange={setConversationFilter}
                                ariaLabel="AI 对话类型"
                            />
                        </div>
                        <DockPanelSearchInput
                            value={conversationSearch}
                            onChange={setConversationSearch}
                            placeholder="搜索对话"
                            ariaLabel="搜索 AI 对话"
                        />
                        <button className="ai-sidebar-new-btn" onClick={() => void ctx.createNewConversation()}
                                title="新对话">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M7 2v10M2 7h10"/>
                            </svg>
                            <span>新对话</span>
                        </button>
                    </div>
                </div>
                <div className="ai-conversations-list">
                    {ctx.conversations.length === 0 && (
                        <div className="ai-empty-history"><p>暂无历史对话</p></div>
                    )}
                    {ctx.conversations.length > 0 && filteredConversations.length === 0 && (
                        <div className="ai-empty-history">
                            <p>{hasConversationSearch
                                ? '没有匹配的对话'
                                : conversationStatusFilter === 'archived'
                                    ? '暂无归档对话'
                                    : '当前类型下没有对话'}</p>
                        </div>
                    )}
                    {filteredConversations.map((conv) => {
                        const runtime = ctx.conversationRuntime[conv.id]
                        const isConversationStreaming = Boolean(runtime?.isStreaming)
                        const hasUnreadReply = Boolean(runtime?.hasUnreadReply)
                        const conversationTags = [
                            conv.pinnedAt ? '已顶置' : null,
                            conv.archivedAt ? '已归档' : null,
                            conv.mode === 'character' ? '角色对话' : null,
                            conv.mode === 'report' ? '矛盾检测' : null,
                        ].filter(Boolean).join(' · ')
                        return (
                        <div
                            key={conv.id}
                            className={`ai-conversation-item ${conv.id === ctx.activeConversationId ? 'active' : ''}${conv.mode === 'character' ? ' is-character' : ''}${conv.mode === 'report' ? ' is-report' : ''}${conv.pinnedAt ? ' is-pinned' : ''}${conv.archivedAt ? ' is-archived' : ''}${isConversationStreaming ? ' is-streaming' : ''}${hasUnreadReply ? ' has-unread-reply' : ''}`}
                            onClick={() => renamingId !== conv.id && void ctx.switchConversation(conv.id)}
                        >
                            {!isConversationStreaming && hasUnreadReply && (
                                <span className="ai-conversation-unread-dot" aria-hidden="true"/>
                            )}
                            {conv.mode === 'character' && (
                                <div className="ai-conversation-avatar" aria-hidden="true">
                                    {conv.backgroundImageUrl ? (
                                        <img src={conv.backgroundImageUrl} alt={conv.characterName ?? conv.title}/>
                                    ) : (
                                        <span>{(conv.characterName ?? conv.title).slice(0, 1) || '角'}</span>
                                    )}
                                </div>
                            )}
                            {conv.mode === 'report' && (
                                <div className="ai-conversation-report-icon" aria-hidden="true">
                                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
                                         strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
                                        <path
                                            d="M8.1 2.7L2.4 12.6a1.4 1.4 0 001.2 2.1h10.8a1.4 1.4 0 001.2-2.1L9.9 2.7a1.04 1.04 0 00-1.8 0z"/>
                                        <path d="M9 6.2v3.4M9 12.2h.01"/>
                                    </svg>
                                </div>
                            )}
                            <div className="ai-conversation-info">
                                {renamingId === conv.id ? (
                                    <input
                                        ref={renameInputRef}
                                        className="ai-conversation-rename-input"
                                        value={renameValue}
                                        onChange={(event) => setRenameValue(event.target.value)}
                                        onKeyDown={handleRenameKey}
                                        onBlur={() => void commitRename()}
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    <>
                                        <div className="ai-conversation-title" title={conv.title}>{conv.title}</div>
                                        {conversationTags && (
                                            <div className="ai-conversation-subtitle">{conversationTags}</div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="ai-conversation-actions">
                                <button
                                    className={`ai-conversation-action-btn ${conv.pinnedAt ? 'active' : ''}`}
                                    onClick={(event) => ctx.toggleConversationPinned(conv.id, event)}
                                    title={conv.pinnedAt ? '取消顶置' : '顶置'}
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                                         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4.2 1.5h3.6l-.6 3.1 2.1 2H2.7l2.1-2-.6-3.1z"/>
                                        <path d="M6 6.6v3.9"/>
                                    </svg>
                                </button>
                                <button
                                    className={`ai-conversation-action-btn ${conv.archivedAt ? 'active' : ''}`}
                                    onClick={(event) => ctx.toggleConversationArchived(conv.id, event)}
                                    title={conv.archivedAt ? '取消归档' : '归档'}
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                                         strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 3.5h8v6H2z"/>
                                        <path d="M1.5 2h9v1.5h-9z"/>
                                        <path d="M4.5 6h3"/>
                                    </svg>
                                </button>
                                <button
                                    className="ai-conversation-action-btn"
                                    onClick={(event) => startRename(event, conv)}
                                    title="重命名"
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                                         strokeWidth="1.3">
                                        <path d="M8.5 1.5a1.414 1.414 0 012 2L3.5 10.5l-3 .5.5-3 7.5-6.5z"/>
                                    </svg>
                                </button>
                                <button
                                    className="ai-conversation-action-btn ai-conversation-action-btn--danger"
                                    onClick={(event) => void ctx.deleteConversation(conv.id, event)}
                                    title="删除"
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                        <path
                                            d="M1.5 3h9M4 3V2a.857.857 0 01.857-.857h2.286A.857.857 0 018 2v1m-6 0v7a1.286 1.286 0 001.286 1.286h5.428A1.286 1.286 0 0010 10V3M4.857 5.143v3.428M7.143 5.143v3.428"
                                            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"
                                            strokeLinejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        )
                    })}
                </div>
            </aside>

            <main
                className={`ai-main${isCharacterConversation ? ' is-character' : ''}${isReportConversation ? ' is-report' : ''}`}>
                {isCharacterConversation && activeConversation?.backgroundImageUrl && (
                    <div className="ai-main-background" aria-hidden="true">
                        <img src={activeConversation.backgroundImageUrl}
                             alt={activeConversation.characterName ?? '角色背景'}/>
                    </div>
                )}
                <div className="ai-topbar">
                    <div className="ai-topbar-left">
                        <button
                            className="ai-topbar-toggle"
                            onClick={() => ctx.setSidebarCollapsed((prev) => !prev)}
                            title={ctx.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                {ctx.sidebarCollapsed ? (
                                    <path d="M6 3L11 8L6 13"/>
                                ) : (
                                    <path d="M10 3L5 8L10 13"/>
                                )}
                            </svg>
                        </button>
                        <div className="ai-plugin-switcher" ref={pluginSwitcherRef}>
                            {isPluginMenuOpen && (
                                <div className="ai-plugin-menu">
                                    {ctx.plugins.map((plugin) => (
                                        <button
                                            key={plugin.id}
                                            className={`ai-plugin-menu-item ${plugin.id === ctx.selectedPlugin ? 'active' : ''}`}
                                            onClick={() => {
                                                ctx.setSelectedPlugin(plugin.id)
                                                setIsPluginMenuOpen(false)
                                            }}
                                        >
                                            {plugin.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                className={`ai-topbar-btn ${isPluginMenuOpen ? 'active' : ''}`}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setIsPluginMenuOpen((prev) => !prev)
                                }}
                                title="切换插件"
                            >
                                <span>{ctx.plugins.find((plugin) => plugin.id === ctx.selectedPlugin)?.name || '选择插件'}</span>
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    <path d={isPluginMenuOpen ? 'M1 7l4-4 4 4' : 'M1 3l4 4 4-4'}/>
                                </svg>
                            </button>
                        </div>
                        {showFocusContext && (
                            <div className="ai-focus-context" aria-label="当前 AI 上下文" ref={focusContextRef}>
                                {focusContextItems.map((item) => (
                                    <span
                                        key={item.key}
                                        className="ai-focus-chip"
                                        title={item.label}
                                        data-overflow={overflowingFocusChips[item.key] ? 'true' : 'false'}
                                    >
                                        <span
                                            className="ai-focus-chip__text"
                                            ref={(element) => {
                                                focusChipTextRefs.current[item.key] = element
                                            }}
                                        >
                                            {item.label}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="ai-topbar-right">
                        <button
                            className="ai-topbar-new-chat"
                            onClick={() => void ctx.createNewConversation()}
                            title="新对话"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M8 3v10M3 8h10"/>
                            </svg>
                        </button>
                        <button
                            className="ai-topbar-toggle"
                            onClick={() => onTogglePanelMode?.()}
                            title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                {panelMode === 'fullscreen' ? (
                                    <>
                                        <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                                    </>
                                ) : (
                                    <>
                                        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                                    </>
                                )}
                            </svg>
                        </button>
                        <button
                            className="ai-topbar-toggle"
                            onClick={() => onToggleCollapsed?.()}
                            title="最小化"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M6 4l4 4-4 4"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <RollingBox axis="y"
                    className="ai-messages-container"
                    ref={messagesContainerRef}
                    onScroll={() => {
                        handleMessagesScroll()
                        linkPreview.closeLinkPreview()
                    }}
                    thumbSize={'thin'}
                >
                    {isReportConversation && activeConversation?.reportContext && (
                        <div className="ai-report-context-bar fc-status-banner">
                            <div className="ai-report-context-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
                                     strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                    <path
                                        d="M8.1 2.7L2.4 12.6a1.4 1.4 0 001.2 2.1h10.8a1.4 1.4 0 001.2-2.1L9.9 2.7a1.04 1.04 0 00-1.8 0z"/>
                                    <path d="M9 6.2v3.4M9 12.2h.01"/>
                                </svg>
                            </div>
                            <div className="ai-report-context-main">
                                <div className="ai-report-context-title">
                                    <span>矛盾检测</span>
                                    <strong>{activeConversation.reportContext.projectName}</strong>
                                </div>
                                <div
                                    className="ai-report-context-scope">{activeConversation.reportContext.scopeSummary}</div>
                            </div>
                        </div>
                    )}
                    {ctx.activeConversationId && ctx.messages.length > 0 && (
                        <div
                            className="ai-messages-list"
                            onClick={handleEntryLinkClick}
                            onMouseOver={handleEntryLinkMouseOver}
                            onMouseOut={handleEntryLinkMouseOut}
                        >
                            {ctx.messages.map((message) => (
                                <MessageBox
                                    key={message.id}
                                    role={message.role}
                                    blocks={message.role === 'assistant'
                                        ? buildRenderableAiChatBlocks(message.blocks)
                                        : message.blocks}
                                    content={message.role === 'assistant'
                                        ? buildRenderableAiChatMarkdown(message.content)
                                        : message.content}
                                    toolCallDetail={'verbose'}
                                    markdown={message.role === 'assistant'}
                                    lineHeight={1.5}
                                    reasoning={message.reasoning || undefined}
                                    rolePlaying={isCharacterConversation && message.role === 'assistant'}
                                    onCopy={() => navigator.clipboard.writeText(message.content)}
                                    onPlay={isCharacterConversation && message.role === 'assistant'
                                        ? () => void handlePlayRoleMessage(message.content, activeConversation?.characterVoiceId)
                                        : undefined}
                                    onEdit={message.role === 'user'
                                        ? () => ctx.editMessage(message.id)
                                        : undefined}
                                    onRegenerate={message.role === 'assistant'
                                        ? () => {
                                            logger.log('[AIChatContent] 点击重说', {
                                                messageId: message.id,
                                                conversationId: ctx.activeConversationId,
                                            })
                                            void ctx.regenerateMessage(message.id)
                                        }
                                        : undefined}
                                />
                            ))}
                            {ctx.streamingBlocks.length > 0 && ctx.isStreaming && (
                                <MessageBox
                                    role="assistant"
                                    blocks={buildRenderableAiChatBlocks(ctx.streamingBlocks)}
                                    lineHeight={1.5}
                                    streaming
                                    markdown
                                    rolePlaying={isCharacterConversation}
                                    toolCallDetail={'verbose'}
                                    onPlay={isCharacterConversation
                                        ? () => void handlePlayRoleMessage(
                                            ctx.streamingBlocks
                                                .filter((block) => block.type === 'content')
                                                .map((block) => block.content)
                                                .join(''),
                                            activeConversation?.characterVoiceId,
                                        )
                                        : undefined}
                                />
                            )}
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
                </RollingBox>

                {ctx.activeConversationId && ctx.messages.length > 0 && !autoScroll && (
                    <div className="ai-scroll-to-bottom-sticky">
                        <button className="ai-scroll-to-bottom-btn" onClick={scrollToBottom} title="滚动到底部">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.8">
                                <path d="M3 6l5 5 5-5"/>
                            </svg>
                        </button>
                    </div>
                )}

                <div className="ai-floating-input-wrapper ai-floating-input-wrapper--full">
                    <div className="ai-floating-input-inner" ref={inputWikiContainerRef}>
                        {ctx.editingMessageId && (
                            <div className="ai-edit-indicator">
                                <span>正在编辑上一条消息</span>
                                <button onClick={() => {
                                    ctx.setEditingMessageId(null)
                                    ctx.setInputValue('')
                                }}>取消
                                </button>
                            </div>
                        )}
                        {isArchivedConversation && activeConversation && (
                            <div className="ai-archived-input-hint" role="status">
                                <span>会话已归档，取消归档后可继续对话。</span>
                                <button
                                    type="button"
                                    onClick={(event) => ctx.toggleConversationArchived(activeConversation.id, event)}
                                >
                                    取消归档
                                </button>
                            </div>
                        )}
                        <textarea
                            ref={textareaRef}
                            className="ai-floating-textarea"
                            value={ctx.inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            onKeyUp={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onClick={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onSelect={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onScroll={(event) => inputWikiLink.updateWikiPopoverPosition(event.currentTarget)}
                            onBlur={() => inputWikiLink.handleTextareaBlur()}
                            disabled={isArchivedConversation}
                            placeholder={isArchivedConversation ? '取消归档后继续对话' : '请输入消息...'}
                        />
                        {inputLimitMessage && (
                            <div className="ai-input-limit-hint" role="status">
                                {inputLimitMessage}
                            </div>
                        )}
                        <EntryEditorWikiLink
                            wikiDraft={inputWikiLink.wikiDraft}
                            wikiPopoverPosition={inputWikiLink.wikiPopoverPosition}
                            wikiLinkOptions={inputWikiLink.wikiLinkOptions}
                            activeWikiOptionIndex={inputWikiLink.activeWikiOptionIndex}
                            creatingLinkedEntry={inputWikiLink.creatingLinkedEntry}
                            hasExactCategorySuggestion={inputWikiLink.hasExactCategorySuggestion}
                            categories={[]}
                            popoverRef={inputWikiPopoverRef}
                            optionRefs={inputWikiLink.wikiOptionRefs}
                            onOptionCommit={inputWikiLink.handleWikiOptionCommit}
                            onActiveIndexChange={inputWikiLink.setActiveWikiOptionIndex}
                        />
                        <div className="ai-floating-footer">
                            <div className="ai-floating-toolbar">
                                <button
                                    className={`ai-toolbar-btn ${ctx.sessionParams.thinking ? 'active' : ''}`}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        ctx.setSessionParams((prev) => ({...prev, thinking: !prev.thinking}))
                                    }}
                                    title="深度思考"
                                >
                                    深度思考
                                </button>
                                {isCharacterConversation && activeConversation && (
                                    <button
                                        className={`ai-toolbar-btn ${effectiveRoleplayAutoPlay ? 'active' : ''}`}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            const nextAutoPlay = !effectiveRoleplayAutoPlay
                                            ctx.updateConversationCharacterAutoPlay(activeConversation.id, nextAutoPlay)
                                        }}
                                        title="自动播放角色回复"
                                    >
                                        自动播放
                                    </button>
                                )}
                                {!isCharacterConversation && (
                                    <>
                                        <button
                                            className={`ai-toolbar-btn ${ctx.webSearchEnabled ? 'active' : ''}`}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                void ctx.toggleWebSearch()
                                            }}
                                            title="联网搜索"
                                        >
                                            联网搜索
                                        </button>
                                        <button
                                            className={`ai-toolbar-btn ${ctx.editModeEnabled ? 'active' : ''}`}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                void ctx.toggleEditMode()
                                            }}
                                            title={ctx.editModeEnabled ? '编辑模式' : '阅读模式'}
                                        >
                                            {ctx.editModeEnabled ? '编辑模式' : '阅读模式'}
                                        </button>
                                    </>
                                )}
                                <div className="ai-model-switcher" ref={modelSwitcherRef}>
                                    {isModelMenuOpen && selectedPluginInfo && (
                                        <div className="ai-model-menu">
                                            {selectedPluginInfo.models.map((model) => (
                                                <button
                                                    key={model}
                                                    className={`ai-model-menu-item ${model === ctx.selectedModel ? 'active' : ''}`}
                                                    onClick={() => {
                                                        ctx.setSelectedModel(model)
                                                        setIsModelMenuOpen(false)
                                                    }}
                                                >
                                                    {model}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        className={`ai-toolbar-btn ${isModelMenuOpen ? 'active' : ''}`}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            setIsModelMenuOpen((prev) => !prev)
                                        }}
                                        title="切换模型"
                                    >
                                        <span>{ctx.selectedModel || '选择模型'}</span>
                                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                                             stroke="currentColor" strokeWidth="1.5">
                                            <path d={isModelMenuOpen ? 'M1 7l4-4 4 4' : 'M1 3l4 4 4-4'}/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div className="ai-floating-actions">
                                {showCharHint && (
                                    <span className="ai-floating-char-count">{charCount}/{MAX_CHARS}</span>
                                )}
                                {ctx.isStreaming ? (
                                    <button
                                        className="ai-floating-stop-btn"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            ctx.stopStreaming()
                                        }}
                                        title="停止生成"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                            <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/>
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            if (!ctx.inputValue.trim()) return
                                            void handleSendCurrentInput()
                                        }}
                                        disabled={Boolean(sendDisabledReason)}
                                        title={sendDisabledReason || '发送'}
                                    >
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                                             strokeLinejoin="round">
                                            <path d="M12 20V4"/>
                                            <path d="M4.5 11.5L12 4l7.5 7.5"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </>
    )
}
