import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Select, TagItem, useAlert } from 'flowcloudai-ui'
import { ai_close_session, ai_list_plugins, type PluginInfo } from '../api'
import { type SessionMessage, type ToolCallInfo, useAiSession } from '../hooks/useAiSession'
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

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500
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

    // 视图模式: 'full' 全屏 | 'right' 右侧面板
    const [viewMode, setViewMode] = useState<'full' | 'right'>('right')
    
    // 切换视图模式
    useCallback(() => {
        setViewMode(prev => prev === 'full' ? 'right' : 'full')
    }, []);
    const [attachments, setAttachments] = useState<Attachment[]>([])

    const activeConversation = conversations.find(c => c.id === activeConversationId)
    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

    const [inputValue, setInputValue] = useState('')

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const { showAlert } = useAlert()

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
                ? { ...conv, messages: [...conv.messages, message] }
                : conv
        ))
    }, [])

    const onError = useCallback((msg: string) => {
        void showAlert(msg, 'error', 'toast', 3000)
    }, [showAlert])

    const session = useAiSession({ onMessage, onError })

    const abortControllerRef = useRef<AbortController | null>(null)

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
                if (defaultModel) {
                    const timer = setTimeout(() => setSelectedModel(defaultModel), 0)
                    return () => clearTimeout(timer)
                }
            }
        }
    }, [selectedPlugin, plugins, selectedModel])

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
        if (messagesEndRef.current) {
            requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            })
        }
    }, [messages.length, session.currentText])

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
        if (sidebarCollapsed) setSidebarCollapsed(false)
    }, [session, selectedPlugin, selectedModel, sidebarCollapsed])

    // ── 加载历史对话 ──────────────────────────────────────────

    useEffect(() => {
        let mounted = true
        const stored = localStorage.getItem(STORAGE_KEY)

        const initializeConversations = async () => {
            if (stored) {
                try {
                    const parsed: Conversation[] = JSON.parse(stored)
                    if (!mounted) return
                    setConversations(parsed)
                    if (parsed.length > 0) {
                        const latest = [...parsed].sort((a, b) => b.timestamp - a.timestamp)[0]
                        setActiveConversationId(latest.id)
                        setSelectedPlugin(latest.pluginId)
                        setSelectedModel(latest.model)
                    } else {
                        const newId = `conv_${Date.now()}`
                        const newConv: Conversation = {
                            id: newId,
                            title: '新对话',
                            messages: [],
                            pluginId: selectedPlugin,
                            model: selectedModel,
                            sessionId: null,
                            timestamp: Date.now(),
                        }
                        setConversations([newConv])
                        setActiveConversationId(newId)
                    }
                } catch {
                    const newId = `conv_${Date.now()}`
                    const newConv: Conversation = {
                        id: newId,
                        title: '新对话',
                        messages: [],
                        pluginId: selectedPlugin,
                        model: selectedModel,
                        sessionId: null,
                        timestamp: Date.now(),
                    }
                    setConversations([newConv])
                    setActiveConversationId(newId)
                }
            } else {
                const newId = `conv_${Date.now()}`
                const newConv: Conversation = {
                    id: newId,
                    title: '新对话',
                    messages: [],
                    pluginId: selectedPlugin,
                    model: selectedModel,
                    sessionId: null,
                    timestamp: Date.now(),
                }
                setConversations([newConv])
                setActiveConversationId(newId)
            }
        }

        const timer = setTimeout(() => {
            void initializeConversations()
        }, 0)

        return () => {
            mounted = false
            clearTimeout(timer)
        }
    }, [selectedPlugin, selectedModel])

    // ── 持久化 ────────────────────────────────────────────────

    useEffect(() => {
        if (conversations.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
        }
    }, [conversations])

    // ── 切换对话 ──────────────────────────────────────────────

    const handleSwitchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationId) return

        if (session.isStreaming) {
            abortControllerRef.current?.abort()
        }
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

        if (activeConversationId === convId && session.isStreaming) {
            abortControllerRef.current?.abort()
        }

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

        abortControllerRef.current = new AbortController()

        let currentSid = session.sessionId
        if (!currentSid) {
            currentSid = await session.createSession(selectedPlugin, selectedModel)
            if (!currentSid) return
            setConversations(prev => prev.map(c =>
                c.id === activeConversationId ? { ...c, sessionId: currentSid! } : c
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

    const handleStop = useCallback(() => {
        abortControllerRef.current?.abort()
    }, [])

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

    const toggleViewMode = useCallback(() => {
        setViewMode(prev => prev === 'full' ? 'right' : 'full')
    }, [])

    // ── 渲染 ─────────────────────────────────────────────────

    return (
        <div className={`ai-chat-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <aside className="ai-sidebar">
                <div className="ai-sidebar-header">
                    {!sidebarCollapsed && (
                        <>
                            <button className="ai-new-chat-btn" onClick={handleNewConversation}>
                                <span className="ai-new-chat-icon">+</span>
                                <span className="ai-new-chat-text">新对话</span>
                            </button>
                            <button className="ai-sidebar-toggle" onClick={toggleSidebar} title="收起侧边栏">
                                <span className="ai-toggle-icon">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M10 3L5 8L10 13" />
                                    </svg>
                                </span>
                            </button>
                        </>
                    )}
                    {sidebarCollapsed && (
                        <button className="ai-sidebar-toggle" onClick={toggleSidebar} title="展开侧边栏">
                            <span className="ai-toggle-icon">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                        <button
                            className="ai-view-mode-toggle"
                            onClick={toggleViewMode}
                            title={viewMode === 'full' ? '切换至右侧面板' : '切换至全屏'}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                {viewMode === 'full' ? (
                                    <path d="M11 3L6 8L11 13" />
                                ) : (
                                    <path d="M5 3L10 8L5 13" />
                                )}
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="ai-messages-container" ref={messagesContainerRef}>
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
                                <div key={message.id} className={`ai-message ai-message--${message.role}`}>
                                    <div className="ai-message-content">
                                        <div className="ai-message-text">{message.content}</div>
                                        {message.attachments && message.attachments.length > 0 && (
                                            <div className="ai-attachments">
                                                {message.attachments.map((att: Attachment) => (
                                                    <div key={att.id} className="ai-attachment-tag">
                                                        {att.type === 'image' ? '🖼️' : '📎'} {att.name}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {session.currentText && (
                                <div className="ai-message ai-message--assistant ai-streaming-message">
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
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* 悬浮输入框 */}
                <div className={`ai-floating-input-wrapper ai-floating-input-wrapper--${viewMode}`}>
                    <div 
                        className="ai-floating-input-inner"
                        onClick={() => textareaRef.current?.focus()}
                    >
                        <textarea
                            ref={textareaRef}
                            className="ai-floating-textarea"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={activeConversationId ? '请输入消息...' : '请先创建新对话'}
                            disabled={session.isStreaming || !activeConversationId}
                        />
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
            </main>
        </div>
    )
}