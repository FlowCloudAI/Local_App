// cSpell:ignore msword openxmlformats officedocument wordprocessingml
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Select, TagItem, useAlert} from 'flowcloudai-ui'
import {List, type ListImperativeAPI} from 'react-window'
import {ai_close_session, ai_list_plugins, type PluginInfo,} from '../api'
import {type SessionMessage, type ToolCallInfo, useAiSession} from '../hooks/useAiSession'
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
    attachments?: Attachment[]
    /** 助手消息对应的后端节点 ID（来自 TurnEnd），用于重说 / 分支 */
    nodeId?: number
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

const MAX_CHARS = 10000
const SHOW_HINT_THRESHOLD = 9000
const STORAGE_KEY = 'ai-conversations'

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return cleaned.slice(0, 20) + '...'
}

// ── 组件 ─────────────────────────────────────────────────────

export default function AIChat() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    const activeConversation = conversations.find(c => c.id === activeConversationId)
    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

    const [inputValue, setInputValue] = useState('')
    const [attachments, setAttachments] = useState<Attachment[]>([])

    const listRef = useRef<ListImperativeAPI>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const [containerHeight, setContainerHeight] = useState(400)

    // 用于在事件回调中访问最新的 activeConversationId，避免 stale closure
    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const {showAlert} = useAlert()

    // ── useAiSession ─────────────────────────────────────────

    const onMessage = useCallback((msg: SessionMessage) => {
        const convId = activeConversationIdRef.current
        if (!convId) return
        const message: Message = {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            nodeId: msg.nodeId,
        }
        setConversations(prev => prev.map(conv =>
            conv.id === convId
                ? {...conv, messages: [...conv.messages, message]}
                : conv
        ))
    }, [])

    const onError = useCallback((msg: string) => {
        void showAlert(msg, 'error', 'toast', 3000)
    }, [showAlert])

    const session = useAiSession({onMessage, onError})

    // ── 初始化插件列表 ────────────────────────────────────────

    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error)
    }, [])

    // ── 自动选择默认模型 ──────────────────────────────────────

    useEffect(() => {
        if (selectedPlugin && plugins.length > 0 && !selectedModel) {
            const plugin = plugins.find(p => p.id === selectedPlugin)
            if (plugin) {
                const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
                if (defaultModel) setSelectedModel(defaultModel)
            }
        }
    }, [selectedPlugin, plugins, selectedModel])

    // ── 插件 / 模型变化同步到后端（会话存在时） ───────────────

    const prevPluginRef = useRef('')
    useEffect(() => {
        if (session.sessionId && selectedPlugin && prevPluginRef.current && selectedPlugin !== prevPluginRef.current) {
            void session.switchPlugin(selectedPlugin)
        }
        prevPluginRef.current = selectedPlugin
    }, [selectedPlugin, session.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    const prevModelRef = useRef('')
    useEffect(() => {
        if (session.sessionId && selectedModel && prevModelRef.current && selectedModel !== prevModelRef.current) {
            void session.updateModel(selectedModel)
        }
        prevModelRef.current = selectedModel
    }, [selectedModel, session.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── 监听容器高度（虚拟列表） ──────────────────────────────

    useEffect(() => {
        const el = messagesContainerRef.current
        if (!el) return
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) setContainerHeight(entry.contentRect.height)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // ── 流式消息完成后滚动 ────────────────────────────────────

    useEffect(() => {
        if (!session.isStreaming && listRef.current && messages.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(listRef.current as any).scrollToRow({index: messages.length - 1, align: 'end'})
        }
    }, [messages, session.isStreaming])

    // ── 输入框自动高度 ────────────────────────────────────────

    useEffect(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.style.height = 'auto'
        ta.style.height = ta.scrollHeight + 'px'
    }, [inputValue])

    // ── 加载/初始化历史对话 ───────────────────────────────────

    const handleNewConversation = useCallback(() => {
        void session.closeSession()

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
        if (sidebarCollapsed) setSidebarCollapsed(false)
    }, [session, selectedPlugin, selectedModel, sidebarCollapsed])

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            try {
                const parsed: Conversation[] = JSON.parse(stored)
                setConversations(parsed)
                if (parsed.length > 0) {
                    const latest = [...parsed].sort((a, b) => b.timestamp - a.timestamp)[0]
                    setActiveConversationId(latest.id)
                    setSelectedPlugin(latest.pluginId)
                    setSelectedModel(latest.model)
                } else {
                    handleNewConversation()
                }
            } catch {
                handleNewConversation()
            }
        } else {
            handleNewConversation()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── 持久化到 localStorage ─────────────────────────────────

    useEffect(() => {
        if (conversations.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
        }
    }, [conversations])

    // ── 切换对话 ──────────────────────────────────────────────

    const handleSwitchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationId) return
        await session.closeSession()
        setActiveConversationId(convId)
        setAttachments([])
        const targetConv = conversations.find(c => c.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)
        }
    }, [activeConversationId, session, conversations])

    // ── 删除对话 ──────────────────────────────────────────────

    const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const conv = conversations.find(c => c.id === convId)
        // 直接关闭该对话的后端会话（可能不是当前活跃会话）
        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }
        setConversations(prev => prev.filter(c => c.id !== convId))
        if (activeConversationId === convId) {
            await session.closeSession()
            setActiveConversationId(null)
        }
    }, [conversations, activeConversationId, session])

    // ── 发送消息 ──────────────────────────────────────────────

    const handleSend = useCallback(async () => {
        const trimmed = inputValue.trim()
        if ((!trimmed && attachments.length === 0) || session.isStreaming) return
        if (!activeConversationId) {
            void showAlert('请先创建新对话', 'warning', 'toast', 2000)
            return
        }

        let currentSid = session.sessionId
        if (!currentSid) {
            currentSid = await session.createSession(selectedPlugin, selectedModel)
            if (!currentSid) return
            // 记录后端会话 ID 到对话对象（供删除时关闭）
            setConversations(prev => prev.map(c =>
                c.id === activeConversationId ? {...c, sessionId: currentSid!} : c
            ))
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
            if (conv.id !== activeConversationId) return conv
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
    }, [inputValue, attachments, session, activeConversationId, selectedPlugin, selectedModel, showAlert])

    // ── 重新生成 ──────────────────────────────────────────────

    const handleRegenerate = useCallback(async () => {
        if (!activeConversationId || messages.length < 2) return
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
        if (!lastUserMsg) return

        // 从显示中移除最后一条助手消息
        setConversations(prev => prev.map(c =>
            c.id === activeConversationId
                ? {...c, messages: c.messages.slice(0, -1)}
                : c
        ))

        const userNodeId = session.lastUserNodeIdRef.current

        if (session.sessionId && userNodeId !== null) {
            // 有活跃会话：checkout 到用户节点，drive loop 自动重跑无需发消息
            const ok = await session.checkout(userNodeId)
            if (!ok) void showAlert('重新生成失败', 'error', 'toast', 3000)
        } else {
            // 无活跃会话：创建新会话，重发上一条用户消息
            let currentSid = session.sessionId
            if (!currentSid) {
                currentSid = await session.createSession(selectedPlugin, selectedModel)
                if (!currentSid) return
                setConversations(prev => prev.map(c =>
                    c.id === activeConversationId ? {...c, sessionId: currentSid!} : c
                ))
            }
            await session.sendMessage(lastUserMsg.content, currentSid)
        }
    }, [activeConversationId, messages, session, selectedPlugin, selectedModel, showAlert])

    // ── 停止生成 ──────────────────────────────────────────────

    const handleStopGeneration = useCallback(async () => {
        await session.closeSession()
    }, [session])

    // ── 复制 ─────────────────────────────────────────────────

    const copyMessage = (content: string) => {
        navigator.clipboard.writeText(content)
            .then(() => void showAlert('已复制到剪贴板', 'success', 'toast', 1500))
            .catch(() => void showAlert('复制失败', 'error', 'toast', 1500))
    }

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

    // ── 虚拟列表行 ────────────────────────────────────────────

    const Row = ({index, style, data}: {
        index: number
        style: React.CSSProperties
        data: { messages: Message[] }
    }) => {
        const message = data.messages[index]
        return (
            <div style={style}>
                <div className={`ai-message ai-message--${message.role}`}>
                    <div className="ai-message-avatar">
                        {message.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className="ai-message-content">
                        <div className="ai-message-text">{message.content}</div>
                        {message.attachments && message.attachments.length > 0 && (
                            <div className="ai-attachments">
                                {message.attachments.map(att => (
                                    <div key={att.id} className="ai-attachment-tag">
                                        {att.type === 'image' ? '🖼️' : '📎'} {att.name}
                                    </div>
                                ))}
                            </div>
                        )}
                        {message.role === 'assistant' && (
                            <div className="ai-message-actions">
                                <button className="ai-action-btn" onClick={() => copyMessage(message.content)}
                                        title="复制">
                                    📋
                                </button>
                                <button className="ai-action-btn" onClick={() => void handleRegenerate()}
                                        title="重新生成">
                                    🔄
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    const selectedPluginInfo = plugins.find(p => p.id === selectedPlugin)
    const toggleSidebar = () => setSidebarCollapsed(prev => !prev)

    // ── 渲染 ─────────────────────────────────────────────────

    return (
        <div className={`ai-chat-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            {/* 左侧边栏 */}
            <aside className="ai-sidebar">
                <div className="ai-sidebar-header">
                    {!sidebarCollapsed && (
                        <>
                            <Button size="sm" className="ai-new-chat-btn" onClick={handleNewConversation}>
                                <span className="ai-new-chat-icon">+</span>
                                <span className="ai-new-chat-text">新对话</span>
                            </Button>
                            <button className="ai-sidebar-toggle" onClick={toggleSidebar} title="收起侧边栏">
                                <span className="ai-toggle-icon">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10 3L5 8L10 13" />
                                    </svg>
                                </span>
                            </button>
                        </>
                    )}
                    {sidebarCollapsed && (
                        <button className="ai-sidebar-toggle" onClick={toggleSidebar} title="展开侧边栏">
                            <span className="ai-toggle-icon">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 3L11 8L6 13" />
                                </svg>
                            </span>
                        </button>
                    )}
                </div>
                {!sidebarCollapsed && (
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
                )}
            </aside>

            {/* 右侧主区域 */}
            <main className="ai-main">
                {/* 配置面板 */}
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
                </div>

                {/* 消息区域 */}
                <div className="ai-messages-container" ref={messagesContainerRef}>
                    {!activeConversationId && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">💬</div>
                            <p className="ai-empty-text">开始新的对话</p>
                            <p className="ai-empty-hint">点击左侧"新对话"按钮开始聊天</p>
                        </div>
                    )}
                    {messages.length > 0 && (
                        <List<{ data: { messages: Message[] } }>
                            listRef={listRef}
                            rowCount={messages.length}
                            rowHeight={120}
                            className="ai-virtual-list"
                            style={{ height: containerHeight }}
                            rowComponent={Row}
                            rowProps={{ data: { messages } }}
                        />
                    )}
                    {session.currentText && (
                        <div className="ai-message ai-message--assistant ai-streaming-message">
                            <div className="ai-message-avatar">🤖</div>
                            <div className="ai-message-content">
                                {session.currentReasoning && (
                                    <div className="ai-message-reasoning">
                                        {session.currentReasoning}
                                    </div>
                                )}
                                <div className="ai-message-text ai-message-text--streaming">
                                    {session.currentText}
                                    <span className="ai-cursor" />
                                </div>
                                {session.toolCalls.length > 0 && (
                                    <div className="ai-tool-calls">
                                        {session.toolCalls.map((tool: ToolCallInfo, idx: number) => (
                                            <TagItem
                                                key={idx}
                                                schema={{
                                                    id: `tool-${idx}`,
                                                    name: tool.name,
                                                    type: 'string',
                                                    range_min: null,
                                                    range_max: null
                                                }}
                                                value={tool.status === 'calling' ? '调用中' : '已完成'}
                                                mode="show"
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* 悬浮输入框 */}
                <div className="ai-floating-input-wrapper">
                    <div className="ai-floating-input-container">
                        <div className="ai-floating-input-inner">
                            <textarea
                                ref={node => {
                                    inputRef.current = node
                                    textareaRef.current = node
                                }}
                                className="ai-floating-textarea"
                                value={inputValue}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder={activeConversationId ? '请输入消息...' : '请先创建新对话'}
                                disabled={session.isStreaming || !activeConversationId}
                                rows={1}
                            />
                            <div className="ai-floating-actions">
                                {showCharHint && (
                                    <span className="ai-floating-char-count">{charCount}/{MAX_CHARS}</span>
                                )}
                                {session.isStreaming ? (
                                    <button
                                        className="ai-floating-stop-btn"
                                        onClick={() => void handleStopGeneration()}
                                        title="停止生成"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12" rx="2" />
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={() => void handleSend()}
                                        disabled={!inputValue.trim() || !activeConversationId}
                                        title="发送"
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="12" y1="19" x2="12" y2="5"/>
                                            <polyline points="5 12 12 5 19 12"/>
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
