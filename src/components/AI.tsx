import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {MessageBox, RollingBox, useAlert} from 'flowcloudai-ui'
import {useAiContext} from '../contexts/useAiContext'
import './AI.css'

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500

interface AIChatProps {
    viewMode?: 'fullscreen' | 'sidebar'
}

export default function AIChat({viewMode = 'fullscreen'}: AIChatProps) {
    const ctx = useAiContext()
    const isSidebarMode = viewMode === 'sidebar'

    // ── 侧边栏模式：宽度与拖拽 ─────────────────────────────────
    const MIN_PANEL_WIDTH = 500
    const [panelWidth, setPanelWidth] = useState(MIN_PANEL_WIDTH)
    const [isResizeDragging, setIsResizeDragging] = useState(false)
    const isDraggingRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRef = useRef(0)

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        isDraggingRef.current = true
        setIsResizeDragging(true)
        dragStartXRef.current = e.clientX
        dragStartWidthRef.current = panelWidth
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [panelWidth])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return
            const delta = dragStartXRef.current - e.clientX
            const newWidth = Math.max(
                MIN_PANEL_WIDTH,
                Math.min(window.innerWidth * 0.5, dragStartWidthRef.current + delta)
            )
            setPanelWidth(newWidth)
        }
        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            isDraggingRef.current = false
            setIsResizeDragging(false)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [])

    // ── 重命名内联编辑 ────────────────────────────────────────
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const renameInputRef = useRef<HTMLInputElement>(null)

    const startRename = (e: React.MouseEvent, conv: { id: string; title: string }) => {
        e.stopPropagation()
        setRenamingId(conv.id)
        setRenameValue(conv.title)
        setTimeout(() => renameInputRef.current?.select(), 0)
    }

    const commitRename = async () => {
        if (renamingId) await ctx.renameConversation(renamingId, renameValue)
        setRenamingId(null)
    }

    const handleRenameKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') void commitRename()
        if (e.key === 'Escape') setRenamingId(null)
    }

    // ── 插件 / 模型切换菜单 ───────────────────────────────────
    const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false)
    const pluginSwitcherRef = useRef<HTMLDivElement>(null)

    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
    const modelSwitcherRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!isPluginMenuOpen) return
        const handleClick = (e: MouseEvent) => {
            if (pluginSwitcherRef.current && !pluginSwitcherRef.current.contains(e.target as Node)) {
                setIsPluginMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isPluginMenuOpen])

    useEffect(() => {
        if (!isModelMenuOpen) return
        const handleClick = (e: MouseEvent) => {
            if (modelSwitcherRef.current && !modelSwitcherRef.current.contains(e.target as Node)) {
                setIsModelMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isModelMenuOpen])

    // ── 本地 UI 状态 ──────────────────────────────────────────
    const [autoScroll, setAutoScroll] = useState(true)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const lastScrollTopRef = useRef(0)
    const {showAlert} = useAlert()

    const charCount = ctx.inputValue.length
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD
    const selectedPluginInfo = ctx.plugins.find(p => p.id === ctx.selectedPlugin)

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
    }, [ctx.inputValue])

    // ── 键盘 / 输入 ───────────────────────────────────────────
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                if (!ctx.inputValue.trim() || ctx.isStreaming || !ctx.activeConversationId) {
                    if (!ctx.activeConversationId) {
                        void showAlert('请先创建新对话', 'warning', 'toast', 2000)
                    }
                    return
                }
                void ctx.sendMessage(ctx.inputValue)
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ctx.inputValue, ctx.isStreaming, ctx.activeConversationId, ctx.sendMessage, showAlert],
    )

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (e.target.value.length <= MAX_CHARS) ctx.setInputValue(e.target.value)
    }

    // ── 渲染内容 ──────────────────────────────────────────────
    const innerLayout = `ai-chat-layout ${ctx.sidebarCollapsed ? 'sidebar-collapsed' : ''}`

    const sidebarContent = (
        <aside className="ai-sidebar">
            <div className="ai-sidebar-top">
                <button className="ai-sidebar-new-btn" onClick={() => void ctx.createNewConversation()} title="新对话">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M7 2v10M2 7h10"/>
                    </svg>
                    <span>新对话</span>
                </button>
            </div>
            <div className="ai-conversations-list">
                {ctx.conversations.length === 0 && (
                    <div className="ai-empty-history"><p>暂无历史对话</p></div>
                )}
                {ctx.conversations.map(conv => (
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
                                    onChange={e => setRenameValue(e.target.value)}
                                    onKeyDown={handleRenameKey}
                                    onBlur={() => void commitRename()}
                                    onClick={e => e.stopPropagation()}
                                />
                            ) : (
                                <div className="ai-conversation-title" title={conv.title}>{conv.title}</div>
                            )}
                        </div>
                        <div className="ai-conversation-actions">
                            <button
                                className="ai-conversation-action-btn"
                                onClick={e => startRename(e, conv)}
                                title="重命名"
                            >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                                     strokeWidth="1.3">
                                    <path d="M8.5 1.5a1.414 1.414 0 012 2L3.5 10.5l-3 .5.5-3 7.5-6.5z"/>
                                </svg>
                            </button>
                            <button
                                className="ai-conversation-action-btn ai-conversation-action-btn--danger"
                                onClick={e => void ctx.deleteConversation(conv.id, e)}
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
    )

    const chatContent = (
        <>
            {sidebarContent}
            <main className="ai-main">
                {/* 顶部栏 */}
                <div className="ai-topbar">
                    <div className="ai-topbar-left">
                        <button
                            className="ai-topbar-toggle"
                            onClick={() => ctx.setSidebarCollapsed(prev => !prev)}
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
                                    {ctx.plugins.map(p => (
                                        <button
                                            key={p.id}
                                            className={`ai-plugin-menu-item ${p.id === ctx.selectedPlugin ? 'active' : ''}`}
                                            onClick={() => {
                                                ctx.setSelectedPlugin(p.id);
                                                setIsPluginMenuOpen(false)
                                            }}
                                        >
                                            {p.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                className={`ai-topbar-btn ${isPluginMenuOpen ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsPluginMenuOpen(prev => !prev)
                                }}
                                title="切换插件"
                            >
                                <span>{ctx.plugins.find(p => p.id === ctx.selectedPlugin)?.name || '选择插件'}</span>
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
                    {!ctx.activeConversationId && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                                </svg>
                            </div>
                            <p className="ai-empty-text">开始新的对话</p>
                            <p className="ai-empty-hint">点击右上角「+」按钮开始聊天</p>
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

                {/* 悬浮输入框 */}
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
                            placeholder={ctx.activeConversationId ? '请输入消息...' : '请先创建新对话'}
                            disabled={ctx.isStreaming || !ctx.activeConversationId}
                        />
                        <div className="ai-floating-footer">
                            <div className="ai-floating-toolbar">
                                <button
                                    className={`ai-toolbar-btn ${ctx.sessionParams.thinking ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); ctx.setSessionParams(prev => ({...prev, thinking: !prev.thinking})); }}
                                    title="深度思考"
                                >
                                    深度思考
                                </button>
                                <button
                                    className={`ai-toolbar-btn ${ctx.webSearchEnabled ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); void ctx.toggleWebSearch(); }}
                                    title="联网搜索"
                                >
                                    联网搜索
                                </button>
                                <button
                                    className={`ai-toolbar-btn ${ctx.editModeEnabled ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); void ctx.toggleEditMode(); }}
                                    title={ctx.editModeEnabled ? '编辑模式' : '阅读模式'}
                                >
                                    {ctx.editModeEnabled ? '编辑模式' : '阅读模式'}
                                </button>
                                {/* 模型切换（向上展开） */}
                                <div className="ai-model-switcher" ref={modelSwitcherRef}>
                                    {isModelMenuOpen && selectedPluginInfo && (
                                        <div className="ai-model-menu">
                                            {selectedPluginInfo.models.map(m => (
                                                <button
                                                    key={m}
                                                    className={`ai-model-menu-item ${m === ctx.selectedModel ? 'active' : ''}`}
                                                    onClick={() => {
                                                        ctx.setSelectedModel(m);
                                                        setIsModelMenuOpen(false)
                                                    }}
                                                >
                                                    {m}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        className={`ai-toolbar-btn ${isModelMenuOpen ? 'active' : ''}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsModelMenuOpen(prev => !prev)
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
                                        onClick={(e) => { e.stopPropagation(); ctx.stopStreaming(); }}
                                        title="停止生成"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12" />
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if (!ctx.inputValue.trim() || !ctx.activeConversationId) return
                                            void ctx.sendMessage(ctx.inputValue)
                                        }}
                                        disabled={!ctx.inputValue.trim() || !ctx.activeConversationId}
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
        </>
    )

    // 全屏模式
    if (!isSidebarMode) {
        return (
            <div className={innerLayout}>
                {chatContent}
            </div>
        )
    }

    // 侧边栏模式：同样套 ai-chat-layout，让 @container 生效
    return (
        <div className="ai-sidebar-panel" style={{width: panelWidth}}>
            <div
                className={`ai-sidebar-resize-handle ${isResizeDragging ? 'is-dragging' : ''}`}
                onMouseDown={handleResizeStart}
                title="拖拽调整宽度"
            >
                <div className="ai-sidebar-resize-handle__grip" aria-hidden="true">
                    <span className="ai-sidebar-resize-handle__dot"/>
                    <span className="ai-sidebar-resize-handle__dot"/>
                    <span className="ai-sidebar-resize-handle__dot"/>
                </div>
            </div>
            <div className="ai-sidebar-panel-inner">
                <div className={innerLayout}>
                    {chatContent}
                </div>
            </div>
        </div>
    )
}
