import {type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    ai_build_character_project_snapshot,
    ai_close_session,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_character_conversation_meta,
    ai_get_conversation,
    ai_list_conversations,
    ai_list_plugins,
    ai_list_tools,
    ai_rename_conversation,
    ai_save_character_conversation_meta,
    ai_set_task_context,
    ai_update_session,
    type AppSettings,
    type CharacterConversationMeta,
    db_get_entry,
    db_get_project,
    ENTRY_UPDATED,
    type EntryUpdatedEvent,
    type PluginInfo,
    setting_get_settings,
    type StoredMessage,
    type TaskContextPayload,
    type ToolStatus,
} from '../../../api'
import {type SessionMessage, useAiSession} from './useAiSession'
import type {
    AiContextValue,
    AiFocusContext,
    Conversation,
    Message,
    ReportConversationContext,
    SessionParams,
} from '../model/AiControllerTypes'
import {toEntryImageSrc} from '../../entries/lib/entryImage'

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return `${cleaned.slice(0, 20)}...`
}

const runtimeConversationKey = (sessionId: string, runId: string) => `${sessionId}::${runId}`
const CHARACTER_CONVERSATION_META_STORAGE_KEY = 'flowcloudai.characterConversationMeta.v1'

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
        console.warn('写入特殊会话元数据缓存失败')
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
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
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
    const [editModeEnabled, setEditModeEnabled] = useState(true)

    const focusRef = useRef(focus)
    useEffect(() => {
        focusRef.current = focus
    }, [focus])

    const projectNameCacheRef = useRef<Map<string, string>>(new Map())
    // Map value: snippet string（含空字符串），undefined 表示未缓存
    const entrySnippetCacheRef = useRef<Map<string, string>>(new Map())
    const entryTitleCacheRef = useRef<Map<string, string>>(new Map())
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

        syncPluginSelection(pluginList, settings)

        if (fetchedTools) {
            const enableOps = fetchedTools.map((tool) => ai_enable_tool(tool.name))
            void Promise.all(enableOps)
            setTools(fetchedTools.map((tool) => ({...tool, enabled: true})))
            setWebSearchEnabled(true)
            setEditModeEnabled(true)
        }
    }, [syncPluginSelection])

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const runtimeConversationRef = useRef<Record<string, string>>({})
    const abortControllerRef = useRef<AbortController | null>(null)

    const onMessage = useCallback((message: SessionMessage) => {
        const targetConversationId =
            runtimeConversationRef.current[runtimeConversationKey(message.sessionId, message.runId)]

        setConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation
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
                }],
            }
        }))
    }, [])

    const onError = useCallback((message: string) => {
        console.error('[useAiController]', message)
    }, [])

    const session = useAiSession({onMessage, onError})

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
                c.id === convId ? {...c, messages: storedToMessages(stored.messages)} : c,
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

        const hints: string[] = []
        if (!webSearchEnabled) {
            hints.push(
                '用户已禁用 "web_search" 和 "open_url" 工具。' +
                '若问题涉及联网获取信息，请勿主观臆断，而是告知用户开启"联网搜索"功能后再试。'
            )
        }
        if (!editModeEnabled) {
            hints.push(
                '用户当前处于阅读模式，所有词条编辑工具已被禁用。' +
                '若用户要求修改内容，请告知其切换到"编辑模式"后再操作。'
            )
        }
        if (hints.length > 0) {
            attributes.ai_instructions = hints.join('\n')
        }

        return {
            attributes,
            flags: {read_only: !editModeEnabled},
        }
    }, [editModeEnabled, webSearchEnabled])

    // tab 切换或 session 建立时推送最新焦点上下文
    useEffect(() => {
        const sid = session.sessionId
        if (!sid) return
        let cancelled = false
        resolveContextPayload(focus.projectId, focus.entryId).then((ctx) => {
            if (cancelled) return
            ai_set_task_context(sid, ctx).catch(() => {
            })
        }).catch(() => {
        })
        return () => {
            cancelled = true
        }
    }, [focus.projectId, focus.entryId, session.sessionId, resolveContextPayload])

    useEffect(() => {
        let mounted = true
        refreshAiSidebarState(true).catch((error) => {
            if (!mounted) return
            console.error('初始化 AI 侧栏状态失败', error)
        })
        return () => {
            mounted = false
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        const handler = () => {
            refreshAiSidebarState(false).catch((error) => {
                console.error('插件变更后刷新 AI 插件列表失败', error)
            })
        }
        window.addEventListener('fc:plugins-changed', handler)
        return () => window.removeEventListener('fc:plugins-changed', handler)
    }, [refreshAiSidebarState])

    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            refreshAiSidebarState(true).catch((error) => {
                console.error('后端就绪后刷新 AI 侧栏状态失败', error)
            })
        })
        return () => {
            unlisten.then((fn) => fn())
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        let mounted = true
        const init = async () => {
            const [metas, fileMetaMap] = await Promise.all([
                ai_list_conversations().catch(
                    () => [] as Awaited<ReturnType<typeof ai_list_conversations>>,
                ),
                ai_get_character_conversation_meta().catch(() => ({} as Record<string, CharacterConversationMeta>)),
            ])
            if (!mounted) return

            if (metas.length > 0) {
                const storedMetaMap = {
                    ...readStoredCharacterConversationMetaMap(),
                    ...normalizeStoredSpecialConversationMetaMap(fileMetaMap),
                }
                const convs: Conversation[] = metas.map((meta) => buildConversationFromMeta(meta, storedMetaMap))

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
            console.warn('写入特殊会话元数据文件失败', error)
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
        if (!session.sessionId) return
        void ai_update_session(session.sessionId, {thinking: sessionParams.thinking}).catch(console.error)
    }, [sessionParams, session.sessionId])

    const createNewConversation = useCallback(async () => {
        if (session.isStreaming) {
            abortControllerRef.current?.abort()
        }
        await session.closeSession()
        setActiveConversationId(null)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [session])

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
            mode: 'report',
            characterEntryId: null,
            characterName: null,
            backgroundImageUrl: null,
            characterVoiceId: null,
            characterAutoPlay: null,
            reportContext,
            reportSeeded: false,
        }

        setSelectedPlugin(pluginId)
        setSelectedModel(model)
        setConversations((prev) => [conversation, ...prev])
        setActiveConversationId(conversation.id)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [])

    const startCharacterConversation = useCallback(async ({projectId, entryId}: {
        projectId: string
        entryId: string
    }) => {
        if (!selectedPlugin || !selectedModel) {
            throw new Error('当前 AI 插件或模型尚未准备好，请稍后重试。')
        }
        if (session.isStreaming) {
            abortControllerRef.current?.abort()
            await session.cancelSession()
        }

        const currentConv = activeConversationRef.current
        if (currentConv?.sessionId) {
            await session.closeSession(currentConv.sessionId)
        } else {
            await session.closeSession()
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
            mode: 'character',
            characterEntryId: entryId,
            characterName: built.characterEntry.title,
            backgroundImageUrl: toEntryImageSrc(built.backgroundImage) ?? null,
            characterVoiceId: built.characterVoiceId,
            characterAutoPlay: built.characterAutoPlay,
            reportContext: null,
            reportSeeded: false,
        }
        runtimeConversationRef.current[
            runtimeConversationKey(created.sessionId, created.runId)
            ] = created.conversationId
        setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)])
        setActiveConversationId(conversation.id)
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

    const switchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationIdRef.current) return
        setActiveConversationId(convId)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)

        const targetConv = conversations.find((conversation) => conversation.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)

            if (targetConv.messages.length === 0 && !targetConv.id.startsWith('conv_')) {
                const stored = await ai_get_conversation(targetConv.id).catch(() => null)
                if (stored) {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {...conversation, messages: storedToMessages(stored.messages)}
                            : conversation,
                    ))
                }
            }
        }
    }, [conversations])

    const deleteConversation = useCallback(async (convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        const conv = conversations.find((conversation) => conversation.id === convId)

        if (activeConversationIdRef.current === convId && session.isStreaming) {
            await session.cancelSession(conv?.sessionId)
        }

        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }
        if (conv && !conv.id.startsWith('conv_')) {
            await ai_delete_conversation(conv.id).catch(console.error)
        }

        setConversations((prev) => prev.filter((conversation) => conversation.id !== convId))

        if (activeConversationIdRef.current === convId) {
            await session.closeSession()
            setActiveConversationId(null)
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
        }
    }, [conversations, session])

    const renameConversation = useCallback(async (convId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === convId ? {...conversation, title: trimmed} : conversation,
        ))
        await ai_rename_conversation(convId, trimmed).catch(console.error)
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const trimmed = content.trim()
        if (!trimmed || session.isStreaming) return

        let currentConvId = activeConversationRef.current?.id ?? null
        let effectiveConvId = currentConvId

        if (!currentConvId) {
            const draftConversationId = `conv_${Date.now()}`
            const draftConversation: Conversation = {
                id: draftConversationId,
                title: '新对话',
                messages: [],
                pluginId: selectedPlugin,
                model: selectedModel,
                sessionId: null,
                runId: null,
                timestamp: Date.now(),
                mode: 'default',
                characterEntryId: null,
                characterName: null,
                backgroundImageUrl: null,
                characterVoiceId: null,
                characterAutoPlay: null,
                reportContext: null,
                reportSeeded: false,
            }
            currentConvId = draftConversationId
            effectiveConvId = draftConversationId
            setConversations((prev) => [draftConversation, ...prev])
            setActiveConversationId(draftConversationId)
            setAutoScroll(true)
        }

        abortControllerRef.current = new AbortController()

        let sessionForcedClosed = false

        if (editingMessageId) {
            const conv = activeConversationRef.current
            if (conv) {
                const editIdx = conv.messages.findIndex((message) => message.id === editingMessageId)
                if (editIdx !== -1) {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === currentConvId
                            ? {...conversation, messages: conversation.messages.slice(0, editIdx)}
                            : conversation,
                    ))
                    const precedingMsg = editIdx > 0 ? conv.messages[editIdx - 1] : null
                    if (precedingMsg?.nodeId && conv.sessionId === session.sessionId) {
                        await session.checkoutForEdit(precedingMsg.nodeId)
                    } else if (session.sessionId) {
                        await session.closeSession()
                        sessionForcedClosed = true
                    }
                }
            }
            setEditingMessageId(null)
        }

        const sessionBelongsHere = !sessionForcedClosed && session.sessionId != null
            && session.sessionId === activeConversationRef.current?.sessionId
            && session.runId != null
            && session.runId === activeConversationRef.current?.runId

        if (session.sessionId && !sessionBelongsHere) {
            await session.closeSession()
        }

        let currentSid = sessionBelongsHere ? session.sessionId : null

        if (!currentSid) {
            await new Promise<void>((resolve) => {
                setTools((latest) => {
                    Promise.all(
                        latest.map((tool) => tool.enabled ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name)),
                    ).catch(console.error).finally(resolve)
                    return latest
                })
            })

            const isPending = currentConvId.startsWith('conv_')
            const desiredSessionId = isPending ? undefined : currentConvId
            const created = await session.createSession(selectedPlugin, selectedModel, desiredSessionId, sessionParams.maxToolRounds)
            if (!created) return

            currentSid = created.sessionId

            // 立即同步 sessionParams，避免首轮对话使用旧默认值
            ai_update_session(currentSid, {thinking: sessionParamsRef.current.thinking}).catch(() => {})

            // 兜底推送：session 刚建立时 effect 可能尚未触发，确保首轮 assemble 有上下文
            try {
                const ctx = await resolveContextPayload(focusRef.current.projectId, focusRef.current.entryId)
                await ai_set_task_context(currentSid!, ctx)
            } catch {
                // 上下文推送失败不阻塞发送
            }

            if (isPending) {
                effectiveConvId = created.conversationId
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                    ] = created.conversationId
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, id: created.conversationId, sessionId: currentSid!, runId: created.runId}
                        : conversation,
                ))
                setActiveConversationId(created.conversationId)
            } else {
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                    ] = currentConvId
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, sessionId: currentSid!, runId: created.runId}
                        : conversation,
                ))
            }
        }

        const actualPrompt = activeConversationRef.current?.mode === 'report'
        && !activeConversationRef.current.reportSeeded
        && activeConversationRef.current.reportContext
            ? buildReportBootstrapPrompt(activeConversationRef.current.reportContext, trimmed)
            : trimmed

        const userMessage: Message = {
            id: `u_${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
        }

        setConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== effectiveConvId) return conversation
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
        await session.sendMessage(actualPrompt, currentSid!)
    }, [editingMessageId, selectedModel, selectedPlugin, session, resolveContextPayload, sessionParams.maxToolRounds])

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort()
        void session.cancelSession()
    }, [session])

    const regenerateMessage = useCallback(async (messageId: string) => {
        console.log('[useAiController] 进入重说', {
            messageId,
            activeConversationId: activeConversationIdRef.current,
            sessionId: session.sessionId,
            isStreaming: session.isStreaming,
        })
        if (session.isStreaming) {
            console.warn('[useAiController] 重说被阻止：当前仍在流式输出中，尝试取消后重试', {
                isStreaming: session.isStreaming,
                blocksLen: session.blocks.length,
                sessionId: session.sessionId,
            })
            await session.cancelSession()
            await new Promise(resolve => setTimeout(resolve, 100))
            if (session.isStreaming) {
                console.error('[useAiController] 重说失败：取消后仍处于流式状态，无法继续')
                return
            }
        }
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        if (!conv) {
            console.warn('[useAiController] 重说被阻止：未找到对话')
            return
        }

        const messageIndex = conv.messages.findIndex((message) => message.id === messageId)
        if (messageIndex === -1) {
            console.warn('[useAiController] 重说被阻止：未找到目标消息', {
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
            console.warn('[useAiController] 重说失败：上一条用户消息缺少 nodeId', {
                conversationId: conv.id,
                sessionId: conv.sessionId,
                targetMessageId: messageId,
                precedingUserMessageId: precedingUserMsg?.id ?? null,
                currentLastUserNodeId: session.lastUserNodeId,
            })
            return
        }

        // 确保有活跃 session：不存在或不匹配时关闭旧 session 并创建新 session
        let currentSid = session.sessionId
        const sessionBelongsHere = currentSid != null && currentSid === conv.sessionId

        if (currentSid && !sessionBelongsHere) {
            await session.closeSession()
            currentSid = null
        }

        if (!currentSid) {
            const created = await session.createSession(conv.pluginId, conv.model, conv.id, sessionParams.maxToolRounds)
            if (!created) {
                console.error('[useAiController] 重说失败：无法创建会话')
                return
            }
            currentSid = created.sessionId
            runtimeConversationRef.current[
                runtimeConversationKey(created.sessionId, created.runId)
            ] = conv.id
            setConversations((prev) => prev.map((c) =>
                c.id === conv.id ? {...c, sessionId: created.sessionId, runId: created.runId} : c,
            ))

            // 兜底推送上下文，确保 checkout 触发的首轮 assemble 有上下文
            try {
                const ctx = await resolveContextPayload(focusRef.current.projectId, focusRef.current.entryId)
                await ai_set_task_context(currentSid!, ctx)
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
        await session.checkout(precedingUserMsg.nodeId)
    }, [conversations, session, sessionParams.maxToolRounds, resolveContextPayload])

    const editMessage = useCallback((messageId: string) => {
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        const message = conv?.messages.find((item) => item.id === messageId)
        if (!message || message.role !== 'user') return
        setInputValue(message.content)
        setEditingMessageId(messageId)
    }, [conversations])

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        const webNames = ['web_search', 'open_url']
        setTools((prev) => prev.map((tool) => webNames.includes(tool.name) ? {...tool, enabled: next} : tool))
        setWebSearchEnabled(next)
        if (!session.sessionId) {
            const ops = tools
                .filter((tool) => webNames.includes(tool.name))
                .map((tool) => next ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name))
            await Promise.all(ops).catch(console.error)
        }
    }, [session.sessionId, tools, webSearchEnabled])

    const toggleEditMode = useCallback(async () => {
        const next = !editModeEnabled
        const webNames = ['web_search', 'open_url']
        setTools((prev) => prev.map((tool) => (!webNames.includes(tool.name)) ? {...tool, enabled: next} : tool))
        setEditModeEnabled(next)
        // registry 侧同步由 sendMessage 的工具初始化流程负责；
        // read_only flag 通过 resolveContextPayload → ai_set_task_context 在下一轮 assemble 生效
    }, [editModeEnabled])

    return useMemo(() => ({
        plugins,
        selectedPlugin,
        selectedModel,
        setSelectedPlugin,
        setSelectedModel,
        conversations,
        activeConversationId,
        setActiveConversationId,
        messages,
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
        editModeEnabled,
        focusContext,
        toggleWebSearch,
        toggleEditMode,
        sessionParams,
        setSessionParams,
        isStreaming: session.isStreaming,
        streamingBlocks: session.blocks,
        sidebarCollapsed,
        setSidebarCollapsed,
        autoScroll,
        setAutoScroll,
        createNewConversation,
        startReportDiscussion,
        startCharacterConversation,
        updateConversationCharacterAutoPlay,
        switchConversation,
        deleteConversation,
        renameConversation,
        activeConversation,
        getBranchInfo: session.getBranchInfo,
        switchBranch: session.switchBranch,
    }), [
        plugins, selectedPlugin, selectedModel, conversations, activeConversationId,
        messages, inputValue, editingMessageId, tools, webSearchEnabled, editModeEnabled, focusContext,
        sessionParams, session.isStreaming, session.blocks, sidebarCollapsed, autoScroll,
        activeConversation, sendMessage, stopStreaming, regenerateMessage, editMessage,
        toggleWebSearch, toggleEditMode, createNewConversation, switchConversation, deleteConversation,
        renameConversation, startCharacterConversation, startReportDiscussion, updateConversationCharacterAutoPlay,
        session.getBranchInfo, session.switchBranch,
    ])
}

function buildConversationFromMeta(
    meta: Awaited<ReturnType<typeof ai_list_conversations>>[number],
    storedMetaMap: Record<string, StoredCharacterConversationMeta>,
): Conversation {
    const storedMeta = storedMetaMap[meta.id]
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
        mode: isReport ? 'report' : isCharacter ? 'character' : 'default',
        characterEntryId: characterMeta?.characterEntryId ?? null,
        characterName: characterMeta?.characterName ?? null,
        backgroundImageUrl: characterMeta?.backgroundImageUrl ?? null,
        characterVoiceId: characterMeta?.characterVoiceId ?? null,
        characterAutoPlay: characterMeta?.characterAutoPlay ?? null,
        reportContext: isReport ? (storedMeta?.reportContext ?? null) : null,
        reportSeeded: isReport ? (storedMeta?.reportSeeded ?? false) : false,
    }
}
