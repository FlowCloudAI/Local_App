import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {MessageBox, RollingBox} from 'flowcloudai-ui'
import type {AiContextValue} from '../contexts/AiControllerTypes'

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500

interface AIChatContentProps {
    controller: AiContextValue
}

export default function AIChatContent({controller}: AIChatContentProps) {
    const ctx = controller
    const isBlankChat = !ctx.activeConversationId

    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
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
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const lastScrollTopRef = useRef(0)
    const charCount = ctx.inputValue.length
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD
    const selectedPluginInfo = ctx.plugins.find((plugin) => plugin.id === ctx.selectedPlugin)

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

    useLayoutEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        requestAnimationFrame(() => {
            const scrollTop = textarea.scrollTop
            textarea.style.height = 'auto'
            const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 200)
            textarea.style.height = `${nextHeight}px`
            textarea.scrollTop = scrollTop
        })
    }, [ctx.inputValue])

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            if (!ctx.inputValue.trim() || ctx.isStreaming) return
            void ctx.sendMessage(ctx.inputValue)
        }
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (event.target.value.length <= MAX_CHARS) ctx.setInputValue(event.target.value)
    }

    return (
        <>
            <aside className="ai-sidebar">
                <div className="ai-sidebar-top">
                    <div className="ai-sidebar-top-actions">
                        <button className="ai-sidebar-new-btn" onClick={() => void ctx.createNewConversation()}
                                title="新对话">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M7 2v10M2 7h10"/>
                            </svg>
                            <span>新对话</span>
                        </button>
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
                </div>
                <div className="ai-conversations-list">
                    {ctx.conversations.length === 0 && (
                        <div className="ai-empty-history"><p>暂无历史对话</p></div>
                    )}
                    {ctx.conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className={`ai-conversation-item ${conv.id === ctx.activeConversationId ? 'active' : ''}`}
                            onClick={() => renamingId !== conv.id && void ctx.switchConversation(conv.id)}
                        >
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
                                    <div className="ai-conversation-title" title={conv.title}>{conv.title}</div>
                                )}
                            </div>
                            <div className="ai-conversation-actions">
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
                    ))}
                </div>
            </aside>

            <main className="ai-main">
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
                    </div>
                </div>

                <RollingBox
                    className="ai-messages-container"
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    thumbSize={'thin'}
                >
                    {isBlankChat && (
                        <div className="ai-empty-state ai-empty-state--brand">
                            <p className="ai-empty-brand">流云AI</p>
                        </div>
                    )}
                    {ctx.activeConversationId && ctx.messages.length > 0 && (
                        <div className="ai-messages-list">
                            {ctx.messages.map((message) => (
                                <MessageBox
                                    key={message.id}
                                    role={message.role}
                                    blocks={message.blocks}
                                    content={message.content}
                                    toolCallDetail={'verbose'}
                                    markdown={message.role === 'assistant'}
                                    reasoning={message.reasoning || undefined}
                                    onCopy={() => navigator.clipboard.writeText(message.content)}
                                    onEdit={message.role === 'user'
                                        ? () => ctx.editMessage(message.id)
                                        : undefined}
                                    onRegenerate={message.role === 'assistant'
                                        ? () => void ctx.regenerateMessage(message.id)
                                        : undefined}
                                />
                            ))}
                            {ctx.streamingBlocks.length > 0 && ctx.isStreaming && (
                                <MessageBox
                                    role="assistant"
                                    blocks={ctx.streamingBlocks}
                                    streaming
                                    markdown
                                    rolePlaying
                                    toolCallDetail={'verbose'}
                                />
                            )}
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
                    <div className="ai-floating-input-inner">
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
                        <textarea
                            ref={textareaRef}
                            className="ai-floating-textarea"
                            value={ctx.inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={'请输入消息...'}
                            disabled={ctx.isStreaming}
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
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12"/>
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            if (!ctx.inputValue.trim()) return
                                            void ctx.sendMessage(ctx.inputValue)
                                        }}
                                        disabled={!ctx.inputValue.trim()}
                                        title="发送"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2">
                                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
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
