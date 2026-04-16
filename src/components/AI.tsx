import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {MessageBox, RollingBox, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_close_session,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_conversation,
    ai_list_conversations,
    ai_list_plugins,
    ai_list_tools,
    ai_update_session,
    type PluginInfo,
    type StoredMessage,
    type ToolStatus,
} from '../api'
import {type SessionMessage, type ToolCallInfo as SessionToolCallInfo, useAiSession} from '../hooks/useAiSession'
import './AI.css'

// ── 类型 ─────────────────────────────────────────────────────

interface Attachment {
    id: string
    name: string
    type: 'image' | 'file'
    data: string
    preview?: string
}

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    reasoning?: string
    attachments?: Attachment[]
    nodeId?: number
}

interface SessionParams {
    thinking: boolean
    temperature: string       // 空字符串 = 使用模型默认值
    maxTokens: string
    topP: string
    frequencyPenalty: string
    presencePenalty: string
}

const DEFAULT_SESSION_PARAMS: SessionParams = {
    thinking: false,
    temperature: '',
    maxTokens: '',
    topP: '',
    frequencyPenalty: '',
    presencePenalty: '',
}

interface Conversation {
    id: string
    title: string
    messages: Message[]
    pluginId: string
    model: string
    sessionId: string | null
    timestamp: number
}

// ── 常量 ─────────────────────────────────────────────────────

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return cleaned.slice(0, 20) + '...'
}

const storedToMessage = (m: StoredMessage, index: number): Message => ({
    id: `loaded_${index}_${Date.now()}`,
    role: m.role as 'user' | 'assistant',
    content: m.content ?? '',
    reasoning: m.reasoning || undefined,
    timestamp: new Date(m.timestamp).getTime(),
})

// ── 组件 ─────────────────────────────────────────────────────

