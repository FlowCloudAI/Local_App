import {logger} from '../../../shared/logger'
import {type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '../../../api/events'
import {
    ai_build_character_project_snapshot,
    ai_compact_conversation,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_character_conversation_meta,
    ai_get_conversation,
    ai_get_conversation_ui_state,
    ai_list_conversations,
    ai_list_plugins,
    ai_list_tools,
    ai_rename_conversation,
    ai_save_character_conversation_meta,
    ai_save_conversation_ui_state,
    ai_set_task_context,
    ai_update_conversation_settings,
    ai_update_message_attachments,
    ai_update_session,
    type AppSettings,
    type CharacterConversationMeta,
    type ConversationUiState,
    DOCCTX_UPDATED,
    db_get_entry,
    db_get_project,
    docctx_add_files,
    docctx_build_context,
    docctx_list_items,
    docctx_reassign_conversation,
    docctx_remove_item,
    docctx_retry_item,
    type DocumentContextItem,
    type DocumentContextUpdatedEvent,
    ENTRY_UPDATED,
    type EntryUpdatedEvent,
    type PluginInfo,
    setting_get_settings,
    type StoredConversationSettings,
    type StoredMessage,
    type StoredMessageAttachment,
    type TaskContextPayload,
    type ToolStatus,
    type UpdateSessionParams,
    formatApiError,
    toApiError,
} from '../../../api'
import {type SessionMessage, useAiSession} from './useAiSession'
import {estimateMessagesTokens} from '../lib/contextUsage'
import {isMissingBackendSessionError} from '../lib/sessionErrors'
import type {
    AiContextValue,
    AiFocusContext,
    Attachment,
    Conversation,
    ConversationSettings,
    ConversationRuntimeState,
    Message,
    ReportConversationContext,
    SessionParams,
    AiToolAccessMode,
} from '../model/AiControllerTypes'
import {DEFAULT_CONVERSATION_SETTINGS, normalizeConversationSettings} from '../model/AiControllerTypes'
import {toEntryImageSrc} from '../../entries/lib/entryImage'

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return `${cleaned.slice(0, 20)}...`
}

const createAiTraceId = () => `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const buildAiLogPreview = (content: string) => {
    const normalized = content.trim().replace(/\s+/g, ' ')
    return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

const runtimeConversationKey = (sessionId: string, runId: string) => `${sessionId}::${runId}`
const CHARACTER_CONVERSATION_META_STORAGE_KEY = 'flowcloudai.characterConversationMeta.v1'
const CONVERSATION_SYSTEM_PROMPT_ATTRIBUTE = 'conversation_system_prompt'
const DOCUMENT_CONTEXT_ATTRIBUTE = 'attached_documents'
const DOCUMENT_CONTEXT_CHAR_BUDGET = 24_000
const WEB_TOOL_NAMES = ['web_search', 'open_url']
const READER_TOOL_NAMES = [
    'list_projects',
    'search_entries',
    'get_entry',
    'get_entry_content_by_line',
    'list_all_entries',
    'list_categories',
    'list_entries_by_type',
    'query_categories',
    'list_tag_schemas',
    'get_entry_relations',
    'get_project_summary',
    'list_entry_types',
    'report_progress',
]

function isToolEnabledForAccessMode(
    toolName: string,
    mode: AiToolAccessMode,
    webSearchEnabled: boolean,
): boolean {
    if (WEB_TOOL_NAMES.includes(toolName)) return webSearchEnabled
    if (mode === 'reader') return READER_TOOL_NAMES.includes(toolName)
    return true
}

type PreparedAiSession = { sid: string; runId: string; conversationId: string }

const mergeDocumentContextItems = (
    current: Record<string, DocumentContextItem[]>,
    items: DocumentContextItem[],
) => {
    if (items.length === 0) return current
    const next = {...current}
    let changed = false

    items.forEach((item) => {
        const conversationId = item.conversationId
        if (!conversationId) return
        const list = next[conversationId] ?? []
        const existingIndex = list.findIndex((existing) => existing.id === item.id)
        const nextList = existingIndex >= 0
            ? list.map((existing, index) => index === existingIndex ? item : existing)
            : [item, ...list]
        next[conversationId] = nextList.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        changed = true
    })

    return changed ? next : current
}

const getGlobalDefaultPrompt = (settings: AppSettings | null): string =>
    settings?.llm?.app_sense_custom_prompt.trim() ?? ''

const getConversationSpecificPrompt = (
    settings: ConversationSettings | null | undefined,
    appSettings: AppSettings | null,
): string => {
    const prompt = settings?.systemPrompt.trim() ?? ''
    if (!prompt) return ''

    const globalPrompt = getGlobalDefaultPrompt(appSettings)
    return globalPrompt && prompt === globalPrompt ? '' : prompt
}

const toStoredConversationSettings = (
    settings: ConversationSettings,
    appSettings: AppSettings | null = null,
): StoredConversationSettings => ({
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenaltyEnabled: settings.frequencyPenaltyEnabled,
    frequencyPenalty: settings.frequencyPenalty,
    presencePenaltyEnabled: settings.presencePenaltyEnabled,
    presencePenalty: settings.presencePenalty,
    systemPrompt: getConversationSpecificPrompt(settings, appSettings),
})

const buildSessionUpdateParams = (
    settings: ConversationSettings,
    thinking: boolean,
): UpdateSessionParams => ({
    thinking,
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenalty: settings.frequencyPenaltyEnabled ? settings.frequencyPenalty : 0,
    presencePenalty: settings.presencePenaltyEnabled ? settings.presencePenalty : 0,
})

const buildDefaultConversationSettings = (settings: AppSettings | null): ConversationSettings => {
    const llm = settings?.llm
    return normalizeConversationSettings({
        temperature: llm?.temperature ?? DEFAULT_CONVERSATION_SETTINGS.temperature,
        topP: llm?.top_p ?? DEFAULT_CONVERSATION_SETTINGS.topP,
        frequencyPenaltyEnabled: Boolean(llm && llm.frequency_penalty !== 0),
        frequencyPenalty: llm?.frequency_penalty ?? DEFAULT_CONVERSATION_SETTINGS.frequencyPenalty,
        presencePenaltyEnabled: Boolean(llm && llm.presence_penalty !== 0),
        presencePenalty: llm?.presence_penalty ?? DEFAULT_CONVERSATION_SETTINGS.presencePenalty,
        systemPrompt: getGlobalDefaultPrompt(settings),
    })
}

const conversationSettingsPatchAffectsContext = (patch: Partial<ConversationSettings>) => (
    Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')
)

const normalizeConversationSettingsWithGlobalPrompt = (
    settings: Partial<ConversationSettings> | null | undefined,
    mode: Conversation['mode'] | undefined,
    appSettings: AppSettings | null,
): ConversationSettings => {
    const normalized = normalizeConversationSettings(settings)
    const globalPrompt = getGlobalDefaultPrompt(appSettings)
    if ((mode == null || mode === 'default') && !normalized.systemPrompt.trim() && globalPrompt) {
        return {...normalized, systemPrompt: globalPrompt}
    }
    return normalized
}

const createDraftConversation = (
    pluginId: string,
    model: string,
    settings: ConversationSettings = DEFAULT_CONVERSATION_SETTINGS,
): Conversation => ({
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: '新对话',
    messages: [],
    pluginId,
    model,
    sessionId: null,
    runId: null,
    timestamp: Date.now(),
    pinnedAt: null,
    archivedAt: null,
    mode: 'default',
    characterEntryId: null,
    characterName: null,
    backgroundImageUrl: null,
    characterVoiceId: null,
    characterAutoPlay: null,
    reportContext: null,
    reportSeeded: false,
    settings: normalizeConversationSettings(settings),
})

const isEmptyDraftConversation = (conversation: Conversation) =>
    conversation.id.startsWith('conv_')
    && conversation.messages.length === 0
    && (!conversation.mode || conversation.mode === 'default')

interface StoredCharacterConversationMeta {
    mode?: 'character' | 'report' | null
    characterEntryId: string | null
    characterName: string | null
    backgroundImageUrl: string | null
    characterVoiceId: string | null
    characterAutoPlay: boolean | null
    reportContext?: ReportConversationContext | null
    reportSeeded?: boolean | null
}

function buildReportBootstrapPrompt(reportContext: ReportConversationContext, userQuestion: string): string {
    return [
        `你正在和用户讨论一份“${reportContext.projectName}”项目的设定矛盾检测报告。`,
        '请把这份报告当作本轮对话的唯一核心上下文，优先解释报告中的结论、证据与修复建议。',
        '如果用户质疑某条结论，请先引用报告中的相关问题、证据和未决问题，再给出分析。',
        reportContext.truncated
            ? '注意：这份报告的检测范围经过裁剪，若结论依赖额外资料，请明确说明证据可能不足。'
            : '这份报告覆盖的是当前选定范围内的资料。',
        '除非用户明确要求，不要在自然语言回答中直接展示内部 ID；需要引用具体词条时，优先使用标准 Markdown 链接格式：[词条标题](entry://词条ID)。',
        `报告范围：${reportContext.scopeSummary}`,
        `来源词条 ID（仅供定位）：${reportContext.sourceEntryIds.join('、') || '无'}`,
        '报告 JSON 如下：',
        reportContext.reportJson,
        '',
        `用户问题：${userQuestion}`,
    ].join('\n')
}

function inferCharacterConversationMeta(title: string): StoredCharacterConversationMeta | null {
    const matched = /^和「(.+)」聊天$/.exec(title.trim())
    if (!matched) return null
    return {
        characterEntryId: null,
        characterName: matched[1] || null,
        backgroundImageUrl: null,
        characterVoiceId: null,
        characterAutoPlay: null,
    }
}

function readStoredCharacterConversationMetaMap(): Record<string, StoredCharacterConversationMeta> {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(CHARACTER_CONVERSATION_META_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return {}
        return parsed as Record<string, StoredCharacterConversationMeta>
    } catch {
        return {}
    }
}

function writeStoredCharacterConversationMetaMap(conversations: Conversation[]) {
    if (typeof window === 'undefined') return
    try {
        const stored: Record<string, StoredCharacterConversationMeta> = {}
        conversations.forEach((conversation) => {
            if (conversation.mode !== 'character' && conversation.mode !== 'report') return
            stored[conversation.id] = {
                mode: conversation.mode,
                characterEntryId: conversation.characterEntryId ?? null,
                characterName: conversation.characterName ?? null,
                backgroundImageUrl: conversation.backgroundImageUrl ?? null,
                characterVoiceId: conversation.characterVoiceId ?? null,
                characterAutoPlay: conversation.characterAutoPlay ?? null,
                reportContext: conversation.reportContext ?? null,
                reportSeeded: conversation.reportSeeded ?? null,
            }
        })
        window.localStorage.setItem(CHARACTER_CONVERSATION_META_STORAGE_KEY, JSON.stringify(stored))
    } catch {
        logger.warn('写入特殊会话元数据缓存失败')
    }
}

function normalizeStoredSpecialConversationMetaMap(
    fileMetaMap: Record<string, CharacterConversationMeta>,
): Record<string, StoredCharacterConversationMeta> {
    const normalized: Record<string, StoredCharacterConversationMeta> = {}
    Object.entries(fileMetaMap).forEach(([conversationId, meta]) => {
        normalized[conversationId] = {
            mode: meta.mode,
            characterEntryId: meta.characterEntryId ?? null,
            characterName: meta.characterName ?? null,
            backgroundImageUrl: meta.backgroundImageUrl ?? null,
            characterVoiceId: meta.characterVoiceId ?? null,
            characterAutoPlay: meta.characterAutoPlay ?? null,
            reportContext: (meta.reportContext as ReportConversationContext | null | undefined) ?? null,
            reportSeeded: meta.reportSeeded ?? null,
        }
    })
    return normalized
}

function buildCharacterConversationMetaMap(conversations: Conversation[]): Record<string, CharacterConversationMeta> {
    const metadata: Record<string, CharacterConversationMeta> = {}
    conversations.forEach((conversation) => {
        if (conversation.mode !== 'character' && conversation.mode !== 'report') return
        metadata[conversation.id] = {
            mode: conversation.mode,
            characterEntryId: conversation.characterEntryId ?? null,
            characterName: conversation.characterName ?? null,
            backgroundImageUrl: conversation.backgroundImageUrl ?? null,
            characterVoiceId: conversation.characterVoiceId ?? null,
            characterAutoPlay: conversation.characterAutoPlay ?? null,
            reportContext: conversation.reportContext ?? null,
            reportSeeded: conversation.reportSeeded ?? null,
        }
    })
    return metadata
}

function buildConversationUiStateMap(conversations: Conversation[]): Record<string, ConversationUiState> {
    const state: Record<string, ConversationUiState> = {}
    conversations.forEach((conversation) => {
        if (!conversation.pinnedAt && !conversation.archivedAt) return
        state[conversation.id] = {
            pinnedAt: conversation.pinnedAt ?? null,
            archivedAt: conversation.archivedAt ?? null,
        }
    })
    return state
}

const documentItemToAttachment = (item: DocumentContextItem): Attachment => ({
    id: item.id,
    name: item.fileName,
    type: 'file',
    data: item.id,
    documentContextItemId: item.id,
    extension: item.extension,
    sha256: item.sha256,
    status: item.status,
})

const storedAttachmentToMessageAttachment = (attachment: StoredMessageAttachment): Attachment => ({
    id: attachment.attachmentId,
    name: attachment.fileName,
    type: 'file',
    data: attachment.documentContextItemId,
    documentContextItemId: attachment.documentContextItemId,
    extension: attachment.extension,
    sha256: attachment.sha256,
    status: attachment.status,
})

const messageAttachmentToStored = (attachment: Attachment): StoredMessageAttachment | null => {
    if (attachment.type !== 'file' || !attachment.documentContextItemId) return null
    return {
        attachmentId: attachment.id,
        documentContextItemId: attachment.documentContextItemId,
        fileName: attachment.name,
        extension: attachment.extension ?? '',
        sha256: attachment.sha256 ?? '',
        status: attachment.status ?? 'ready',
    }
}

const messageAttachmentsToStored = (attachments: Attachment[] | undefined): StoredMessageAttachment[] =>
    (attachments ?? [])
        .map(messageAttachmentToStored)
        .filter((attachment): attachment is StoredMessageAttachment => Boolean(attachment))

const mergeDocumentAttachmentItemIds = (...groups: Array<string[] | undefined>): string[] => {
    const merged: string[] = []
    groups.forEach((group) => {
        group?.forEach((itemId) => {
            if (itemId && !merged.includes(itemId)) merged.push(itemId)
        })
    })
    return merged
}

const collectDocumentAttachmentItemIds = (messages: Message[]): string[] =>
    mergeDocumentAttachmentItemIds(messages.flatMap((message) =>
        (message.attachments ?? [])
            .map((attachment) => attachment.documentContextItemId)
            .filter((itemId): itemId is string => Boolean(itemId)),
    ))

const collectDocumentAttachmentItemIdsUntilMessage = (
    messages: Message[],
    targetMessageId: string,
): string[] => {
    const collected: Message[] = []
    for (const message of messages) {
        collected.push(message)
        if (message.id === targetMessageId) break
    }
    return collectDocumentAttachmentItemIds(collected)
}

const storedToMessages = (messages: StoredMessage[]): Message[] => {
    const result: Message[] = []
    let pendingAssistant: Message | null = null

    const flushPendingAssistant = () => {
        if (!pendingAssistant) return
        if (pendingAssistant.blocks && pendingAssistant.blocks.length > 0) {
            result.push(pendingAssistant)
        }
        pendingAssistant = null
    }

    const ensureAssistant = (message: StoredMessage, index: number) => {
        if (!pendingAssistant) {
            pendingAssistant = {
                id: message.message_id ?? `loaded_assistant_${index}_${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? undefined,
                blocks: [],
            }
        }
        return pendingAssistant
    }

    messages.forEach((message, index) => {
        if (message.role === 'user') {
            flushPendingAssistant()
        }

        if (message.role === 'tool') {
            const assistant = pendingAssistant
            if (!assistant?.blocks) return
            const toolBlockIndex = assistant.blocks.findIndex((block) => {
                if (block.type !== 'tool') return false
                return block.tool.result == null
            })
            if (toolBlockIndex === -1) return

            const nextBlocks = [...assistant.blocks]
            const block = nextBlocks[toolBlockIndex]
            if (block.type === 'tool') {
                nextBlocks[toolBlockIndex] = {
                    ...block,
                    tool: {
                        ...block.tool,
                        result: message.content ?? '',
                        isError: false,
                    },
                }
                pendingAssistant = {...assistant, blocks: nextBlocks}
            }
            return
        }

        if (message.role === 'assistant') {
            const assistant = ensureAssistant(message, index)
            const nextBlocks = [...(assistant.blocks ?? [])]

            if (message.reasoning) {
                nextBlocks.push({type: 'reasoning', content: message.reasoning})
            }
            if (message.tool_calls && message.tool_calls.length > 0) {
                message.tool_calls.forEach((toolCall) => {
                    const name = toolCall.function?.name ?? toolCall.name ?? ''
                    const args = toolCall.function?.arguments ?? toolCall.arguments ?? ''
                    const last = nextBlocks[nextBlocks.length - 1]

                    if (last && last.type === 'tool_use'
                        && last.tools.length > 0
                        && last.tools[0].name === name) {
                        nextBlocks[nextBlocks.length - 1] = {
                            ...last,
                            tools: [...last.tools, {index: toolCall.index, name, args}],
                        }
                    } else if (last && last.type === 'tool'
                        && last.tool.name === name
                        && last.tool.result == null) {
                        nextBlocks[nextBlocks.length - 1] = {
                            type: 'tool_use',
                            tools: [last.tool, {index: toolCall.index, name, args}],
                            detail: 'verbose',
                        }
                    } else {
                        nextBlocks.push({
                            type: 'tool',
                            tool: {index: toolCall.index, name, args},
                            detail: 'verbose',
                        })
                    }
                })
            }
            if (message.content) {
                nextBlocks.push({type: 'content', content: message.content, markdown: true})
            }

            pendingAssistant = {
                ...assistant,
                content: assistant.content + (message.content ?? ''),
                reasoning: assistant.reasoning
                    ? `${assistant.reasoning}${message.reasoning ?? ''}`
                    : (message.reasoning || undefined),
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? assistant.nodeId,
                blocks: nextBlocks,
            }
            return
        }

        const base: Message = {
            id: message.message_id ?? `loaded_${index}_${Date.now()}`,
            role: message.role as 'user' | 'assistant',
            content: message.content ?? '',
            reasoning: message.reasoning || undefined,
            timestamp: new Date(message.timestamp).getTime(),
            nodeId: message.node_id ?? undefined,
            attachments: message.attachments?.map(storedAttachmentToMessageAttachment),
        }

        if (message.content) {
            base.blocks = [{type: 'content', content: message.content}]
        }

        result.push(base)
    })

    flushPendingAssistant()
    return result
}

