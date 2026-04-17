import React, {createContext, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    ai_close_session,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_conversation,
    ai_list_conversations,
    ai_list_plugins,
    ai_list_tools,
    ai_rename_conversation,
    ai_update_session,
    type PluginInfo,
    type StoredMessage,
    type ToolStatus,
} from '../api'
import {type SessionMessage, useAiSession} from '../hooks/useAiSession'
import type {AiContextValue, Conversation, Message, SessionParams} from './AiContextTypes'

const AiContext = createContext<AiContextValue | null>(null)

// ── 辅助函数 ─────────────────────────────────────────────────

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return cleaned.slice(0, 20) + '...'
}

const runtimeConversationKey = (sessionId: string, runId: string) => `${sessionId}::${runId}`

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

    const ensureAssistant = (m: StoredMessage, index: number) => {
        if (!pendingAssistant) {
            pendingAssistant = {
                id: m.message_id ?? `loaded_assistant_${index}_${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date(m.timestamp).getTime(),
                nodeId: m.node_id ?? undefined,
                blocks: [],
            }
        }
        return pendingAssistant
    }

    messages.forEach((m, index) => {
        if (m.role === 'user') {
            flushPendingAssistant()
        }

        if (m.role === 'tool') {
            const assistant = pendingAssistant
            if (!assistant?.blocks) return
            const toolBlockIndex = assistant.blocks.findIndex(block => {
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
                        result: m.content ?? '',
                        isError: false,
                    },
                }
                pendingAssistant = {...assistant, blocks: nextBlocks}
            }
            return
        }

        if (m.role === 'assistant') {
            const assistant = ensureAssistant(m, index)
            const nextBlocks = [...(assistant.blocks ?? [])]

            if (m.reasoning) {
                nextBlocks.push({type: 'reasoning', content: m.reasoning})
            }
            if (m.tool_calls && m.tool_calls.length > 0) {
                m.tool_calls.forEach(tc => {
                    nextBlocks.push({
                        type: 'tool',
                        tool: {
                            index: tc.index,
                            name: tc.function?.name ?? tc.name ?? '',
                            args: tc.function?.arguments ?? tc.arguments ?? '',
                        },
                        detail: 'verbose',
                    })
                })
            }
            if (m.content) {
                nextBlocks.push({type: 'content', content: m.content, markdown: true})
            }

            pendingAssistant = {
                ...assistant,
                content: assistant.content + (m.content ?? ''),
                reasoning: assistant.reasoning
                    ? `${assistant.reasoning}${m.reasoning ?? ''}`
                    : (m.reasoning || undefined),
                timestamp: new Date(m.timestamp).getTime(),
                nodeId: m.node_id ?? assistant.nodeId,
                blocks: nextBlocks,
            }
            return
        }

        const base: Message = {
            id: m.message_id ?? `loaded_${index}_${Date.now()}`,
            role: m.role as 'user' | 'assistant',
            content: m.content ?? '',
            reasoning: m.reasoning || undefined,
            timestamp: new Date(m.timestamp).getTime(),
            nodeId: m.node_id ?? undefined,
        }

        if (m.content) {
            base.blocks = [{type: 'content', content: m.content}]
        }

        result.push(base)
    })

    flushPendingAssistant()
    return result
}

// ── Provider ─────────────────────────────────────────────────

export function AiProvider({children}: { children: React.ReactNode }) {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [autoScroll, setAutoScroll] = useState(true)

    const [inputValue, setInputValue] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [sessionParams, setSessionParams] = useState<SessionParams>({thinking: true})
    const [tools, setTools] = useState<ToolStatus[]>([])
    const [webSearchEnabled, setWebSearchEnabled] = useState(true)
    const [editModeEnabled, setEditModeEnabled] = useState(true)

    const activeConversation = useMemo(() =>
        conversations.find(c => c.id === activeConversationId),
    [conversations, activeConversationId])

    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

    // Refs for async callbacks
    const activeConversationRef = useRef(activeConversation)
    useEffect(() => { activeConversationRef.current = activeConversation }, [activeConversation])

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])

    const runtimeConversationRef = useRef<Record<string, string>>({})
    const abortControllerRef = useRef<AbortController | null>(null)

    // ── useAiSession ─────────────────────────────────────────

    const onMessage = useCallback((msg: SessionMessage) => {
        const targetConversationId =
            runtimeConversationRef.current[runtimeConversationKey(msg.sessionId, msg.runId)]

        setConversations(prev => prev.map(conv => {
            const matchedByRuntime = conv.sessionId === msg.sessionId && conv.runId === msg.runId
            const matchedByMap = targetConversationId != null && conv.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conv
            return {
                ...conv,
                messages: [...conv.messages, {
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    reasoning: msg.reasoning,
                    blocks: msg.blocks,
                    nodeId: msg.nodeId,
                }],
            }
        }))
    }, [])

    const onError = useCallback((msg: string) => {
        console.error('[AiContext]', msg)
    }, [])

    const session = useAiSession({onMessage, onError})

    // ── 初始化 ───────────────────────────────────────────────

    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error)
        ai_list_tools().then(fetched => {
            const enableOps = fetched.map(t => ai_enable_tool(t.name))
            void Promise.all(enableOps)
            setTools(fetched.map(t => ({...t, enabled: true})))
            setWebSearchEnabled(true)
            setEditModeEnabled(true)
        }).catch(console.error)
    }, [])

    useEffect(() => {
        let mounted = true
        const init = async () => {
            const metas = await ai_list_conversations().catch(() => [] as Awaited<ReturnType<typeof ai_list_conversations>>)
            if (!mounted) return

            if (metas.length > 0) {
                const convs: Conversation[] = metas.map(m => ({
                    id: m.id,
                    title: m.title,
                    messages: [],
                    pluginId: m.plugin_id,
                    model: m.model,
                    sessionId: null,
                    runId: null,
                    timestamp: new Date(m.updated_at).getTime(),
                }))

                const stored = await ai_get_conversation(convs[0].id).catch(() => null)
                if (!mounted) return

                if (stored) {
                    convs[0] = {...convs[0], messages: storedToMessages(stored.messages)}
                }

                setConversations(convs)
                setActiveConversationId(convs[0].id)
                setSelectedPlugin(convs[0].pluginId)
                setSelectedModel(convs[0].model)
            } else {
                const newId = `conv_${Date.now()}`
                setConversations([{
                    id: newId, title: '新对话', messages: [],
                    pluginId: '', model: '', sessionId: null, runId: null, timestamp: Date.now(),
                }])
                setActiveConversationId(newId)
            }
        }
        void init()
        return () => { mounted = false }
    }, [])

    // ── 自动选择默认模型 ──────────────────────────────────────

    useEffect(() => {
        if (selectedPlugin && plugins.length > 0 && !selectedModel) {
            const plugin = plugins.find(p => p.id === selectedPlugin)
            if (plugin) {
                const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
                if (defaultModel) {
                    const timer = setTimeout(() => setSelectedModel(defaultModel), 0)
                    return () => clearTimeout(timer)
                }
            }
        }
    }, [selectedPlugin, plugins, selectedModel])

    // ── 会话参数同步 ──────────────────────────────────────────

    useEffect(() => {
        if (!session.sessionId) return
        void ai_update_session(session.sessionId, {thinking: sessionParams.thinking}).catch(console.error)
    }, [sessionParams, session.sessionId])

    // ── 操作 ─────────────────────────────────────────────────

    const createNewConversation = useCallback(async () => {
        if (session.isStreaming) {
            abortControllerRef.current?.abort()
        }
        await session.closeSession()

        const newId = `conv_${Date.now()}`
        const newConversation: Conversation = {
            id: newId,
            title: '新对话',
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            sessionId: null,
            runId: null,
            timestamp: Date.now(),
        }

        setConversations(prev => [newConversation, ...prev])
        setActiveConversationId(newId)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
        if (sidebarCollapsed) setSidebarCollapsed(false)
    }, [session, selectedPlugin, selectedModel, sidebarCollapsed])

    const switchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationIdRef.current) return
        setActiveConversationId(convId)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)

        const targetConv = conversations.find(c => c.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)

            if (targetConv.messages.length === 0 && !targetConv.id.startsWith('conv_')) {
                const stored = await ai_get_conversation(targetConv.id).catch(() => null)
                if (stored) {
                    setConversations(prev => prev.map(c =>
                        c.id === convId
                            ? {...c, messages: storedToMessages(stored.messages)}
                            : c
                    ))
                }
            }
        }
    }, [conversations])

    const deleteConversation = useCallback(async (convId: string, e?: React.MouseEvent) => {
        e?.stopPropagation()
        const conv = conversations.find(c => c.id === convId)

        if (activeConversationIdRef.current === convId && session.isStreaming) {
            await session.cancelSession(conv?.sessionId)
        }

        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }
        if (conv && !conv.id.startsWith('conv_')) {
            await ai_delete_conversation(conv.id).catch(console.error)
        }

        setConversations(prev => prev.filter(c => c.id !== convId))


        if (activeConversationIdRef.current === convId) {
            await session.closeSession()
            setActiveConversationId(null)
            setAutoScroll(true)
        }
    }, [conversations, session])

    const renameConversation = useCallback(async (convId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        setConversations(prev => prev.map(c => c.id === convId ? {...c, title: trimmed} : c))
        await ai_rename_conversation(convId, trimmed).catch(console.error)
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const trimmed = content.trim()
        if (!trimmed || session.isStreaming) return

        const currentConvId = activeConversationRef.current?.id
        if (!currentConvId) return

        abortControllerRef.current = new AbortController()

        // 编辑模式处理
        if (editingMessageId) {
            const conv = activeConversationRef.current
            if (conv) {
                const editIdx = conv.messages.findIndex(m => m.id === editingMessageId)
                if (editIdx !== -1) {
                    setConversations(prev => prev.map(c =>
                        c.id === currentConvId
                            ? {...c, messages: c.messages.slice(0, editIdx)}
                            : c
                    ))
                    const precedingMsg = editIdx > 0 ? conv.messages[editIdx - 1] : null
                    if (precedingMsg?.nodeId && conv.sessionId === session.sessionId) {
                        await session.checkoutForEdit(precedingMsg.nodeId)
                    } else {
                        if (session.sessionId) await session.closeSession()
                    }
                }
            }
            setEditingMessageId(null)
        }

        const sessionBelongsHere = session.sessionId != null
            && session.sessionId === activeConversationRef.current?.sessionId
            && session.runId != null
            && session.runId === activeConversationRef.current?.runId

        if (session.sessionId && !sessionBelongsHere) {
            await session.closeSession()
        }

        let currentSid = sessionBelongsHere ? session.sessionId : null
        let effectiveConvId = currentConvId

        if (!currentSid) {
            await new Promise<void>(resolve => {
                setTools(latest => {
                    Promise.all(
                        latest.map(t => t.enabled ? ai_enable_tool(t.name) : ai_disable_tool(t.name))
                    ).catch(console.error).finally(resolve)
                    return latest
                })
            })

            const isPending = currentConvId.startsWith('conv_')
            const desiredSessionId = isPending ? undefined : currentConvId
            const created = await session.createSession(selectedPlugin, selectedModel, desiredSessionId)
            if (!created) return

            currentSid = created.sessionId
            if (isPending) {
                effectiveConvId = created.conversationId
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                ] = created.conversationId
                setConversations(prev => prev.map(c =>
                    c.id === currentConvId
                        ? {...c, id: created.conversationId, sessionId: currentSid!, runId: created.runId}
                        : c
                ))
                setActiveConversationId(created.conversationId)
            } else {
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                ] = currentConvId
                setConversations(prev => prev.map(c =>
                    c.id === currentConvId ? {...c, sessionId: currentSid!, runId: created.runId} : c
                ))
            }
        }

        const userMessage: Message = {
            id: `u_${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
        }

        setConversations(prev => prev.map(conv => {
            if (conv.id !== effectiveConvId) return conv
            const isFirstMessage = conv.messages.length === 0
            return {
                ...conv,
                title: isFirstMessage ? generateTitleFromMessage(trimmed) : conv.title,
                messages: [...conv.messages, userMessage],
            }
        }))

        setInputValue('')
        await session.sendMessage(trimmed, currentSid!)
    }, [session, selectedPlugin, selectedModel, editingMessageId])

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort()
        void session.cancelSession()
    }, [session])

    const regenerateMessage = useCallback(async (messageId: string) => {
        if (session.isStreaming) return
        const conv = conversations.find(c => c.id === activeConversationIdRef.current)
        if (!conv || conv.sessionId !== session.sessionId) return

        const msgIdx = conv.messages.findIndex(m => m.id === messageId)
        if (msgIdx === -1) return

        const precedingUserMsg = conv.messages.slice(0, msgIdx).reverse().find(m => m.role === 'user')
        if (!precedingUserMsg?.nodeId) return

        setConversations(prev => prev.map(c =>
            c.id === activeConversationIdRef.current ? {...c, messages: c.messages.slice(0, msgIdx)} : c
        ))
        setAutoScroll(true)
        await session.checkout(precedingUserMsg.nodeId)
    }, [conversations, session])

    const editMessage = useCallback((messageId: string) => {
        const conv = conversations.find(c => c.id === activeConversationIdRef.current)
        const msg = conv?.messages.find(m => m.id === messageId)
        if (!msg || msg.role !== 'user') return
        setInputValue(msg.content)
        setEditingMessageId(messageId)
    }, [conversations])

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        const webNames = ['web_search', 'open_url']
        setTools(prev => prev.map(t => webNames.includes(t.name) ? {...t, enabled: next} : t))
        setWebSearchEnabled(next)
        if (!session.sessionId) {
            const ops = tools
                .filter(t => webNames.includes(t.name))
                .map(t => next ? ai_enable_tool(t.name) : ai_disable_tool(t.name))
            await Promise.all(ops).catch(console.error)
        }
    }, [webSearchEnabled, tools, session.sessionId])

    const toggleEditMode = useCallback(async () => {
        const next = !editModeEnabled
        const webNames = ['web_search', 'open_url']
        setTools(prev => prev.map(t => (!webNames.includes(t.name)) ? {...t, enabled: next} : t))
        setEditModeEnabled(next)
        if (!session.sessionId) {
            const ops = tools
                .filter(t => !webNames.includes(t.name))
                .map(t => next ? ai_enable_tool(t.name) : ai_disable_tool(t.name))
            await Promise.all(ops).catch(console.error)
        }
    }, [editModeEnabled, tools, session.sessionId])

    const value = useMemo(() => ({
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
        switchConversation,
        deleteConversation,
        renameConversation,
        activeConversation,
    }), [
        plugins, selectedPlugin, selectedModel, conversations, activeConversationId,
        messages, inputValue, editingMessageId, tools, webSearchEnabled, editModeEnabled,
        sessionParams, session.isStreaming, session.blocks, sidebarCollapsed, autoScroll,
        activeConversation, sendMessage, stopStreaming, regenerateMessage, editMessage,
        toggleWebSearch, toggleEditMode, createNewConversation, switchConversation, deleteConversation,
        renameConversation,
    ])

    return <AiContext.Provider value={value}>{children}</AiContext.Provider>
}

export {AiContext}