export default function AIChat() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)


    
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [autoScroll, setAutoScroll] = useState(true)
    const [sessionParams, setSessionParams] = useState<SessionParams>(DEFAULT_SESSION_PARAMS)
    const [paramsExpanded, setParamsExpanded] = useState(false)
    // 编辑模式：记录正在编辑的 user 消息 id
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [tools, setTools] = useState<ToolStatus[]>([])
    const [webSearchEnabled, setWebSearchEnabled] = useState(false)
    const [editModeEnabled, setEditModeEnabled] = useState(false)

    const activeConversation = conversations.find(c => c.id === activeConversationId)
    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

    const [inputValue, setInputValue] = useState('')

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const lastScrollTopRef = useRef(0)

    const {showAlert} = useAlert()

    // 稳定追踪当前活跃对话的 sessionId，供异步回调读取
    const activeSessionIdRef = useRef<string | null>(null)
    useEffect(() => {
        activeSessionIdRef.current = activeConversation?.sessionId ?? null
    }, [activeConversation?.sessionId])

    // 稳定追踪当前活跃对话，避免 useCallback 依赖频繁变化
    const activeConversationRef = useRef(activeConversation)
    useEffect(() => {
        activeConversationRef.current = activeConversation
    }, [activeConversation])

    // ── useAiSession ─────────────────────────────────────────

    const onMessage = useCallback((msg: SessionMessage) => {
        const userSwitchedAway = activeSessionIdRef.current !== msg.sessionId

        const message: Message = {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            reasoning: msg.reasoning,
            nodeId: msg.nodeId,
        }
        // 按 sessionId 路由，并在用户已切走时顺手清掉 sessionId
        setConversations(prev => prev.map(conv => {
            if (conv.sessionId !== msg.sessionId) return conv
            return {
                ...conv,
                messages: [...conv.messages, message],
                // 用户切走了：清掉 sessionId，下次续聊会重建 session
                sessionId: userSwitchedAway ? null : conv.sessionId,
            }
        }))

        // TurnEnd 后用户不在场 → kill session 释放后端资源
        if (userSwitchedAway) {
            void ai_close_session(msg.sessionId).catch(console.error)
        }
    }, [])

    const onError = useCallback((msg: string) => {
        void showAlert(msg, 'error', 'toast', 3000)
    }, [showAlert])

    const session = useAiSession({ onMessage, onError })

    const abortControllerRef = useRef<AbortController | null>(null)

    // ── 初始化插件列表 ────────────────────────────────────────

    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error)
        ai_list_tools().then(fetched => {
            // 强制默认全部关闭：同步 UI 状态并禁用后端所有工具
            const disableOps = fetched.map(t => ai_disable_tool(t.name))
            void Promise.all(disableOps)
            setTools(fetched.map(t => ({...t, enabled: false})))
            setWebSearchEnabled(false)
            setEditModeEnabled(false)
        }).catch(console.error)
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

    // ── 将 turn_begin nodeId 反填到对应的 user 消息 ──────────
    // 这样 user 消息的 nodeId = 该轮的 turn_begin node，
    // checkout 到它时 backend 会自动重跑该消息（用于重说）

    useEffect(() => {
        if (!session.lastUserNodeId || !session.sessionId) return

        // 使用 requestAnimationFrame 延迟状态更新，避免级联渲染
        const frameId = requestAnimationFrame(() => {
            setConversations(prev => prev.map(conv => {
                if (conv.sessionId !== session.sessionId) return conv
                // 找最后一条还没有 nodeId 的 user 消息
                const idx = conv.messages.reduceRight<number>(
                    (found, m, i) => found === -1 && m.role === 'user' && !m.nodeId ? i : found,
                    -1,
                )
                if (idx === -1) return conv
                const msgs = [...conv.messages]
                msgs[idx] = {...msgs[idx], nodeId: session.lastUserNodeId!}
                return {...conv, messages: msgs}
            }))
        })

        return () => cancelAnimationFrame(frameId)
    }, [session.lastUserNodeId, session.sessionId])

    // ── 会话参数同步到后端 ────────────────────────────────────

    useEffect(() => {
        if (!session.sessionId) return
        const p: Record<string, unknown> = {thinking: sessionParams.thinking}
        if (sessionParams.temperature !== '') p.temperature = parseFloat(sessionParams.temperature)
        if (sessionParams.maxTokens !== '') p.maxTokens = parseInt(sessionParams.maxTokens, 10)
        if (sessionParams.topP !== '') p.topP = parseFloat(sessionParams.topP)
        if (sessionParams.frequencyPenalty !== '') p.frequencyPenalty = parseFloat(sessionParams.frequencyPenalty)
        if (sessionParams.presencePenalty !== '') p.presencePenalty = parseFloat(sessionParams.presencePenalty)
        void ai_update_session(session.sessionId, p).catch(console.error)
    }, [sessionParams, session.sessionId])

    // ── 插件 / 模型变化同步到后端 ─────────────────────────────

    const prevPluginRef = useRef('')
    useEffect(() => {
        if (session.sessionId && selectedPlugin && prevPluginRef.current && selectedPlugin !== prevPluginRef.current) {
            void session.switchPlugin(selectedPlugin)
        }
        prevPluginRef.current = selectedPlugin
    }, [selectedPlugin, session])

    const prevModelRef = useRef('')
    useEffect(() => {
        if (session.sessionId && selectedModel && prevModelRef.current && selectedModel !== prevModelRef.current) {
            void session.updateModel(selectedModel)
        }
        prevModelRef.current = selectedModel
    }, [selectedModel, session])

    // ── 自动滚动到底部 ────────────────────────────────────────

    useEffect(() => {
        if (!autoScroll) return
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current
            if (!container) return
            const roll = container.querySelector('.fc-roll') as HTMLElement | null
            const scrollContainer = roll || container
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        })
    }, [messages.length, session.currentText, autoScroll])

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current
        if (!container) return
        const roll = container.querySelector('.fc-roll') as HTMLElement | null
        const scrollContainer = roll || container
        const {scrollTop, scrollHeight, clientHeight} = scrollContainer
        if (scrollTop < lastScrollTopRef.current && scrollHeight - scrollTop - clientHeight > 50) {
            setAutoScroll(false)
        }
        lastScrollTopRef.current = scrollTop
    }, [])

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

    // ── 输入框自动高度 ────────────────────────────────────────

    useLayoutEffect(() => {
        const ta = textareaRef.current
        if (!ta) return
        requestAnimationFrame(() => {
            const scrollTop = ta.scrollTop
            ta.style.height = 'auto'
            const newHeight = Math.min(Math.max(ta.scrollHeight, 60), 200)
            ta.style.height = newHeight + 'px'
            ta.scrollTop = scrollTop
        })
    }, [inputValue])

    // ── 创建新对话 ────────────────────────────────────────────

    const handleNewConversation = useCallback(async () => {
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
            timestamp: Date.now(),
        }

        setConversations(prev => [newConversation, ...prev])
        setActiveConversationId(newId)
        setAttachments([])
        setAutoScroll(true)
        if (sidebarCollapsed) setSidebarCollapsed(false)
    }, [session, selectedPlugin, selectedModel, sidebarCollapsed])

    // ── 从后端加载历史对话 ────────────────────────────────────

    useEffect(() => {
        let mounted = true

        const init = async () => {
            const metas = await ai_list_conversations().catch(() => [] as Awaited<ReturnType<typeof ai_list_conversations>>)
            if (!mounted) return

            if (metas.length > 0) {
                // 先创建基础对话列表
                const convs: Conversation[] = metas.map(m => ({
                    id: m.id,
                    title: m.title,
                    messages: [],
                    pluginId: m.plugin_id,
                    model: m.model,
                    sessionId: null,
                    timestamp: new Date(m.updated_at).getTime(),
                }))

                // 加载第一条对话的消息
                const stored = await ai_get_conversation(convs[0].id).catch(() => null)
                if (!mounted) return

                // 如果有消息数据，直接初始化时带上
                if (stored) {
                    convs[0] = {
                        ...convs[0],
                        messages: stored.messages.map(storedToMessage),
                    }
                }
                
                setConversations(convs)
                setActiveConversationId(convs[0].id)
                setSelectedPlugin(convs[0].pluginId)
                setSelectedModel(convs[0].model)
            } else {
                const newId = `conv_${Date.now()}`
                setConversations([{
                    id: newId, title: '新对话', messages: [],
                    pluginId: '', model: '', sessionId: null, timestamp: Date.now(),
                }])
                setActiveConversationId(newId)
            }
        }

        void init()
        return () => {
            mounted = false
        }
    }, []) // 仅挂载时执行一次

    // ── 切换对话 ──────────────────────────────────────────────

    const handleSwitchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationId) return

        // 不关闭当前 session：让后台继续跑完，onMessage 会按 sessionId 路由到正确对话
        setActiveConversationId(convId)
        setAttachments([])
        setAutoScroll(true)

        const targetConv = conversations.find(c => c.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)

            // 懒加载：只有尚未加载过消息的对话才从后端拉取
            if (targetConv.messages.length === 0 && !targetConv.id.startsWith('conv_')) {
                const stored = await ai_get_conversation(targetConv.id).catch(() => null)
                if (stored) {
                    setConversations(prev => prev.map(c =>
                        c.id === convId
                            ? {...c, messages: stored.messages.map(storedToMessage)}
                            : c
                    ))
                }
            }
        }
    }, [activeConversationId, conversations])

    // ── 删除对话 ──────────────────────────────────────────────

    const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const conv = conversations.find(c => c.id === convId)

        if (activeConversationId === convId && session.isStreaming) {
            abortControllerRef.current?.abort()
        }

        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }
        if (conv && !conv.id.startsWith('conv_')) {
            await ai_delete_conversation(conv.id).catch(console.error)
        }

        setConversations(prev => prev.filter(c => c.id !== convId))

        if (activeConversationId === convId) {
            await session.closeSession()
            setActiveConversationId(null)
            setAutoScroll(true)
        }
    }, [conversations, activeConversationId, session])

    // ── 发送消息 ──────────────────────────────────────────────

    const handleSend = useCallback(async () => {
        const trimmed = inputValue.trim()
        if ((!trimmed && attachments.length === 0) || session.isStreaming) return

        // 使用 ref 获取最新的 activeConversationId，避免依赖不稳定
        const currentConvId = activeConversationRef.current?.id
        if (!currentConvId) {
            void showAlert('请先创建新对话', 'warning', 'toast', 2000)
            return
        }

        abortControllerRef.current = new AbortController()

        // ── 编辑模式：处理消息裁剪 + checkout ─────────────────
        if (editingMessageId) {
            const conv = activeConversationRef.current
            if (conv) {
                const editIdx = conv.messages.findIndex(m => m.id === editingMessageId)
                if (editIdx !== -1) {
                    // 裁掉从编辑消息开始的所有内容
                    setConversations(prev => prev.map(c =>
                        c.id === currentConvId
                            ? {...c, messages: c.messages.slice(0, editIdx)}
                            : c
                    ))
                    const precedingMsg = editIdx > 0 ? conv.messages[editIdx - 1] : null
                    if (precedingMsg?.nodeId && conv.sessionId === session.sessionId) {
                        // 有前驱 assistant 节点且 session 存活：checkout 后继续走下方 sendMessage 流程
                        await session.checkoutForEdit(precedingMsg.nodeId)
                    } else {
                        // 第一条消息 或 session 已过期：关闭旧 session，走重建流程
                        if (session.sessionId) await session.closeSession()
                    }
                }
            }
            setEditingMessageId(null)
        }

        // 若当前 session 属于另一个对话（后台残留），先关掉再为本对话新建
        const sessionBelongsHere = session.sessionId != null
            && session.sessionId === activeConversationRef.current?.sessionId
        if (session.sessionId && !sessionBelongsHere) {
            await session.closeSession()
        }

        let currentSid = sessionBelongsHere ? session.sessionId : null
        // effectiveConvId 跟踪「此次发送」实际操作的对话 ID，
        // 因为 pending 对话在创建 session 后 id 会变，不能再用 activeConversationId（stale）
        let effectiveConvId = currentConvId
        if (!currentSid) {
            currentSid = await session.createSession(selectedPlugin, selectedModel)
            if (!currentSid) return
            const oldId = currentConvId
            if (oldId?.startsWith('conv_')) {
                // pending 对话：将 id 提升为 session_id，使本地 id === 后端文件名
                effectiveConvId = currentSid
                setConversations(prev => prev.map(c =>
                    c.id === oldId ? {...c, id: currentSid!, sessionId: currentSid!} : c
                ))
                setActiveConversationId(currentSid!)
            } else {
                setConversations(prev => prev.map(c =>
                    c.id === currentConvId ? {...c, sessionId: currentSid!} : c
                ))
            }
        }

        let content = trimmed
        if (attachments.length > 0) {
            const attachDesc = attachments.map(a => `[附件: ${a.name}]`).join(' ')
            content = trimmed ? `${trimmed}\n${attachDesc}` : attachDesc
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: Date.now(),
            attachments: [...attachments],
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
        setAttachments([])

        await session.sendMessage(content, currentSid)
    }, [inputValue, attachments, session, selectedPlugin, selectedModel, showAlert, editingMessageId])


    const handleStop = useCallback(() => {
        abortControllerRef.current?.abort()
    }, [])

    // ── 重说 ──────────────────────────────────────────────────

    const handleRegenerate = useCallback(async (messageId: string) => {
        if (session.isStreaming) return
        const conv = conversations.find(c => c.id === activeConversationId)
        if (!conv || conv.sessionId !== session.sessionId) {
            void showAlert('会话已过期，无法重说', 'warning', 'toast', 2000)
            return
        }
        const msgIdx = conv.messages.findIndex(m => m.id === messageId)
        if (msgIdx === -1) return

        // 找到该 assistant 消息前的最近一条 user 消息及其 nodeId
        const precedingUserMsg = conv.messages.slice(0, msgIdx).reverse().find(m => m.role === 'user')
        if (!precedingUserMsg?.nodeId) {
            void showAlert('找不到对应节点，无法重说', 'warning', 'toast', 2000)
            return
        }

        // 删掉该 assistant 消息及其之后所有消息
        setConversations(prev => prev.map(c =>
            c.id === activeConversationId ? {...c, messages: c.messages.slice(0, msgIdx)} : c
        ))
        setAutoScroll(true)
        // checkout 到 user 节点 → backend 自动重跑，无需再 sendMessage
        await session.checkout(precedingUserMsg.nodeId)
    }, [activeConversationId, conversations, session, showAlert])

    // ── 编辑 user 消息 ────────────────────────────────────────

    const handleEditMessage = useCallback((messageId: string) => {
        const conv = conversations.find(c => c.id === activeConversationId)
        const msg = conv?.messages.find(m => m.id === messageId)
        if (!msg || msg.role !== 'user') return
        setInputValue(msg.content)
        setEditingMessageId(messageId)
        textareaRef.current?.focus()
    }, [activeConversationId, conversations])

    // ── 键盘 / 输入 ───────────────────────────────────────────

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                void handleSend()
            }
        },
        [handleSend],
    )

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (e.target.value.length <= MAX_CHARS) setInputValue(e.target.value)
    }

    const charCount = inputValue.length
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD

    const selectedPluginInfo = plugins.find(p => p.id === selectedPlugin)
    const toggleSidebar = () => setSidebarCollapsed(prev => !prev)

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        const webNames = ['web_search', 'open_url']
        setTools(prev => prev.map(t => webNames.includes(t.name) ? {...t, enabled: next} : t))
        setWebSearchEnabled(next)
        const ops = tools
            .filter(t => webNames.includes(t.name))
            .map(t => next ? ai_enable_tool(t.name) : ai_disable_tool(t.name))
        await Promise.all(ops).catch(console.error)
    }, [webSearchEnabled, tools])

    const toggleEditMode = useCallback(async () => {
        const next = !editModeEnabled
        const webNames = ['web_search', 'open_url']
        setTools(prev => prev.map(t => (!webNames.includes(t.name)) ? {...t, enabled: next} : t))
        setEditModeEnabled(next)
        const ops = tools
            .filter(t => !webNames.includes(t.name))
            .map(t => next ? ai_enable_tool(t.name) : ai_disable_tool(t.name))
        await Promise.all(ops).catch(console.error)
    }, [editModeEnabled, tools])

    // ── 渲染 ─────────────────────────────────────────────────

    return (
        <div className={`ai-chat-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <aside className="ai-sidebar">
                <div className="ai-sidebar-header">
                    <button className="ai-new-chat-btn" onClick={handleNewConversation}>
                        <span className="ai-new-chat-icon">+</span>
                        <span className="ai-new-chat-text">新对话</span>
                    </button>
                    <button className="ai-sidebar-toggle" onClick={toggleSidebar} title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}>
                        <span className="ai-toggle-icon">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                {sidebarCollapsed ? (
                                    <path d="M6 3L11 8L6 13" />
                                ) : (
                                    <path d="M10 3L5 8L10 13" />
                                )}
                            </svg>
                        </span>
                    </button>
                </div>
                <div className="ai-conversations-list">
                    {conversations.length === 0 && (
                        <div className="ai-empty-history"><p>暂无历史对话</p></div>
                    )}
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`ai-conversation-item ${conv.id === activeConversationId ? 'active' : ''}`}
                            onClick={() => void handleSwitchConversation(conv.id)}
                        >
                            <div className="ai-conversation-info">
                                <div className="ai-conversation-title" title={conv.title}>{conv.title}</div>
                            </div>
                            <button className="ai-conversation-delete"
                                    onClick={e => void handleDeleteConversation(conv.id, e)}>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M2 3.5h10M4.5 3.5V2a1 1 0 011-1h3a1 1 0 011 1v1.5m-7 0v8a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5v-8M5.5 6v4M8.5 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            </aside>

            <main className="ai-main">
                <div className="ai-config-panel">
                    <div className="ai-config-body">
                        <div className="ai-config-field">
                            <label className="ai-config-label">插件</label>
                            <Select
                                className="ai-config-select"
                                value={selectedPlugin}
                                onChange={v => setSelectedPlugin(String(v))}
                                placeholder="选择插件"
                                options={plugins.map(p => ({ value: p.id, label: p.name }))}
                            />
                        </div>
                        {selectedPluginInfo && (
                            <div className="ai-config-field">
                                <label className="ai-config-label">模型</label>
                                <Select
                                    className="ai-config-select"
                                    value={selectedModel}
                                    onChange={v => setSelectedModel(String(v))}
                                    placeholder="选择模型"
                                    options={selectedPluginInfo.models.map(m => ({ value: m, label: m }))}
                                />
                            </div>
                        )}
                    </div>

                    {/* 会话参数行 */}
                    <div className="ai-params-row">
                        <button
                            className="ai-param-expand-btn"
                            onClick={() => setParamsExpanded(p => !p)}
                            title="高级参数"
                        >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                                 strokeWidth="1.5"
                                 style={{
                                     transform: paramsExpanded ? 'rotate(180deg)' : undefined,
                                     transition: 'transform 0.15s'
                                 }}>
                                <path d="M2 4l4 4 4-4"/>
                            </svg>
                            高级
                        </button>
                        {paramsExpanded && (
                            <>
                                <div className="ai-param-field">
                                    <label>温度</label>
                                    <input
                                        type="number" min="0" max="2" step="0.05"
                                        className="ai-param-input"
                                        value={sessionParams.temperature}
                                        onChange={e => setSessionParams(prev => ({
                                            ...prev,
                                            temperature: e.target.value
                                        }))}
                                        placeholder="默认"
                                    />
                                </div>
                                <div className="ai-param-field">
                                    <label>最大 Token</label>
                                    <input
                                        type="number" min="1" step="256"
                                        className="ai-param-input"
                                        value={sessionParams.maxTokens}
                                        onChange={e => setSessionParams(prev => ({...prev, maxTokens: e.target.value}))}
                                        placeholder="默认"
                                    />
                                </div>
                                <div className="ai-param-field">
                                    <label>Top P</label>
                                    <input
                                        type="number" min="0" max="1" step="0.05"
                                        className="ai-param-input"
                                        value={sessionParams.topP}
                                        onChange={e => setSessionParams(prev => ({...prev, topP: e.target.value}))}
                                        placeholder="默认"
                                    />
                                </div>
                                <div className="ai-param-field">
                                    <label>频率惩罚</label>
                                    <input
                                        type="number" min="-2" max="2" step="0.1"
                                        className="ai-param-input"
                                        value={sessionParams.frequencyPenalty}
                                        onChange={e => setSessionParams(prev => ({
                                            ...prev,
                                            frequencyPenalty: e.target.value
                                        }))}
                                        placeholder="默认"
                                    />
                                </div>
                                <div className="ai-param-field">
                                    <label>存在惩罚</label>
                                    <input
                                        type="number" min="-2" max="2" step="0.1"
                                        className="ai-param-input"
                                        value={sessionParams.presencePenalty}
                                        onChange={e => setSessionParams(prev => ({
                                            ...prev,
                                            presencePenalty: e.target.value
                                        }))}
                                        placeholder="默认"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <RollingBox className="ai-messages-container" ref={messagesContainerRef} onScroll={handleMessagesScroll}
                            thumbSize={'thin'}>
                    {!activeConversationId && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                                </svg>
                            </div>
                            <p className="ai-empty-text">开始新的对话</p>
                            <p className="ai-empty-hint">点击左侧「新对话」按钮开始聊天</p>
                        </div>
                    )}
                    {activeConversationId && messages.length > 0 && (
                        <div className="ai-messages-list">
                            {messages.map((message) => (
                                <MessageBox
                                    key={message.id}
                                    role={message.role}
                                    content={message.content}
                                    toolCallDetail={'verbose'}
                                    markdown={message.role === 'assistant'}
                                    reasoning={message.reasoning || undefined}
                                    onCopy={() => navigator.clipboard.writeText(message.content)}
                                    onEdit={message.role === 'user'
                                        ? () => handleEditMessage(message.id)
                                        : undefined}
                                    onRegenerate={message.role === 'assistant'
                                        ? () => void handleRegenerate(message.id)
                                        : undefined}
                                />
                            ))}
                            {(session.currentText || session.currentReasoning || session.toolCalls.length > 0)
                                && session.sessionId === activeConversation?.sessionId && (
                                    <MessageBox
                                        role="assistant"
                                        content={session.currentText}
                                        streaming
                                        markdown
                                        reasoning={session.currentReasoning || undefined}
                                        reasoningStreaming={!!session.currentReasoning && !session.currentText}
                                        toolCalls={session.toolCalls.map((tool: SessionToolCallInfo) => ({
                                            index: tool.index,
                                            name: tool.name,
                                            result: tool.status !== 'calling' ? (tool.status === 'error' ? '调用失败' : '已完成') : undefined,
                                            isError: tool.status === 'error',
                                        }))}
                                        toolCallDetail={'verbose'}
                                    />
                                )}
                        </div>
                    )}
                    {activeConversationId && messages.length > 0 && !autoScroll && (
                        <div className="ai-scroll-to-bottom-sticky">
                            <button className="ai-scroll-to-bottom-btn" onClick={scrollToBottom} title="滚动到底部">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.8">
                                    <path d="M3 6l5 5 5-5"/>
                                </svg>
                            </button>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </RollingBox>

                {/* 编辑模式指示条 */}
                {editingMessageId && (
                    <div className={`ai-edit-indicator ai-edit-indicator--${viewMode}`}>
                        <span>编辑模式</span>
                        <button onClick={() => {
                            setEditingMessageId(null);
                            setInputValue('')
                        }}>取消
                        </button>
                    </div>
                )}

                {/* 悬浮输入框 */}
                <div className="ai-floating-input-wrapper ai-floating-input-wrapper--full">
                    <div className="ai-floating-input-inner">
                        <textarea
                            ref={textareaRef}
                            className="ai-floating-textarea"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={activeConversationId ? '请输入消息...' : '请先创建新对话'}
                            disabled={session.isStreaming || !activeConversationId}
                        />
                        <div className="ai-floating-footer">
                            <div className="ai-floating-toolbar">
                                <button
                                    className={`ai-toolbar-btn ${sessionParams.thinking ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setSessionParams(prev => ({...prev, thinking: !prev.thinking})); }}
                                    title="深度思考"
                                >
                                    深度思考
                                </button>
                                <button
                                    className={`ai-toolbar-btn ${webSearchEnabled ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); void toggleWebSearch(); }}
                                    title="联网搜索"
                                >
                                    联网搜索
                                </button>
                                <button
                                    className={`ai-toolbar-btn ${editModeEnabled ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); void toggleEditMode(); }}
                                    title={editModeEnabled ? '编辑模式' : '阅读模式'}
                                >
                                    {editModeEnabled ? '编辑模式' : '阅读模式'}
                                </button>
                            </div>
                            <div className="ai-floating-actions">
                                {showCharHint && (
                                    <span className="ai-floating-char-count">{charCount}/{MAX_CHARS}</span>
                                )}
                                {session.isStreaming ? (
                                    <button className="ai-floating-stop-btn" onClick={(e) => { e.stopPropagation(); handleStop(); }} title="停止生成">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12" />
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={(e) => { e.stopPropagation(); void handleSend(); }}
                                        disabled={!inputValue.trim() || !activeConversationId}
                                        title="发送"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}