export interface AiFocus {
    projectId: string | null
    entryId: string | null
}

export function useAiController(focus: AiFocus): AiContextValue {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [pluginsReady, setPluginsReady] = useState(false)
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const appSettingsRef = useRef<AppSettings | null>(null)
    const pluginsRef = useRef<PluginInfo[]>([])
    useEffect(() => {
        pluginsRef.current = plugins
    }, [plugins])
    const selectedPluginRef = useRef(selectedPlugin)
    const selectedModelRef = useRef(selectedModel)
    useEffect(() => {
        selectedPluginRef.current = selectedPlugin
    }, [selectedPlugin])
    useEffect(() => {
        selectedModelRef.current = selectedModel
    }, [selectedModel])

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [unreadConversationIds, setUnreadConversationIds] = useState<Record<string, boolean>>({})
    const [conversationMetaLoaded, setConversationMetaLoaded] = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
    const [autoScroll, setAutoScroll] = useState(true)

    const [inputValue, setInputValue] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [sessionParams, setSessionParams] = useState<SessionParams>({thinking: true})
    const sessionParamsRef = useRef(sessionParams)
    useEffect(() => { sessionParamsRef.current = sessionParams }, [sessionParams])
    const [tools, setTools] = useState<ToolStatus[]>([])
    const [webSearchEnabled, setWebSearchEnabled] = useState(true)
    const [toolAccessMode, setToolAccessModeState] = useState<AiToolAccessMode>('assistant')
    const [writerModeAvailable, setWriterModeAvailable] = useState(false)
    const editModeEnabled = toolAccessMode !== 'reader'

    const conversationsRef = useRef(conversations)
    useEffect(() => {
        conversationsRef.current = conversations
    }, [conversations])

    const focusRef = useRef(focus)
    useEffect(() => {
        focusRef.current = focus
    }, [focus])

    const projectNameCacheRef = useRef<Map<string, string>>(new Map())
    // Map value: snippet string（含空字符串），undefined 表示未缓存
    const entrySnippetCacheRef = useRef<Map<string, string>>(new Map())
    const entryTitleCacheRef = useRef<Map<string, string>>(new Map())
    const conversationSettingsSaveTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})
    const [focusContext, setFocusContext] = useState<AiFocusContext>({
        projectId: focus.projectId,
        projectName: null,
        entryId: focus.entryId,
        entryTitle: null,
        editModeEnabled,
        webSearchEnabled,
    })

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeConversationId),
        [conversations, activeConversationId],
    )

    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])
    const [documentContextItemsByConversation, setDocumentContextItemsByConversation] = useState<Record<string, DocumentContextItem[]>>({})
    const documentContextItemsByConversationRef = useRef(documentContextItemsByConversation)
    useEffect(() => {
        documentContextItemsByConversationRef.current = documentContextItemsByConversation
    }, [documentContextItemsByConversation])
    const [pendingDocumentAttachmentIdsByConversation, setPendingDocumentAttachmentIdsByConversation] = useState<Record<string, string[]>>({})
    const pendingDocumentAttachmentIdsByConversationRef = useRef(pendingDocumentAttachmentIdsByConversation)
    useEffect(() => {
        pendingDocumentAttachmentIdsByConversationRef.current = pendingDocumentAttachmentIdsByConversation
    }, [pendingDocumentAttachmentIdsByConversation])
    const documentContextItems = useMemo(
        () => activeConversationId ? (documentContextItemsByConversation[activeConversationId] ?? []) : [],
        [activeConversationId, documentContextItemsByConversation],
    )
    const pendingDocumentAttachmentItems = useMemo(() => {
        if (!activeConversationId) return []
        const items = documentContextItemsByConversation[activeConversationId] ?? []
        const itemsById = new Map(items.map((item) => [item.id, item]))
        return (pendingDocumentAttachmentIdsByConversation[activeConversationId] ?? [])
            .map((itemId) => itemsById.get(itemId))
            .filter((item): item is DocumentContextItem => Boolean(item))
    }, [activeConversationId, documentContextItemsByConversation, pendingDocumentAttachmentIdsByConversation])

    const activeConversationRef = useRef(activeConversation)
    useEffect(() => {
        activeConversationRef.current = activeConversation
    }, [activeConversation])

    const syncPluginSelection = useCallback((pluginList: PluginInfo[], settings: AppSettings | null) => {
        setPlugins(pluginList)

        const preferredPluginId = activeConversationRef.current?.pluginId
            || selectedPluginRef.current
            || settings?.llm?.plugin_id
            || ''
        const nextPlugin = pluginList.find((plugin) => plugin.id === preferredPluginId)
            ?? pluginList[0]
            ?? null
        const nextPluginId = nextPlugin?.id ?? ''

        setSelectedPlugin(nextPluginId)

        if (!nextPlugin) {
            setSelectedModel('')
            return
        }

        const preferredModel = activeConversationRef.current?.model
            || selectedModelRef.current
            || settings?.llm?.default_model
            || ''
        const nextModel = preferredModel && nextPlugin.models.includes(preferredModel)
            ? preferredModel
            : (nextPlugin.default_model ?? nextPlugin.models[0] ?? '')

        setSelectedModel(nextModel)
    }, [])

    const refreshAiSidebarState = useCallback(async (includeTools = false) => {
        const [pluginList, settings, fetchedTools] = await Promise.all([
            ai_list_plugins('llm'),
            setting_get_settings().catch(() => null),
            includeTools ? ai_list_tools() : Promise.resolve(null),
        ])

        appSettingsRef.current = settings
        setWriterModeAvailable(Boolean(settings?.llm?.writer_mode_enabled))
        syncPluginSelection(pluginList, settings)
        setPluginsReady(true)

        if (fetchedTools) {
            const nextMode: AiToolAccessMode = 'assistant'
            const enableOps = fetchedTools.map((tool) => ai_enable_tool(tool.name))
            void Promise.all(enableOps)
            setTools(fetchedTools.map((tool) => ({
                ...tool,
                enabled: isToolEnabledForAccessMode(tool.name, nextMode, true),
            })))
            setWebSearchEnabled(true)
            setToolAccessModeState(nextMode)
        }
    }, [syncPluginSelection])

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const loadDocumentContextItems = useCallback(async (conversationId: string) => {
        const items = await docctx_list_items(conversationId)
        setDocumentContextItemsByConversation((current) => ({
            ...current,
            [conversationId]: items,
        }))
    }, [])

    const migrateDocumentContextConversation = useCallback(async (
        fromConversationId: string,
        toConversationId: string,
    ) => {
        if (fromConversationId === toConversationId) return []
        const migrated = await docctx_reassign_conversation(fromConversationId, toConversationId)
        setDocumentContextItemsByConversation((current) => {
            const next = {...current}
            delete next[fromConversationId]
            if (migrated.length > 0) {
                next[toConversationId] = migrated
            } else if (current[fromConversationId]?.length) {
                next[toConversationId] = current[fromConversationId].map((item) => ({
                    ...item,
                    conversationId: toConversationId,
                }))
            }
            return next
        })
        setPendingDocumentAttachmentIdsByConversation((current) => {
            const pendingIds = current[fromConversationId]
            if (!pendingIds?.length) return current
            const next = {...current}
            delete next[fromConversationId]
            next[toConversationId] = pendingIds
            return next
        })
        return migrated
    }, [])

    const runtimeConversationRef = useRef<Record<string, string>>({})
    const abortControllerRef = useRef<AbortController | null>(null)
    const sessionApiRef = useRef<ReturnType<typeof useAiSession> | null>(null)
    const autoCompactInFlightRef = useRef<Set<string>>(new Set())

    const maybeAutoCompactAfterMessage = useCallback(async (
        conversationId: string,
        message: SessionMessage,
    ) => {
        if (!message.nodeId) return

        const settings = await setting_get_settings().catch(() => appSettingsRef.current)
        if (settings) appSettingsRef.current = settings
        const compactSettings = settings?.llm
        if (!compactSettings?.auto_compact_enabled) return

        const conversation = conversationsRef.current.find((item) => item.id === conversationId)
        if (!conversation || conversation.mode !== 'default') return

        const plugin = pluginsRef.current.find((item) => item.id === conversation.pluginId)
        const modelInfo = plugin?.model_infos.find((item) => item.id === conversation.model)
        const contextWindowTokens = modelInfo?.context_window_tokens ?? null
        if (!contextWindowTokens || contextWindowTokens <= 0) return

        const messagesForEstimate = conversation.messages.some((item) => item.id === message.id)
            ? conversation.messages
            : [...conversation.messages, {content: message.content}]
        const estimatedTokens = estimateMessagesTokens(messagesForEstimate)
        const usageTokens = message.usage?.total_tokens ?? 0
        const usedTokens = Math.max(usageTokens, estimatedTokens)
        const usageRatio = usedTokens / contextWindowTokens
        if (usageRatio < compactSettings.auto_compact_threshold_ratio) return

        const inFlightKey = `${conversationId}:${message.nodeId}`
        if (autoCompactInFlightRef.current.has(inFlightKey)) return
        autoCompactInFlightRef.current.add(inFlightKey)

        try {
            const result = await ai_compact_conversation({
                conversationId,
                pluginId: conversation.pluginId,
                model: conversation.model,
                headNodeId: message.nodeId,
                recentMessages: compactSettings.auto_compact_recent_messages,
                detail: compactSettings.auto_compact_detail,
            })
            logger.log('[useAiController][自动压缩] 压缩检查完成', {
                conversationId,
                applied: result.applied,
                positionNodeId: result.positionNodeId ?? null,
                summaryChars: result.summaryChars,
                usageRatio,
                usageTokens: message.usage?.total_tokens ?? null,
                estimatedTokens,
            })
            if (!result.applied) return

            await sessionApiRef.current?.closeSession(message.sessionId)
            delete runtimeConversationRef.current[runtimeConversationKey(message.sessionId, message.runId)]
            setConversations((prev) => prev.map((item) =>
                item.id === conversationId ? {...item, sessionId: null, runId: null} : item,
            ))
        } catch (error) {
            logger.warn('[useAiController][自动压缩] 压缩失败', {
                conversationId,
                error,
            })
        } finally {
            autoCompactInFlightRef.current.delete(inFlightKey)
        }
    }, [])

    const persistUserMessageAttachments = useCallback((
        conversationId: string,
        userMessage: Message | null | undefined,
    ) => {
        if (!userMessage?.nodeId || !userMessage.attachments?.length) return
        const attachments = messageAttachmentsToStored(userMessage.attachments)
        if (attachments.length === 0) return
        ai_update_message_attachments(conversationId, userMessage.nodeId, attachments)
            .catch((error) => {
                logger.warn('[useAiController] 持久化消息附件失败', {
                    conversationId,
                    nodeId: userMessage.nodeId,
                    error,
                })
            })
    }, [])

    const onMessage = useCallback((message: SessionMessage) => {
        const targetConversationId =
            runtimeConversationRef.current[runtimeConversationKey(message.sessionId, message.runId)]
        const resolvedConversationId = targetConversationId
            ?? conversationsRef.current.find((conversation) => (
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            ))?.id
            ?? null

        let latestUserMessageWithAttachments: Message | null = null
        setConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation
            latestUserMessageWithAttachments = [...conversation.messages]
                .reverse()
                .find((item) => item.role === 'user' && Boolean(item.nodeId) && Boolean(item.attachments?.length))
                ?? null
            return {
                ...conversation,
                messages: [...conversation.messages, {
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    timestamp: message.timestamp,
                    reasoning: message.reasoning,
                    blocks: message.blocks,
                    nodeId: message.nodeId,
                    usage: message.usage,
                }],
            }
        }))
        if (resolvedConversationId) {
            setUnreadConversationIds((prev) => {
                const next = {...prev}
                if (resolvedConversationId === activeConversationIdRef.current) {
                    delete next[resolvedConversationId]
                } else {
                    next[resolvedConversationId] = true
                }
                return next
            })
        }
        if (resolvedConversationId) {
            void maybeAutoCompactAfterMessage(resolvedConversationId, message)
            persistUserMessageAttachments(resolvedConversationId, latestUserMessageWithAttachments)
        }
    }, [maybeAutoCompactAfterMessage, persistUserMessageAttachments])

    const onUserTurnBegin = useCallback((payload: { sessionId: string; runId: string; nodeId: number }) => {
        const targetConversationId =
            runtimeConversationRef.current[runtimeConversationKey(payload.sessionId, payload.runId)]

        setConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === payload.sessionId && conversation.runId === payload.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation

            const targetIndex = [...conversation.messages]
                .reverse()
                .findIndex((message) => message.role === 'user' && message.nodeId == null)
            if (targetIndex === -1) return conversation

            const actualIndex = conversation.messages.length - 1 - targetIndex
            const targetMessage = conversation.messages[actualIndex]
            if (!targetMessage || targetMessage.role !== 'user' || targetMessage.nodeId != null) {
                return conversation
            }

            const nextMessages = [...conversation.messages]
            nextMessages[actualIndex] = {
                ...targetMessage,
                nodeId: payload.nodeId,
            }

            return {
                ...conversation,
                messages: nextMessages,
            }
        }))
    }, [])

    const onError = useCallback((message: string) => {
        logger.error('[useAiController]', message)
    }, [])

    const session = useAiSession({onMessage, onUserTurnBegin, onError})
    useEffect(() => {
        sessionApiRef.current = session
    }, [session])

    const selectConversation = useCallback((convId: string | null) => {
        activeConversationIdRef.current = convId
        setActiveConversationId(convId)
        const conversation = convId
            ? conversationsRef.current.find((item) => item.id === convId)
            : null
        session.activateSession(conversation?.sessionId ?? null, conversation?.runId ?? null)
        if (convId) {
            setUnreadConversationIds((prev) => {
                if (!prev[convId]) return prev
                const next = {...prev}
                delete next[convId]
                return next
            })
        }
    }, [session])

    const conversationRuntime = useMemo<Record<string, ConversationRuntimeState>>(() => {
        const result: Record<string, ConversationRuntimeState> = {}
        conversations.forEach((conversation) => {
            const isStreaming = conversation.runId ? Boolean(session.streamingByRun[conversation.runId]) : false
            result[conversation.id] = {
                isStreaming,
                hasUnreadReply: !isStreaming && Boolean(unreadConversationIds[conversation.id]),
            }
        })
        return result
    }, [conversations, session.streamingByRun, unreadConversationIds])

    useEffect(() => {
        const currentConversationId = activeConversationIdRef.current
        if (!currentConversationId || !session.sessionId || !session.runId || session.lastUserNodeId == null) {
            return
        }

        setConversations((prev) => prev.map((conversation) => {
            if (
                conversation.id !== currentConversationId
                || conversation.sessionId !== session.sessionId
                || conversation.runId !== session.runId
            ) {
                return conversation
            }

            const targetIndex = [...conversation.messages]
                .reverse()
                .findIndex((message) => message.role === 'user' && message.nodeId == null)

            if (targetIndex === -1) return conversation

            const actualIndex = conversation.messages.length - 1 - targetIndex
            const targetMessage = conversation.messages[actualIndex]
            if (!targetMessage || targetMessage.role !== 'user' || targetMessage.nodeId != null) {
                return conversation
            }

            const nextMessages = [...conversation.messages]
            nextMessages[actualIndex] = {
                ...targetMessage,
                nodeId: session.lastUserNodeId ?? undefined,
            }

            return {
                ...conversation,
                messages: nextMessages,
            }
        }))
    }, [session.lastUserNodeId, session.runId, session.sessionId])

    // 分支切换后重新加载对话消息（新分支路径上的消息可能不同）
    useEffect(() => {
        if (session.branchSwitchVersion === 0) return
        const convId = activeConversationIdRef.current
        if (!convId || convId.startsWith('conv_')) return
        ai_get_conversation(convId).then(stored => {
            if (!stored) return
            setConversations(prev => prev.map(c =>
                c.id === convId
                    ? {
                        ...c,
                        messages: storedToMessages(stored.messages),
                        settings: normalizeConversationSettingsWithGlobalPrompt(
                            stored.settings,
                            c.mode,
                            appSettingsRef.current,
                        ),
                    }
                    : c,
            ))
        }).catch(() => {})
    }, [session.branchSwitchVersion])

    // 词条内容更新时清除对应缓存，避免下次推送旧摘要
    useEffect(() => {
        const unlisten = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (e) => {
            entrySnippetCacheRef.current.delete(e.payload.entry_id)
            entryTitleCacheRef.current.delete(e.payload.entry_id)
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    useEffect(() => {
        const unlisten = listen<DocumentContextUpdatedEvent>(DOCCTX_UPDATED, (event) => {
            setDocumentContextItemsByConversation((current) =>
                mergeDocumentContextItems(current, [event.payload.item]),
            )
            setConversations((current) => current.map((conversation) => ({
                ...conversation,
                messages: conversation.messages.map((message) => {
                    if (!message.attachments?.some((attachment) =>
                        attachment.documentContextItemId === event.payload.item.id,
                    )) {
                        return message
                    }
                    return {
                        ...message,
                        attachments: message.attachments.map((attachment) =>
                            attachment.documentContextItemId === event.payload.item.id
                                ? documentItemToAttachment(event.payload.item)
                                : attachment,
                        ),
                    }
                }),
            })))
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    useEffect(() => {
        const conversationId = activeConversationId
        if (!conversationId) return
        loadDocumentContextItems(conversationId).catch((error) => {
            logger.warn('[useAiController] 加载文档上下文列表失败', {conversationId, error})
        })
    }, [activeConversationId, loadDocumentContextItems])

    useEffect(() => {
        let cancelled = false

        const loadFocusContext = async () => {
            const [projectResult, entryResult] = await Promise.allSettled([
                focus.projectId ? (async () => {
                    const cached = projectNameCacheRef.current.get(focus.projectId!)
                    if (cached !== undefined) return cached
                    const project = await db_get_project(focus.projectId!)
                    projectNameCacheRef.current.set(focus.projectId!, project.name)
                    return project.name
                })() : Promise.resolve(null),
                focus.entryId ? (async () => {
                    const cached = entryTitleCacheRef.current.get(focus.entryId!)
                    if (cached !== undefined) return cached
                    const entry = await db_get_entry(focus.entryId!)
                    entryTitleCacheRef.current.set(focus.entryId!, entry.title)
                    return entry.title
                })() : Promise.resolve(null),
            ])

            if (cancelled) return
            setFocusContext({
                projectId: focus.projectId,
                projectName: projectResult.status === 'fulfilled' ? projectResult.value : null,
                entryId: focus.entryId,
                entryTitle: entryResult.status === 'fulfilled' ? entryResult.value : null,
                editModeEnabled,
                webSearchEnabled,
            })
        }

        void loadFocusContext()

        return () => {
            cancelled = true
        }
    }, [editModeEnabled, focus.entryId, focus.projectId, webSearchEnabled])

    const resolveContextPayload = useCallback(async (
        projectId: string | null,
        entryId: string | null,
        conversationSettings?: ConversationSettings | null,
    ): Promise<TaskContextPayload> => {
        const attributes: Record<string, string> = {}
        const [projResult, entryResult] = await Promise.allSettled([
            projectId ? (async () => {
                const cached = projectNameCacheRef.current.get(projectId)
                if (cached !== undefined) return cached
                const proj = await db_get_project(projectId)
                projectNameCacheRef.current.set(projectId, proj.name)
                return proj.name
            })() : Promise.resolve(null),
            entryId ? (async () => {
                if (entrySnippetCacheRef.current.has(entryId)) {
                    return entrySnippetCacheRef.current.get(entryId)!
                }
                const entry = await db_get_entry(entryId)
                const snippet = entry.content?.slice(0, 500) ?? ''
                entrySnippetCacheRef.current.set(entryId, snippet)
                return snippet
            })() : Promise.resolve(null),
        ])

        if (projectId) {
            attributes.project_id = projectId
            if (projResult.status === 'fulfilled' && projResult.value) {
                attributes.project_name = projResult.value
            }
        }
        if (entryId) {
            attributes.entry_id = entryId
            if (entryResult.status === 'fulfilled' && entryResult.value) {
                attributes.entry_snippet = entryResult.value
            }
        }
        const systemPrompt = getConversationSpecificPrompt(
            conversationSettings ?? null,
            appSettingsRef.current,
        )
        if (systemPrompt) {
            attributes[CONVERSATION_SYSTEM_PROMPT_ATTRIBUTE] = [
                '当前对话独有提示词如下。它只作用于当前对话，不代表全局设置。',
                systemPrompt,
            ].join('\n')
        }

        const hints: string[] = []
        if (!webSearchEnabled) {
            hints.push(
                '用户已禁用 "web_search" 和 "open_url" 工具。' +
                '若问题涉及联网获取信息，请勿主观臆断，而是告知用户开启"联网搜索"功能后再试。'
            )
        }
        if (!editModeEnabled) {
            hints.push(
                '用户当前处于读者模式，所有写入类工具已被禁用。' +
                '若用户要求修改内容，请告知其切换到"助手模式"或"作家模式"后再操作。'
            )
        } else if (toolAccessMode === 'assistant') {
            hints.push('用户当前处于助手模式，写入和删除操作必须等待用户确认后才能执行。')
        } else if (toolAccessMode === 'writer') {
            hints.push(
                '用户当前处于作家模式，常规新建、改写和移动操作可直接执行；删除类操作仍必须等待用户确认。'
            )
        }
        if (hints.length > 0) {
            attributes.ai_instructions = hints.join('\n')
        }

        return {
            attributes: {
                ...attributes,
                ai_tool_mode: toolAccessMode,
            },
            flags: {
                read_only: toolAccessMode === 'reader',
                auto_confirm_writes: toolAccessMode === 'writer',
            },
        }
    }, [editModeEnabled, toolAccessMode, webSearchEnabled])

    const appendDocumentContext = useCallback(async (
        ctx: TaskContextPayload,
        conversationId: string,
        itemIds: string[] = [],
    ): Promise<TaskContextPayload> => {
        const selectedItemIds = mergeDocumentAttachmentItemIds(itemIds)
        if (selectedItemIds.length === 0) return ctx

        try {
            const result = await docctx_build_context({
                conversationId,
                itemIds: selectedItemIds,
                maxChars: DOCUMENT_CONTEXT_CHAR_BUDGET,
            })
            if (result.sources.length === 0 || !result.markdown.trim()) return ctx
            return {
                ...ctx,
                attributes: {
                    ...(ctx.attributes ?? {}),
                    [DOCUMENT_CONTEXT_ATTRIBUTE]: result.markdown,
                },
            }
        } catch (error) {
            logger.warn('[useAiController] 构建文档上下文失败，继续使用基础上下文', {
                conversationId,
                error,
            })
            return ctx
        }
    }, [])

    // tab 切换、session 建立或对话提示词变化时推送最新焦点上下文
    useEffect(() => {
        const sid = session.sessionId
        if (!sid) return
        let cancelled = false
        const conversationId = activeConversationRef.current?.id ?? null
        const settings = activeConversationRef.current?.settings ?? DEFAULT_CONVERSATION_SETTINGS
        const documentAttachmentItemIds = activeConversationRef.current
            ? collectDocumentAttachmentItemIds(activeConversationRef.current.messages)
            : []
        resolveContextPayload(focus.projectId, focus.entryId, settings).then(async (ctx) => {
            if (cancelled) return
            const enrichedCtx = conversationId
                ? await appendDocumentContext(ctx, conversationId, documentAttachmentItemIds)
                : ctx
            if (cancelled) return
            ai_set_task_context(sid, enrichedCtx).catch(() => {
            })
        }).catch(() => {
        })
        return () => {
            cancelled = true
        }
    }, [activeConversation?.settings.systemPrompt, activeConversationId, focus.projectId, focus.entryId, session.sessionId, resolveContextPayload, appendDocumentContext])

    useEffect(() => {
        let mounted = true
        refreshAiSidebarState(true).catch((error) => {
            if (!mounted) return
            logger.error('初始化 AI 侧栏状态失败', error)
        })
        return () => {
            mounted = false
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        const handler = () => {
            refreshAiSidebarState(false).catch((error) => {
                logger.error('插件变更后刷新 AI 插件列表失败', error)
            })
        }
        window.addEventListener('fc:plugins-changed', handler)
        return () => window.removeEventListener('fc:plugins-changed', handler)
    }, [refreshAiSidebarState])

    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            refreshAiSidebarState(true).catch((error) => {
                logger.error('后端就绪后刷新 AI 侧栏状态失败', error)
            })
        })
        return () => {
            unlisten.then((fn) => fn())
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        let mounted = true
        const init = async () => {
            const [metas, fileMetaMap, uiStateMap] = await Promise.all([
                ai_list_conversations().catch(
                    () => [] as Awaited<ReturnType<typeof ai_list_conversations>>,
                ),
                ai_get_character_conversation_meta().catch(() => ({} as Record<string, CharacterConversationMeta>)),
                ai_get_conversation_ui_state().catch(() => ({} as Record<string, ConversationUiState>)),
            ])
            if (!mounted) return

            if (metas.length > 0) {
                const storedMetaMap = {
                    ...readStoredCharacterConversationMetaMap(),
                    ...normalizeStoredSpecialConversationMetaMap(fileMetaMap),
                }
                const convs: Conversation[] = metas.map((meta) => (
                    buildConversationFromMeta(meta, storedMetaMap, uiStateMap)
                ))

                setConversations(convs)
                setActiveConversationId(null)
            } else {
                setConversations([])
                setActiveConversationId(null)
            }
            setConversationMetaLoaded(true)
        }

        void init()
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        if (!conversationMetaLoaded) return
        writeStoredCharacterConversationMetaMap(conversations)
        void ai_save_character_conversation_meta(buildCharacterConversationMetaMap(conversations)).catch((error) => {
            logger.warn('写入特殊会话元数据文件失败', error)
        })
        void ai_save_conversation_ui_state(buildConversationUiStateMap(conversations)).catch((error) => {
            logger.warn('写入会话 UI 状态失败', error)
        })
    }, [conversationMetaLoaded, conversations])

    useEffect(() => {
        if (!selectedPlugin || plugins.length === 0) return
        const plugin = plugins.find((item) => item.id === selectedPlugin)
        if (!plugin) return
        if (!selectedModel || !plugin.models.includes(selectedModel)) {
            const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
            if (defaultModel) setSelectedModel(defaultModel)
        }
    }, [selectedPlugin, plugins]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!conversationMetaLoaded || !pluginsReady || !selectedPlugin || !selectedModel) return
        if (activeConversationIdRef.current) return

        const existingDraft = conversationsRef.current.find(isEmptyDraftConversation)
        if (existingDraft) {
            setConversations((prev) => prev.map((conversation) =>
                conversation.id === existingDraft.id
                    ? {
                        ...conversation,
                        pluginId: selectedPlugin,
                        model: selectedModel,
                        settings: normalizeConversationSettingsWithGlobalPrompt(
                            conversation.settings,
                            conversation.mode,
                            appSettingsRef.current,
                        ),
                    }
                    : conversation,
            ))
            setActiveConversationId(existingDraft.id)
            activeConversationIdRef.current = existingDraft.id
            session.activateSession(null, null)
            return
        }

        const draft = createDraftConversation(
            selectedPlugin,
            selectedModel,
            buildDefaultConversationSettings(appSettingsRef.current),
        )
        setConversations((prev) => [draft, ...prev])
        setActiveConversationId(draft.id)
        activeConversationIdRef.current = draft.id
        session.activateSession(null, null)
    }, [conversationMetaLoaded, pluginsReady, selectedModel, selectedPlugin, session])

    useEffect(() => {
        if (!activeConversationId?.startsWith('conv_') || !selectedPlugin || !selectedModel) return
        setConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== activeConversationId || !isEmptyDraftConversation(conversation)) {
                return conversation
            }
            if (conversation.pluginId === selectedPlugin && conversation.model === selectedModel) {
                return conversation
            }
            return {...conversation, pluginId: selectedPlugin, model: selectedModel}
        }))
    }, [activeConversationId, selectedModel, selectedPlugin])

    useEffect(() => {
        if (!session.sessionId) return
        const settings = activeConversationRef.current?.settings ?? DEFAULT_CONVERSATION_SETTINGS
        void ai_update_session(
            session.sessionId,
            buildSessionUpdateParams(settings, sessionParams.thinking),
        ).catch(logger.error)
    }, [activeConversation?.settings, sessionParams, session.sessionId])

    const createNewConversation = useCallback(async () => {
        if (!selectedPlugin || !selectedModel) {
            session.activateSession(null, null)
            setActiveConversationId(null)
            activeConversationIdRef.current = null
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
            return
        }

        const draft = createDraftConversation(
            selectedPlugin,
            selectedModel,
            buildDefaultConversationSettings(appSettingsRef.current),
        )
        session.activateSession(null, null)
        setConversations((prev) => [
            draft,
            ...prev.filter((conversation) => !isEmptyDraftConversation(conversation)),
        ])
        setActiveConversationId(draft.id)
        activeConversationIdRef.current = draft.id
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [selectedModel, selectedPlugin, session])

    const startReportDiscussion = useCallback(async ({
                                                         title,
                                                         pluginId,
                                                         model,
                                                         reportContext,
                                                     }: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => {
        const conversation: Conversation = {
            id: `conv_report_${Date.now()}`,
            title,
            messages: [{
                id: `assistant_report_${Date.now()}`,
                role: 'assistant',
                content: '已载入这份矛盾检测报告。你可以继续追问某条冲突的依据、影响范围，或让我把建议改写成可执行的修订方案。',
                timestamp: Date.now(),
            }],
            pluginId,
            model,
            sessionId: null,
            runId: null,
            timestamp: Date.now(),
            pinnedAt: null,
            archivedAt: null,
            mode: 'report',
            characterEntryId: null,
            characterName: null,
            backgroundImageUrl: null,
            characterVoiceId: null,
            characterAutoPlay: null,
            reportContext,
            reportSeeded: false,
            settings: normalizeConversationSettings(),
        }

        setSelectedPlugin(pluginId)
        setSelectedModel(model)
        setConversations((prev) => [conversation, ...prev])
        setActiveConversationId(conversation.id)
        activeConversationIdRef.current = conversation.id
        session.activateSession(null, null)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [session])

    const startCharacterConversation = useCallback(async ({projectId, entryId}: {
        projectId: string
        entryId: string
    }) => {
        if (!selectedPlugin || !selectedModel) {
            throw new Error('当前 AI 插件或模型尚未准备好，请稍后重试。')
        }

        const built = await ai_build_character_project_snapshot(projectId, entryId)
        if ((built.characterEntry.type ?? '').trim().toLowerCase() !== 'character') {
            throw new Error('当前词条不是角色类型，无法开启角色对话。')
        }

        const created = await session.createCharacterSession(selectedPlugin, selectedModel, {
            characterName: built.characterEntry.title,
            projectSnapshot: built.snapshot,
            maxToolRounds: sessionParams.maxToolRounds,
        })
        if (!created) return

        const conversation: Conversation = {
            id: created.conversationId,
            title: `和「${built.characterEntry.title}」聊天`,
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            sessionId: created.sessionId,
            runId: created.runId,
            timestamp: Date.now(),
            pinnedAt: null,
            archivedAt: null,
            mode: 'character',
            characterEntryId: entryId,
            characterName: built.characterEntry.title,
            backgroundImageUrl: toEntryImageSrc(built.backgroundImage) ?? null,
            characterVoiceId: built.characterVoiceId,
            characterAutoPlay: built.characterAutoPlay,
            reportContext: null,
            reportSeeded: false,
            settings: normalizeConversationSettings(),
        }
        runtimeConversationRef.current[
            runtimeConversationKey(created.sessionId, created.runId)
            ] = created.conversationId
        setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)])
        setActiveConversationId(conversation.id)
        activeConversationIdRef.current = conversation.id
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [selectedModel, selectedPlugin, session, sessionParams.maxToolRounds])

    const updateConversationCharacterAutoPlay = useCallback((convId: string, autoPlay: boolean) => {
        setConversations((prev) => prev.map((conversation) => (
            conversation.id === convId
                ? {...conversation, characterAutoPlay: autoPlay}
                : conversation
        )))
    }, [])

    const persistConversationSettings = useCallback((
        convId: string,
        settings: ConversationSettings,
        immediate = false,
    ) => {
        if (convId.startsWith('conv_')) return
        const timers = conversationSettingsSaveTimersRef.current
        if (timers[convId]) {
            window.clearTimeout(timers[convId])
            delete timers[convId]
        }

        const save = () => {
            void ai_update_conversation_settings(
                convId,
                toStoredConversationSettings(settings, appSettingsRef.current),
            )
                .then((saved) => {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {...conversation, settings: normalizeConversationSettings(saved)}
                            : conversation,
                    ))
                })
                .catch((error) => {
                    logger.warn('写入对话独有设置失败', {convId, error})
                })
        }

        if (immediate) {
            save()
            return
        }
        timers[convId] = window.setTimeout(() => {
            delete timers[convId]
            save()
        }, 450)
    }, [])

    const updateConversationSettings = useCallback(async (
        convId: string,
        patch: Partial<ConversationSettings>,
    ) => {
        let nextSettings: ConversationSettings | null = null
        setConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== convId) return conversation
            nextSettings = normalizeConversationSettings({
                ...conversation.settings,
                ...patch,
            })
            return {
                ...conversation,
                settings: nextSettings,
            }
        }))
        if (!nextSettings) return

        const current = conversationsRef.current.find((conversation) => conversation.id === convId)
        if (current?.sessionId) {
            void ai_update_session(
                current.sessionId,
                buildSessionUpdateParams(nextSettings, sessionParamsRef.current.thinking),
            ).catch(logger.error)
            if (conversationSettingsPatchAffectsContext(patch)) {
                void resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    nextSettings,
                )
                    .then((ctx) => ai_set_task_context(current.sessionId!, ctx))
                    .catch(logger.error)
            }
        }
        persistConversationSettings(convId, nextSettings)
    }, [persistConversationSettings, resolveContextPayload])

    const switchActiveConversationModel = useCallback(async (pluginId: string, model: string) => {
        if (!pluginId || !model) return
        setSelectedPlugin(pluginId)
        setSelectedModel(model)

        const conv = activeConversationRef.current
        if (!conv) return
        if (conv.pluginId === pluginId && conv.model === model) return
        if (conv.runId && session.isRunStreaming(conv.runId)) return

        if (conv.sessionId) {
            await session.closeSession(conv.sessionId)
        }
        if (conv.sessionId && conv.runId) {
            delete runtimeConversationRef.current[runtimeConversationKey(conv.sessionId, conv.runId)]
        }

        setConversations((prev) => prev.map((conversation) =>
            conversation.id === conv.id
                ? {
                    ...conversation,
                    pluginId,
                    model,
                    sessionId: null,
                    runId: null,
                }
                : conversation,
        ))
        session.activateSession(null, null)
    }, [session])

    useEffect(() => () => {
        Object.values(conversationSettingsSaveTimersRef.current).forEach((timer) => {
            window.clearTimeout(timer)
        })
        conversationSettingsSaveTimersRef.current = {}
    }, [])

    const switchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationIdRef.current) return
        setActiveConversationId(convId)
        activeConversationIdRef.current = convId
        setUnreadConversationIds((prev) => {
            if (!prev[convId]) return prev
            const next = {...prev}
            delete next[convId]
            return next
        })
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)

        const targetConv = conversationsRef.current.find((conversation) => conversation.id === convId)
        if (targetConv) {
            session.activateSession(targetConv.sessionId, targetConv.runId)
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)

            if (targetConv.messages.length === 0 && !targetConv.id.startsWith('conv_')) {
                const stored = await ai_get_conversation(targetConv.id).catch(() => null)
                if (stored) {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {
                                ...conversation,
                                messages: storedToMessages(stored.messages),
                                settings: normalizeConversationSettingsWithGlobalPrompt(
                                    stored.settings,
                                    conversation.mode,
                                    appSettingsRef.current,
                                ),
                            }
                            : conversation,
                    ))
                }
            }
        }
    }, [session])

    const deleteConversation = useCallback(async (convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        const conv = conversationsRef.current.find((conversation) => conversation.id === convId)

        if (conv?.sessionId) {
            await session.closeSession(conv.sessionId)
        }
        if (conv && !conv.id.startsWith('conv_')) {
            await ai_delete_conversation(conv.id).catch(logger.error)
        }

        setConversations((prev) => prev.filter((conversation) => conversation.id !== convId))
        setUnreadConversationIds((prev) => {
            if (!prev[convId]) return prev
            const next = {...prev}
            delete next[convId]
            return next
        })
        Object.entries(runtimeConversationRef.current).forEach(([key, mappedConvId]) => {
            if (mappedConvId === convId) {
                delete runtimeConversationRef.current[key]
            }
        })

        if (activeConversationIdRef.current === convId) {
            session.activateSession(null, null)
            setActiveConversationId(null)
            activeConversationIdRef.current = null
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
        }
    }, [session])

    const renameConversation = useCallback(async (convId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === convId ? {...conversation, title: trimmed} : conversation,
        ))
        await ai_rename_conversation(convId, trimmed).catch(logger.error)
    }, [])

    const toggleConversationPinned = useCallback((convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === convId
                ? {...conversation, pinnedAt: conversation.pinnedAt ? null : new Date().toISOString()}
                : conversation,
        ))
    }, [])

    const toggleConversationArchived = useCallback((convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        const nextArchivedAt = conversationsRef.current.find((conversation) => conversation.id === convId)?.archivedAt
            ? null
            : new Date().toISOString()
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === convId
                ? {...conversation, archivedAt: nextArchivedAt}
                : conversation,
        ))
        if (activeConversationIdRef.current === convId && nextArchivedAt) {
            setInputValue('')
            setEditingMessageId(null)
        }
    }, [])

    const addDocumentContextFiles = useCallback(async (filePaths: string[]) => {
        const conversationId = activeConversationIdRef.current
        if (!conversationId || filePaths.length === 0) return
        const items = await docctx_add_files(conversationId, filePaths)
        setDocumentContextItemsByConversation((current) =>
            mergeDocumentContextItems(current, items),
        )
        setPendingDocumentAttachmentIdsByConversation((current) => {
            const existing = current[conversationId] ?? []
            const nextIds = items.map((item) => item.id)
            const merged = [...existing]
            nextIds.forEach((itemId) => {
                if (!merged.includes(itemId)) merged.push(itemId)
            })
            return {
                ...current,
                [conversationId]: merged,
            }
        })
    }, [])

    const removeDocumentContextItem = useCallback(async (itemId: string) => {
        await docctx_remove_item(itemId)
        setDocumentContextItemsByConversation((current) => {
            const next = {...current}
            Object.entries(next).forEach(([conversationId, items]) => {
                const filtered = items.filter((item) => item.id !== itemId)
                if (filtered.length === items.length) return
                if (filtered.length === 0) {
                    delete next[conversationId]
                } else {
                    next[conversationId] = filtered
                }
            })
            return next
        })
        setPendingDocumentAttachmentIdsByConversation((current) => {
            let changed = false
            const next = {...current}
            Object.entries(next).forEach(([conversationId, itemIds]) => {
                const filtered = itemIds.filter((id) => id !== itemId)
                if (filtered.length === itemIds.length) return
                changed = true
                if (filtered.length === 0) {
                    delete next[conversationId]
                } else {
                    next[conversationId] = filtered
                }
            })
            return changed ? next : current
        })
    }, [])

    const retryDocumentContextItem = useCallback(async (itemId: string) => {
        const item = await docctx_retry_item(itemId)
        setDocumentContextItemsByConversation((current) =>
            mergeDocumentContextItems(current, [item]),
        )
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const trimmed = content.trim()
        if (!trimmed) return

        const traceId = createAiTraceId()
        const activeConv = activeConversationRef.current ?? null
        if (activeConv?.archivedAt) return
        logger.log('[useAiController][发送链路] 用户触发发送', {
            traceId,
            activeConversationId: activeConv?.id ?? null,
            hasSession: Boolean(activeConv?.sessionId),
            sessionId: activeConv?.sessionId ?? null,
            runId: activeConv?.runId ?? null,
            pluginId: activeConv?.pluginId ?? selectedPlugin,
            model: activeConv?.model ?? selectedModel,
            messageLength: trimmed.length,
            messageChars: [...trimmed].length,
            messagePreview: buildAiLogPreview(trimmed),
        })
        if (activeConv?.runId && session.isRunStreaming(activeConv.runId)) return

        const draftConversation: Conversation | null = activeConv
            ? null
            : createDraftConversation(
                selectedPlugin,
                selectedModel,
                buildDefaultConversationSettings(appSettingsRef.current),
            )
        const currentConv = activeConv ?? draftConversation
        if (!currentConv) return
        const currentConvId = currentConv.id
        const currentSettings = normalizeConversationSettings(currentConv.settings)
        const syncPreparedSessionContext = async (
            target: PreparedAiSession,
            documentAttachmentItemIds: string[] = [],
        ) => {
            try {
                await ai_update_session(
                    target.sid,
                    buildSessionUpdateParams(currentSettings, sessionParamsRef.current.thinking),
                )
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    currentSettings,
                )
                const enrichedCtx = await appendDocumentContext(ctx, target.conversationId, documentAttachmentItemIds)
                await ai_set_task_context(target.sid, enrichedCtx)
            } catch (error) {
                logger.warn('[useAiController][发送链路] 同步对话独有设置失败，继续发送消息', {
                    traceId,
                    sessionId: target.sid,
                    error,
                })
            }
        }
        const recreateMissingSession = async (failedSession: PreparedAiSession): Promise<PreparedAiSession | null> => {
            logger.warn('[useAiController][发送链路] 后端会话不存在，准备重建后继续发送', {
                traceId,
                conversationId: failedSession.conversationId,
                sessionId: failedSession.sid,
                runId: failedSession.runId,
            })

            delete runtimeConversationRef.current[runtimeConversationKey(failedSession.sid, failedSession.runId)]
            session.activateSession(null, null)
            setConversations((prev) => prev.map((conversation) =>
                conversation.id === failedSession.conversationId
                    ? {...conversation, sessionId: null, runId: null}
                    : conversation,
            ))

            const isPending = failedSession.conversationId.startsWith('conv_')
            const created = await session.createSession(
                currentConv.pluginId || selectedPlugin,
                currentConv.model || selectedModel,
                isPending ? undefined : failedSession.conversationId,
                sessionParams.maxToolRounds,
                traceId,
                toStoredConversationSettings(currentSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) return null

            const nextConversationId = isPending ? created.conversationId : failedSession.conversationId
            if (isPending && nextConversationId !== failedSession.conversationId) {
                await migrateDocumentContextConversation(failedSession.conversationId, nextConversationId)
            }
            runtimeConversationRef.current[
                runtimeConversationKey(created.sessionId, created.runId)
            ] = nextConversationId
            setConversations((prev) => prev.map((conversation) =>
                conversation.id === failedSession.conversationId
                    ? {
                        ...conversation,
                        id: nextConversationId,
                        sessionId: created.sessionId,
                        runId: created.runId,
                    }
                    : conversation,
            ))
            if (activeConversationIdRef.current === failedSession.conversationId) {
                setActiveConversationId(nextConversationId)
                activeConversationIdRef.current = nextConversationId
            }

            logger.log('[useAiController][发送链路] 后端会话重建完成', {
                traceId,
                previousSessionId: failedSession.sid,
                sessionId: created.sessionId,
                runId: created.runId,
                conversationId: nextConversationId,
            })
            return {sid: created.sessionId, runId: created.runId, conversationId: nextConversationId}
        }

        if (draftConversation) {
            logger.log('[useAiController][发送链路] 当前没有激活对话，创建前端草稿对话', {
                traceId,
                draftConversationId: draftConversation.id,
                pluginId: selectedPlugin,
                model: selectedModel,
            })
            setConversations((prev) => [draftConversation, ...prev])
            setActiveConversationId(draftConversation.id)
            activeConversationIdRef.current = draftConversation.id
            session.activateSession(null, null)
            setAutoScroll(true)
        }

        abortControllerRef.current = new AbortController()

        let sessionClosedForEdit = false
        let messagesBeforeNewUser = currentConv.messages

        if (editingMessageId) {
            const editIdx = currentConv.messages.findIndex((message) => message.id === editingMessageId)
            if (editIdx !== -1) {
                messagesBeforeNewUser = currentConv.messages.slice(0, editIdx)
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, messages: conversation.messages.slice(0, editIdx)}
                        : conversation,
                ))
                const precedingMsg = editIdx > 0 ? currentConv.messages[editIdx - 1] : null
                if (precedingMsg?.nodeId && currentConv.sessionId && currentConv.runId) {
                    session.activateSession(currentConv.sessionId, currentConv.runId)
                    await session.checkoutForEdit(precedingMsg.nodeId, currentConv.sessionId, currentConv.runId)
                } else if (currentConv.sessionId) {
                    await session.closeSession(currentConv.sessionId)
                    sessionClosedForEdit = true
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === currentConvId
                            ? {...conversation, sessionId: null, runId: null}
                            : conversation,
                    ))
                }
            }
            setEditingMessageId(null)
        }

        const documentAttachmentItemIdsForSend = mergeDocumentAttachmentItemIds(
            collectDocumentAttachmentItemIds(messagesBeforeNewUser),
            pendingDocumentAttachmentIdsByConversationRef.current[currentConvId],
        )
        const existingSid = sessionClosedForEdit ? null : currentConv.sessionId
        const existingRunId = sessionClosedForEdit ? null : currentConv.runId
        const preparedSession = await (async (): Promise<PreparedAiSession | null> => {
            if (existingSid && existingRunId) {
                logger.log('[useAiController][发送链路] 复用当前对话已有后端会话', {
                    traceId,
                    conversationId: currentConvId,
                    sessionId: existingSid,
                    runId: existingRunId,
                })
                session.activateSession(existingSid, existingRunId)
                runtimeConversationRef.current[runtimeConversationKey(existingSid, existingRunId)] = currentConvId
                return {sid: existingSid, runId: existingRunId, conversationId: currentConvId}
            }

            logger.log('[useAiController][发送链路] 开始同步工具状态', {
                traceId,
                conversationId: currentConvId,
                toolCount: tools.length,
            })
            await new Promise<void>((resolve) => {
                setTools((latest) => {
                    Promise.all(
                        latest.map(async (tool) => {
                            try {
                                if (tool.enabled) {
                                    await ai_enable_tool(tool.name)
                                } else {
                                    await ai_disable_tool(tool.name)
                                }
                            } catch (error) {
                                logger.warn('[useAiController][发送链路] 工具状态同步单项失败', {
                                    traceId,
                                    toolName: tool.name,
                                    enabled: tool.enabled,
                                    error,
                                })
                            }
                        }),
                    ).finally(resolve)
                    return latest
                })
            })
            logger.log('[useAiController][发送链路] 工具状态同步完成，准备创建后端会话', {
                traceId,
                conversationId: currentConvId,
            })

            const isPending = currentConvId.startsWith('conv_')
            const desiredSessionId = isPending ? undefined : currentConvId
            const created = await session.createSession(
                selectedPlugin,
                selectedModel,
                desiredSessionId,
                sessionParams.maxToolRounds,
                traceId,
                toStoredConversationSettings(currentSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) return null
            logger.log('[useAiController][发送链路] 后端会话创建完成', {
                traceId,
                requestedConversationId: desiredSessionId ?? null,
                resolvedConversationId: created.conversationId,
                sessionId: created.sessionId,
                runId: created.runId,
            })

            // 立即同步本对话参数，避免首轮对话使用旧默认值
            await ai_update_session(
                created.sessionId,
                buildSessionUpdateParams(currentSettings, sessionParamsRef.current.thinking),
            ).then(() => {
                logger.log('[useAiController][发送链路] 会话参数同步完成', {
                    traceId,
                    sessionId: created.sessionId,
                    thinking: sessionParamsRef.current.thinking,
                })
            }).catch((error) => {
                logger.warn('[useAiController][发送链路] 会话参数同步失败', {
                    traceId,
                    sessionId: created.sessionId,
                    error,
                })
            })

            const nextConversationId = isPending ? created.conversationId : currentConvId
            if (isPending && nextConversationId !== currentConvId) {
                await migrateDocumentContextConversation(currentConvId, nextConversationId)
            }

            // 兜底推送：session 刚建立时 effect 可能尚未触发，确保首轮 assemble 有上下文
            try {
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    currentSettings,
                )
                const enrichedCtx = await appendDocumentContext(
                    ctx,
                    nextConversationId,
                    documentAttachmentItemIdsForSend,
                )
                logger.log('[useAiController][发送链路] 准备推送任务上下文', {
                    traceId,
                    sessionId: created.sessionId,
                    projectId: enrichedCtx.attributes?.project_id ?? null,
                    entryId: enrichedCtx.attributes?.entry_id ?? null,
                    hasDocumentContext: Boolean(enrichedCtx.attributes?.[DOCUMENT_CONTEXT_ATTRIBUTE]),
                    readOnly: enrichedCtx.flags?.read_only ?? null,
                })
                await ai_set_task_context(created.sessionId, enrichedCtx)
                logger.log('[useAiController][发送链路] 任务上下文推送完成', {
                    traceId,
                    sessionId: created.sessionId,
                })
            } catch (error) {
                logger.warn('[useAiController][发送链路] 任务上下文推送失败，继续发送消息', {
                    traceId,
                    sessionId: created.sessionId,
                    error,
                })
            }

            runtimeConversationRef.current[
                runtimeConversationKey(created.sessionId, created.runId)
                ] = nextConversationId

            if (isPending) {
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, id: created.conversationId, sessionId: created.sessionId, runId: created.runId}
                        : conversation,
                ))
                setActiveConversationId(created.conversationId)
                activeConversationIdRef.current = created.conversationId
            } else {
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, sessionId: created.sessionId, runId: created.runId}
                        : conversation,
                ))
            }

            return {sid: created.sessionId, runId: created.runId, conversationId: nextConversationId}
        })()
        if (!preparedSession) return

        const pendingAttachmentIds =
            pendingDocumentAttachmentIdsByConversationRef.current[preparedSession.conversationId]
            ?? pendingDocumentAttachmentIdsByConversationRef.current[currentConvId]
            ?? []
        const pendingItems =
            documentContextItemsByConversationRef.current[preparedSession.conversationId]
            ?? documentContextItemsByConversationRef.current[currentConvId]
            ?? []
        const pendingItemsById = new Map(pendingItems.map((item) => [item.id, item]))
        const userAttachments = pendingAttachmentIds
            .map((itemId) => pendingItemsById.get(itemId))
            .filter((item): item is DocumentContextItem => Boolean(item))
            .map(documentItemToAttachment)

        await syncPreparedSessionContext(preparedSession, documentAttachmentItemIdsForSend)

        const actualPrompt = currentConv.mode === 'report'
        && !currentConv.reportSeeded
        && currentConv.reportContext
            ? buildReportBootstrapPrompt(currentConv.reportContext, trimmed)
            : trimmed

        const userMessage: Message = {
            id: `u_${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
            attachments: userAttachments.length > 0 ? userAttachments : undefined,
        }

        setConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== preparedSession.conversationId) return conversation
            const isFirstMessage = conversation.messages.length === 0
            return {
                ...conversation,
                title: isFirstMessage && conversation.mode !== 'character' && conversation.mode !== 'report'
                    ? generateTitleFromMessage(trimmed)
                    : conversation.title,
                messages: [...conversation.messages, userMessage],
                reportSeeded: conversation.mode === 'report' ? true : conversation.reportSeeded,
            }
        }))

        setInputValue('')
        if (pendingAttachmentIds.length > 0) {
            setPendingDocumentAttachmentIdsByConversation((current) => {
                const next = {...current}
                delete next[currentConvId]
                delete next[preparedSession.conversationId]
                return next
            })
        }
        logger.log('[useAiController][发送链路] 用户消息已写入前端状态，准备进入 session 发送', {
            traceId,
            conversationId: preparedSession.conversationId,
            sessionId: preparedSession.sid,
            runId: preparedSession.runId,
            actualPromptLength: actualPrompt.length,
            isReportBootstrap: actualPrompt !== trimmed,
        })
        try {
            await session.sendMessage(actualPrompt, preparedSession.sid, preparedSession.runId, traceId)
        } catch (error) {
            if (!isMissingBackendSessionError(error)) {
                logger.error('[useAiController][发送链路] 发送失败且无法自动恢复', {
                    traceId,
                    sessionId: preparedSession.sid,
                    runId: preparedSession.runId,
                    error,
                })
                onError(`发送失败: ${formatApiError(toApiError(error))}`)
                return
            }

            const recoveredSession = await recreateMissingSession(preparedSession)
            if (!recoveredSession) return
            await syncPreparedSessionContext(recoveredSession, documentAttachmentItemIdsForSend)
            logger.log('[useAiController][发送链路] 会话重建后重试发送', {
                traceId,
                conversationId: recoveredSession.conversationId,
                sessionId: recoveredSession.sid,
                runId: recoveredSession.runId,
            })
            try {
                await session.sendMessage(actualPrompt, recoveredSession.sid, recoveredSession.runId, traceId)
            } catch (retryError) {
                logger.error('[useAiController][发送链路] 会话重建后重试仍失败', {
                    traceId,
                    sessionId: recoveredSession.sid,
                    runId: recoveredSession.runId,
                    error: retryError,
                })
                onError(`发送失败: ${formatApiError(toApiError(retryError))}`)
            }
        }
    }, [
        editingMessageId,
        selectedModel,
        selectedPlugin,
        session,
        resolveContextPayload,
        appendDocumentContext,
        migrateDocumentContextConversation,
        sessionParams.maxToolRounds,
        tools.length,
        toolAccessMode,
        webSearchEnabled,
        onError,
    ])

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort()
        const conv = activeConversationRef.current
        void session.cancelSession(conv?.sessionId)
    }, [session])

    const regenerateMessage = useCallback(async (messageId: string) => {
        logger.log('[useAiController] 进入重说', {
            messageId,
            activeConversationId: activeConversationIdRef.current,
            sessionId: session.sessionId,
            isStreaming: session.isStreaming,
        })
        const conv = conversationsRef.current.find((conversation) => conversation.id === activeConversationIdRef.current)
        if (!conv) {
            logger.warn('[useAiController] 重说被阻止：未找到对话')
            return
        }

        if (conv.runId && session.isRunStreaming(conv.runId)) {
            logger.warn('[useAiController] 重说被阻止：当前仍在流式输出中，尝试取消后重试', {
                isStreaming: session.isRunStreaming(conv.runId),
                blocksLen: session.blocks.length,
                sessionId: conv.sessionId,
            })
            await session.cancelSession(conv.sessionId)
            await new Promise(resolve => setTimeout(resolve, 100))
            if (session.isRunStreaming(conv.runId)) {
                logger.error('[useAiController] 重说失败：取消后仍处于流式状态，无法继续')
                return
            }
        }

        const messageIndex = conv.messages.findIndex((message) => message.id === messageId)
        if (messageIndex === -1) {
            logger.warn('[useAiController] 重说被阻止：未找到目标消息', {
                messageId,
                convMessageIds: conv.messages.map(m => m.id),
            })
            return
        }

        const precedingUserMsg = conv.messages
            .slice(0, messageIndex)
            .reverse()
            .find((message) => message.role === 'user')
        if (!precedingUserMsg?.nodeId) {
            logger.warn('[useAiController] 重说失败：上一条用户消息缺少 nodeId', {
                conversationId: conv.id,
                sessionId: conv.sessionId,
                targetMessageId: messageId,
                precedingUserMessageId: precedingUserMsg?.id ?? null,
                currentLastUserNodeId: session.lastUserNodeId,
            })
            return
        }
        const documentAttachmentItemIds = collectDocumentAttachmentItemIdsUntilMessage(
            conv.messages,
            precedingUserMsg.id,
        )

        const convSettings = normalizeConversationSettings(conv.settings)
        let currentSid = conv.sessionId
        let currentRunId = conv.runId
        if (currentSid && currentRunId) {
            session.activateSession(currentSid, currentRunId)
            runtimeConversationRef.current[runtimeConversationKey(currentSid, currentRunId)] = conv.id
        }

        if (!currentSid || !currentRunId) {
            const created = await session.createSession(
                conv.pluginId,
                conv.model,
                conv.id,
                sessionParams.maxToolRounds,
                undefined,
                toStoredConversationSettings(convSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) {
                logger.error('[useAiController] 重说失败：无法创建会话')
                return
            }
            currentSid = created.sessionId
            currentRunId = created.runId
            runtimeConversationRef.current[
                runtimeConversationKey(created.sessionId, created.runId)
            ] = conv.id
            setConversations((prev) => prev.map((c) =>
                c.id === conv.id ? {...c, sessionId: created.sessionId, runId: created.runId} : c,
            ))

            // 兜底推送上下文，确保 checkout 触发的首轮 assemble 有上下文
            try {
                await ai_update_session(
                    currentSid!,
                    buildSessionUpdateParams(convSettings, sessionParamsRef.current.thinking),
                )
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    convSettings,
                )
                const enrichedCtx = await appendDocumentContext(ctx, conv.id, documentAttachmentItemIds)
                await ai_set_task_context(currentSid!, enrichedCtx)
            } catch {
                // 上下文推送失败不阻塞 checkout
            }
        } else {
            try {
                await ai_update_session(
                    currentSid,
                    buildSessionUpdateParams(convSettings, sessionParamsRef.current.thinking),
                )
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    convSettings,
                )
                const enrichedCtx = await appendDocumentContext(ctx, conv.id, documentAttachmentItemIds)
                await ai_set_task_context(currentSid, enrichedCtx)
            } catch {
                // 上下文推送失败不阻塞 checkout
            }
        }

        setConversations((prev) => prev.map((conversation) =>
            conversation.id === activeConversationIdRef.current
                ? {...conversation, messages: conversation.messages.slice(0, messageIndex)}
                : conversation,
        ))
        setAutoScroll(true)
        await session.checkout(precedingUserMsg.nodeId, currentSid, currentRunId)
    }, [
        session,
        sessionParams.maxToolRounds,
        resolveContextPayload,
        appendDocumentContext,
        toolAccessMode,
        webSearchEnabled,
    ])

    const editMessage = useCallback((messageId: string) => {
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        const message = conv?.messages.find((item) => item.id === messageId)
        if (!message || message.role !== 'user') return
        setInputValue(message.content)
        setEditingMessageId(messageId)
    }, [conversations])

    const resetActiveBackendSessionForToolAccess = useCallback(async () => {
        const conversationId = activeConversationIdRef.current
        const conv = conversationsRef.current.find((conversation) => conversation.id === conversationId)
        if (!conv?.sessionId) return
        if (conv.runId && session.isRunStreaming(conv.runId)) return

        await session.closeSession(conv.sessionId)
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === conversationId
                ? {...conversation, sessionId: null, runId: null}
                : conversation,
        ))
    }, [session])

    useEffect(() => {
        const handleSettingsUpdated = (event: Event) => {
            const nextSettings = (event as CustomEvent<AppSettings>).detail
            if (!nextSettings) return
            appSettingsRef.current = nextSettings
            const writerEnabled = Boolean(nextSettings.llm?.writer_mode_enabled)
            setWriterModeAvailable(writerEnabled)
            if (!writerEnabled && toolAccessMode === 'writer') {
                setToolAccessModeState((current) => current === 'writer' ? 'assistant' : current)
                setTools((current) => current.map((tool) => ({
                    ...tool,
                    enabled: isToolEnabledForAccessMode(tool.name, 'assistant', webSearchEnabled),
                })))
                void resetActiveBackendSessionForToolAccess()
            }
        }
        window.addEventListener('fc:settings-updated', handleSettingsUpdated)
        return () => window.removeEventListener('fc:settings-updated', handleSettingsUpdated)
    }, [resetActiveBackendSessionForToolAccess, toolAccessMode, webSearchEnabled])

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        setTools((prev) => prev.map((tool) => WEB_TOOL_NAMES.includes(tool.name) ? {...tool, enabled: next} : tool))
        setWebSearchEnabled(next)
        await resetActiveBackendSessionForToolAccess()
        if (!session.sessionId) {
            const ops = tools
                .filter((tool) => WEB_TOOL_NAMES.includes(tool.name))
                .map((tool) => next ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name))
            await Promise.all(ops).catch(logger.error)
        }
    }, [resetActiveBackendSessionForToolAccess, session.sessionId, tools, webSearchEnabled])

    const setToolAccessMode = useCallback(async (mode: AiToolAccessMode) => {
        const nextMode = mode === 'writer' && !writerModeAvailable ? 'assistant' : mode
        setTools((prev) => prev.map((tool) => ({
            ...tool,
            enabled: isToolEnabledForAccessMode(tool.name, nextMode, webSearchEnabled),
        })))
        setToolAccessModeState(nextMode)
        await resetActiveBackendSessionForToolAccess()
    }, [resetActiveBackendSessionForToolAccess, webSearchEnabled, writerModeAvailable])

    const toggleEditMode = useCallback(async () => {
        await setToolAccessMode(toolAccessMode === 'reader' ? 'assistant' : 'reader')
    }, [setToolAccessMode, toolAccessMode])

    return useMemo(() => ({
        plugins,
        pluginsReady,
        selectedPlugin,
        selectedModel,
        setSelectedPlugin,
        setSelectedModel,
        conversations,
        activeConversationId,
        setActiveConversationId: selectConversation,
        messages,
        documentContextItems,
        pendingDocumentAttachmentItems,
        addDocumentContextFiles,
        removeDocumentContextItem,
        retryDocumentContextItem,
        sendMessage,
        stopStreaming,
        regenerateMessage,
        editMessage,
        inputValue,
        setInputValue,
        editingMessageId,
        setEditingMessageId,
        tools,
        webSearchEnabled,
        toolAccessMode,
        writerModeAvailable,
        editModeEnabled,
        focusContext,
        toggleWebSearch,
        setToolAccessMode,
        toggleEditMode,
        sessionParams,
        setSessionParams,
        isStreaming: session.isStreaming,
        streamingBlocks: session.blocks,
        conversationRuntime,
        sidebarCollapsed,
        setSidebarCollapsed,
        autoScroll,
        setAutoScroll,
        createNewConversation,
        startReportDiscussion,
        startCharacterConversation,
        updateConversationCharacterAutoPlay,
        updateConversationSettings,
        switchActiveConversationModel,
        switchConversation,
        deleteConversation,
        renameConversation,
        toggleConversationPinned,
        toggleConversationArchived,
        activeConversation,
        getBranchInfo: session.getBranchInfo,
        switchBranch: session.switchBranch,
    }), [
        plugins, pluginsReady, selectedPlugin, selectedModel, conversations, activeConversationId,
        documentContextItems, pendingDocumentAttachmentItems,
        messages, inputValue, editingMessageId, tools, webSearchEnabled, toolAccessMode,
        writerModeAvailable, editModeEnabled, focusContext,
        sessionParams, session.isStreaming, session.blocks, conversationRuntime, sidebarCollapsed, autoScroll,
        activeConversation, sendMessage, stopStreaming, regenerateMessage, editMessage,
        addDocumentContextFiles, removeDocumentContextItem, retryDocumentContextItem,
        toggleWebSearch, setToolAccessMode, toggleEditMode, createNewConversation, switchConversation, deleteConversation,
        renameConversation, toggleConversationPinned, toggleConversationArchived,
        startCharacterConversation, startReportDiscussion, updateConversationCharacterAutoPlay,
        updateConversationSettings, switchActiveConversationModel,
        selectConversation, session.getBranchInfo, session.switchBranch,
    ])
}

function buildConversationFromMeta(
    meta: Awaited<ReturnType<typeof ai_list_conversations>>[number],
    storedMetaMap: Record<string, StoredCharacterConversationMeta>,
    uiStateMap: Record<string, ConversationUiState>,
): Conversation {
    const storedMeta = storedMetaMap[meta.id]
    const uiState = uiStateMap[meta.id]
    const isReport = storedMeta?.mode === 'report' || Boolean(storedMeta?.reportContext)
    const characterMeta = isReport ? null : (storedMeta ?? inferCharacterConversationMeta(meta.title))
    const isCharacter = Boolean(characterMeta)

    return {
        id: meta.id,
        title: meta.title,
        messages: [],
        pluginId: meta.plugin_id,
        model: meta.model,
        sessionId: null,
        runId: null,
        timestamp: new Date(meta.updated_at).getTime(),
        pinnedAt: uiState?.pinnedAt ?? null,
        archivedAt: uiState?.archivedAt ?? null,
        mode: isReport ? 'report' : isCharacter ? 'character' : 'default',
        characterEntryId: characterMeta?.characterEntryId ?? null,
        characterName: characterMeta?.characterName ?? null,
        backgroundImageUrl: characterMeta?.backgroundImageUrl ?? null,
        characterVoiceId: characterMeta?.characterVoiceId ?? null,
        characterAutoPlay: characterMeta?.characterAutoPlay ?? null,
        reportContext: isReport ? (storedMeta?.reportContext ?? null) : null,
        reportSeeded: isReport ? (storedMeta?.reportSeeded ?? false) : false,
        settings: normalizeConversationSettings(),
    }
}
