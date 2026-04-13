import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, RollingBox, useAlert } from 'flowcloudai-ui'
import { listen } from '@tauri-apps/api/event'
import {
    ai_close_session,
    ai_create_llm_session,
    ai_list_plugins,
    ai_send_message,
    type AiEventDelta,
    type AiEventError,
    type AiEventReady,
    type AiEventToolCall,
    type AiEventTurnEnd,
    type PluginInfo,
} from '../api'
import './AI.css'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
}

interface ToolCallInfo {
    index: number
    name: string
    status: 'calling' | 'completed' | 'error'
}

interface Conversation {
    id: string
    title: string
    messages: Message[]
    pluginId: string
    model: string
    apiKey: string
    sessionId: string | null
    timestamp: number
}

const messageQueueRef = { current: [] as Message[] }

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return cleaned.slice(0, 20) + '...'
}

export default function AIChat() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState<string>('')
    const [apiKey, setApiKey] = useState('')
    const [selectedModel, setSelectedModel] = useState<string>('')

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    const activeConversation = conversations.find(c => c.id === activeConversationId)
    const messages = useMemo(() => activeConversation?.messages || [], [activeConversation])

    const [inputValue, setInputValue] = useState('')
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [isStreaming, setIsStreaming] = useState(false)
    const [currentAssistantMessage, setCurrentAssistantMessage] = useState('')
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])

    const accumulatedMessageRef = useRef('')
    const turnCompletedRef = useRef(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const { showAlert } = useAlert()

    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error)
    }, [])

    useEffect(() => {
        if (selectedPlugin && plugins.length > 0 && !selectedModel) {
            const plugin = plugins.find(p => p.id === selectedPlugin)
            if (plugin) {
                const defaultModel = plugin.default_model || plugin.models[0] || ''
                if (defaultModel) {
                    setSelectedModel(defaultModel)
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPlugin, plugins])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, currentAssistantMessage])

    const flushMessages = useCallback(() => {
        if (messageQueueRef.current.length > 0 && activeConversationId) {
            const queuedMessages = [...messageQueueRef.current]
            messageQueueRef.current = []
            setConversations(prev => prev.map(conv => {
                if (conv.id === activeConversationId) {
                    return { ...conv, messages: [...conv.messages, ...queuedMessages] }
                }
                return conv
            }))
        }
    }, [activeConversationId])

    useEffect(() => {
        const unlistenReady = listen<AiEventReady>('ai:ready', () => {
            console.log('[AI] Session ready')
        })

        const unlistenDelta = listen<AiEventDelta>('ai:delta', event => {
            const text = event.payload.text
            accumulatedMessageRef.current += text
            requestAnimationFrame(() => {
                setCurrentAssistantMessage(accumulatedMessageRef.current)
            })
        })

        const unlistenToolCall = listen<AiEventToolCall>('ai:tool_call', event => {
            setToolCalls(prev => [
                ...prev,
                { index: event.payload.index, name: event.payload.name, status: 'calling' },
            ])
        })

        const unlistenTurnEnd = listen<AiEventTurnEnd>('ai:turn_end', event => {
            const status = event.payload.status
            if (status === 'ok') {
                turnCompletedRef.current = true
                if (accumulatedMessageRef.current) {
                    messageQueueRef.current.push({
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: accumulatedMessageRef.current,
                        timestamp: Date.now(),
                    })
                }
                setTimeout(() => {
                    setCurrentAssistantMessage('')
                    accumulatedMessageRef.current = ''
                    setIsStreaming(false)
                    setToolCalls([])
                    flushMessages()
                }, 0)
            } else if (status.startsWith('error:')) {
                void showAlert(`对话失败: ${status.slice(6)}`, 'error', 'toast', 3000)
                setTimeout(() => {
                    setCurrentAssistantMessage('')
                    accumulatedMessageRef.current = ''
                    setToolCalls([])
                    setIsStreaming(false)
                }, 0)
            }
        })

        const unlistenError = listen<AiEventError>('ai:error', event => {
            void showAlert(`AI 错误: ${event.payload.error}`, 'error', 'toast', 3000)
            setTimeout(() => {
                setIsStreaming(false)
                setCurrentAssistantMessage('')
                accumulatedMessageRef.current = ''
            }, 0)
        })

        return () => {
            unlistenReady.then(fn => fn())
            unlistenDelta.then(fn => fn())
            unlistenToolCall.then(fn => fn())
            unlistenTurnEnd.then(fn => fn())
            unlistenError.then(fn => fn())
        }
    }, [showAlert, flushMessages])

    const createSession = useCallback(async (convId: string) => {
        if (!selectedPlugin || !apiKey || !selectedModel) {
            void showAlert('请填写完整的配置信息', 'warning', 'toast', 2000)
            return false
        }

        const newSessionId = `session_${Date.now()}`
        try {
            await ai_create_llm_session({
                sessionId: newSessionId,
                pluginId: selectedPlugin,
                apiKey,
                model: selectedModel,
            })
            setSessionId(newSessionId)
            setConversations(prev => prev.map(c =>
                c.id === convId ? { ...c, sessionId: newSessionId } : c
            ))
            return true
        } catch (e) {
            void showAlert(`创建会话失败: ${e}`, 'error', 'toast', 3000)
            return false
        }
    }, [selectedPlugin, apiKey, selectedModel, showAlert])

    const handleNewConversation = useCallback(() => {
        if (sessionId) {
            ai_close_session(sessionId).catch(console.error)
        }

        const newId = `conv_${Date.now()}`
        const newConversation: Conversation = {
            id: newId,
            title: '新对话',
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            apiKey: apiKey,
            sessionId: null,
            timestamp: Date.now(),
        }

        setConversations(prev => [newConversation, ...prev])
        setActiveConversationId(newId)
        setSessionId(null)
        setCurrentAssistantMessage('')
        accumulatedMessageRef.current = ''
        setToolCalls([])
        setIsStreaming(false)

        if (sidebarCollapsed) {
            setSidebarCollapsed(false)
        }
    }, [sessionId, selectedPlugin, selectedModel, apiKey, sidebarCollapsed])

    const handleSwitchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationId) return

        if (sessionId) {
            await ai_close_session(sessionId).catch(console.error)
        }

        setActiveConversationId(convId)
        setSessionId(null)
        setCurrentAssistantMessage('')
        accumulatedMessageRef.current = ''
        setToolCalls([])
        setIsStreaming(false)

        const targetConv = conversations.find(c => c.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)
            setApiKey(targetConv.apiKey)
        }
    }, [activeConversationId, sessionId, conversations])

    const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const conv = conversations.find(c => c.id === convId)
        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }

        setConversations(prev => prev.filter(c => c.id !== convId))

        if (activeConversationId === convId) {
            setActiveConversationId(null)
            setSessionId(null)
            setCurrentAssistantMessage('')
        }
    }, [conversations, activeConversationId])

    const handleSend = useCallback(async () => {
        const trimmed = inputValue.trim()
        if (!trimmed || isStreaming) return

        if (!activeConversationId) {
            void showAlert('请先创建新对话', 'warning', 'toast', 2000)
            return
        }

        let currentSessionId = sessionId
        if (!currentSessionId) {
            const success = await createSession(activeConversationId)
            if (!success) return
            currentSessionId = `session_${Date.now()}`
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
        }

        const isFirstMessage = messages.length === 0

        setConversations(prev => prev.map(conv => {
            if (conv.id === activeConversationId) {
                const newTitle = isFirstMessage ? generateTitleFromMessage(trimmed) : conv.title

                return {
                    ...conv,
                    title: newTitle,
                    messages: [...conv.messages, userMessage],
                }
            }
            return conv
        }))

        setInputValue('')
        setIsStreaming(true)
        setCurrentAssistantMessage('')
        accumulatedMessageRef.current = ''
        turnCompletedRef.current = false
        setToolCalls([])

        try {
            await ai_send_message(currentSessionId, trimmed)
        } catch (e) {
            void showAlert(`发送失败: ${e}`, 'error', 'toast', 3000)
            setIsStreaming(false)
        }
    }, [inputValue, isStreaming, activeConversationId, sessionId, createSession, showAlert, messages.length])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void handleSend()
            }
        },
        [handleSend]
    )

    const handleApiKeyChange = useCallback((value: string) => {
        setApiKey(value)
    }, [])

    const selectedPluginInfo = plugins.find(p => p.id === selectedPlugin)

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => !prev)
    }, [])

    return (
        <div className={`ai-chat-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            {/* 左侧历史记录栏 */}
            <aside className="ai-sidebar">
                <div className="ai-sidebar-header">
                    {/* 展开时显示新对话按钮和收起按钮（水平排列） */}
                    {!sidebarCollapsed && (
                        <>
                            <Button
                                size="sm"
                                className="ai-new-chat-btn"
                                onClick={handleNewConversation}
                            >
                                <span className="ai-new-chat-icon">+</span>
                                <span className="ai-new-chat-text">新对话</span>
                            </Button>

                            <button
                                className="ai-sidebar-toggle"
                                onClick={toggleSidebar}
                                title="收起侧边栏"
                            >
                                <span className="ai-toggle-icon">−</span>
                            </button>
                        </>
                    )}

                    {/* 收起时只显示展开按钮 */}
                    {sidebarCollapsed && (
                        <button
                            className="ai-sidebar-toggle"
                            onClick={toggleSidebar}
                            title="展开侧边栏"
                        >
                            <span className="ai-toggle-icon">+</span>
                        </button>
                    )}
                </div>

                {/* 展开时显示历史列表 */}
                {!sidebarCollapsed && (
                    <div className="ai-conversations-list">
                        {conversations.length === 0 && (
                            <div className="ai-empty-history">
                                <p>暂无历史对话</p>
                            </div>
                        )}

                        {conversations.map(conv => (
                            <div
                                key={conv.id}
                                className={`ai-conversation-item ${conv.id === activeConversationId ? 'active' : ''}`}
                                onClick={() => handleSwitchConversation(conv.id)}
                            >
                                <div className="ai-conversation-info">
                                    <div className="ai-conversation-title" title={conv.title}>
                                        {conv.title}
                                    </div>
                                </div>
                                <button
                                    className="ai-conversation-delete"
                                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                                    title="删除对话"
                                >
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                        <path
                                            d="M2 3.5h10M4.5 3.5V2a1 1 0 011-1h3a1 1 0 011 1v1.5m-7 0v8a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5v-8M5.5 6v4M8.5 6v4"
                                            stroke="currentColor"
                                            strokeWidth="1.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </aside>

            {/* 右侧主区域 */}
            <main className="ai-main">
                <div className="ai-config-panel">
                    <div className="ai-config-body">
                        <div className="ai-config-field">
                            <label className="ai-config-label">插件</label>
                            <select
                                className="ai-config-select"
                                value={selectedPlugin}
                                onChange={e => setSelectedPlugin(e.target.value)}
                            >
                                <option value="">选择插件</option>
                                {plugins.map(plugin => (
                                    <option key={plugin.id} value={plugin.id}>
                                        {plugin.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="ai-config-field">
                            <label className="ai-config-label">API Key</label>
                            <Input
                                type="password"
                                value={apiKey}
                                onChange={handleApiKeyChange}
                                placeholder="输入 API Key"
                            />
                        </div>
                        {selectedPluginInfo && (
                            <div className="ai-config-field">
                                <label className="ai-config-label">模型</label>
                                <select
                                    className="ai-config-select"
                                    value={selectedModel}
                                    onChange={e => setSelectedModel(e.target.value)}
                                >
                                    {selectedPluginInfo.models.map(model => (
                                        <option key={model} value={model}>
                                            {model}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                <RollingBox className="ai-messages-container">
                    {!activeConversationId && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">
                                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                                    <circle cx="24" cy="24" r="20" stroke="var(--fc-color-border, #e5e5e5)" strokeWidth="2" />
                                    <path
                                        d="M16 20h16M16 28h12"
                                        stroke="var(--fc-color-text-secondary, #737373)"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </div>
                            <p className="ai-empty-text">开始新的对话</p>
                            <p className="ai-empty-hint">点击左侧"新对话"按钮开始聊天</p>
                        </div>
                    )}

                    {activeConversationId && messages.length === 0 && !currentAssistantMessage && (
                        <div className="ai-empty-state">
                            <p className="ai-empty-text">发送消息开始对话</p>
                        </div>
                    )}

                    {messages.map(message => (
                        <div key={message.id} className={`ai-message ai-message--${message.role}`}>
                            <div className="ai-message-avatar">
                                {message.role === 'user' ? '👤' : '🤖'}
                            </div>
                            <div className="ai-message-content">
                                <div className="ai-message-text">{message.content}</div>
                            </div>
                        </div>
                    ))}

                    {currentAssistantMessage && (
                        <div className="ai-message ai-message--assistant">
                            <div className="ai-message-avatar">🤖</div>
                            <div className="ai-message-content">
                                <div className="ai-message-text ai-message-text--streaming">
                                    {currentAssistantMessage}
                                    <span className="ai-cursor" />
                                </div>
                                {toolCalls.length > 0 && (
                                    <div className="ai-tool-calls">
                                        {toolCalls.map((tool, idx) => (
                                            <div key={idx} className="ai-tool-call">
                                                <span className="ai-tool-call-icon">
                                                    {tool.status === 'calling' ? '⚙️' : '✅'}
                                                </span>
                                                <span className="ai-tool-call-name">{tool.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </RollingBox>

                <div className="ai-input-area">
                    <div className="ai-input-wrapper">
                        <textarea
                            ref={inputRef}
                            className="ai-input-textarea"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={activeConversationId ? "输入消息... (Ctrl+Enter 发送)" : "请先创建新对话"}
                            disabled={isStreaming || !activeConversationId}
                            rows={3}
                        />
                        <div className="ai-input-actions">
                            <Button
                                size="sm"
                                className="ai-send-btn"
                                onClick={() => void handleSend()}
                                disabled={!inputValue.trim() || isStreaming || !activeConversationId}
                            >
                                {isStreaming ? '生成中...' : '发送'}
                            </Button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}