import {useCallback, useEffect, useRef, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {useAiController, type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import type {Message} from '../../../features/ai-chat/model/AiControllerTypes'

interface Props {
    aiFocus: AiFocus
}

function MessageBubble({message}: { message: Message }) {
    const isUser = message.role === 'user'
    const hasBlocks = message.blocks && message.blocks.length > 0

    const renderContent = () => {
        if (hasBlocks) {
            return message.blocks!.map((block, i) => {
                if (block.type === 'content') {
                    return (
                        <div key={i} style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
                            {block.content}
                        </div>
                    )
                }
                if (block.type === 'reasoning') {
                    return (
                        <details key={i} style={{marginTop: 4, fontSize: 'var(--fc-font-size-xs)', opacity: 0.7}}>
                            <summary style={{cursor: 'pointer'}}>思考过程</summary>
                            <p style={{margin: '4px 0 0', whiteSpace: 'pre-wrap'}}>{block.content}</p>
                        </details>
                    )
                }
                if (block.type === 'tool' || block.type === 'tool_use') {
                    const tools = block.type === 'tool_use' ? block.tools : [block.tool]
                    return tools.map((tool, j) => (
                        <details key={`${i}-${j}`}
                                 style={{marginTop: 4, fontSize: 'var(--fc-font-size-xs)', opacity: 0.75}}>
                            <summary style={{cursor: 'pointer'}}>
                                {tool.result != null ? '✓' : '⟳'} 工具: {tool.name}
                            </summary>
                            <div style={{
                                margin: '4px 0',
                                padding: '4px 8px',
                                background: 'var(--fc-color-bg-secondary)',
                                borderRadius: 4,
                                maxHeight: 120,
                                overflow: 'auto'
                            }}>
                                <div style={{fontSize: 10, opacity: 0.6}}>参数:</div>
                                <pre style={{margin: 0, fontSize: 10, whiteSpace: 'pre-wrap'}}>{tool.args}</pre>
                                {tool.result != null && (
                                    <>
                                        <div style={{fontSize: 10, opacity: 0.6, marginTop: 4}}>结果:</div>
                                        <pre style={{
                                            margin: 0,
                                            fontSize: 10,
                                            whiteSpace: 'pre-wrap'
                                        }}>{tool.result}</pre>
                                    </>
                                )}
                            </div>
                        </details>
                    ))
                }
                return null
            })
        }

        if (message.content) {
            return <div style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>{message.content}</div>
        }
        return null
    }

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: isUser ? 'flex-end' : 'flex-start',
            marginBottom: 12,
        }}>
            <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isUser ? 'var(--fc-color-primary)' : 'var(--fc-color-bg-secondary)',
                color: isUser ? '#fff' : 'var(--fc-color-text)',
                fontSize: 'var(--fc-font-size-sm)',
                lineHeight: 1.55,
            }}>
                {renderContent()}
            </div>
            <span style={{
                fontSize: 10, color: 'var(--fc-color-text-secondary)',
                marginTop: 2, padding: '0 4px',
            }}>
                {isUser ? '你' : 'AI'} · {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            })}
            </span>
        </div>
    )
}

export default function MobileAiChat({aiFocus}: Props) {
    const {showAlert} = useAlert()
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const controller = useAiController(aiFocus)
    const {
        conversations, activeConversationId, setActiveConversationId,
        messages, sendMessage, stopStreaming,
        inputValue, setInputValue, isStreaming, streamingBlocks,
        switchConversation, createNewConversation, deleteConversation,
    } = controller

    const [showConvList, setShowConvList] = useState(false)

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
    }, [messages, streamingBlocks])

    useEffect(() => {
        if (conversations.length > 0 && !activeConversationId) {
            setActiveConversationId(conversations[0].id)
        }
    }, [conversations, activeConversationId, setActiveConversationId])

    const handleSend = useCallback(async () => {
        if (!inputValue.trim() || isStreaming) return
        await sendMessage(inputValue)
    }, [inputValue, isStreaming, sendMessage])

    const handleNewConv = useCallback(async () => {
        await createNewConversation()
        setShowConvList(false)
    }, [createNewConversation])

    const handleSelectConv = useCallback(async (convId: string) => {
        await switchConversation(convId)
        setShowConvList(false)
    }, [switchConversation])

    const handleDeleteConv = useCallback(async (convId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const result = await showAlert('确定删除此对话？', 'warning', 'confirm')
        if (result !== 'yes') return
        await deleteConversation(convId)
    }, [deleteConversation, showAlert])

    // 无对话时的欢迎页
    if (conversations.length === 0 && !isStreaming) {
        return (
            <div className="mobile-page__empty" style={{padding: '24px', gap: 16}}>
                <p style={{fontSize: 'var(--fc-font-size-lg)', fontWeight: 600, margin: 0}}>AI 对话</p>
                <p style={{color: 'var(--fc-color-text-secondary)', textAlign: 'center', margin: 0}}>
                    与 AI 讨论你的世界观项目，获取创作建议、检查设定矛盾、或与角色对话
                </p>
                <Button onClick={handleNewConv}>开始新对话</Button>
            </div>
        )
    }

    const contextLabel = aiFocus.entryId
        ? `正在讨论：词条`
        : aiFocus.projectId ? '正在讨论：项目' : ''

    return (
        <div style={{display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden'}}>
            {/* 顶部工具栏 */}
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid var(--fc-color-border)',
                background: 'var(--fc-color-bg-elevated)', display: 'flex', alignItems: 'center', gap: 8,
                flexShrink: 0,
            }}>
                <button
                    onClick={() => setShowConvList(v => !v)}
                    style={{
                        padding: '4px 8px', fontSize: 'var(--fc-font-size-xs)', borderRadius: 6,
                        border: '1px solid var(--fc-color-border)', background: 'var(--fc-color-bg)',
                        color: 'var(--fc-color-text)', cursor: 'pointer', whiteSpace: 'nowrap',
                        touchAction: 'manipulation',
                    }}
                >
                    对话 {activeConversationId ? `#${conversations.findIndex(c => c.id === activeConversationId) + 1}` : ''} {showConvList ? '▴' : '▾'}
                </button>
                {contextLabel && (
                    <span style={{
                        fontSize: 'var(--fc-font-size-xs)',
                        color: 'var(--fc-color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>
                        {contextLabel}
                    </span>
                )}
                <Button size="sm" variant="ghost" onClick={handleNewConv} style={{marginLeft: 'auto', flexShrink: 0}}>+
                    新建</Button>
            </div>

            {/* 对话列表：内联展开，撑开布局而非绝对浮层 */}
            {showConvList && (
                <div style={{
                    maxHeight: '40vh', overflowY: 'auto', flexShrink: 0,
                    background: 'var(--fc-color-bg-elevated)',
                    borderBottom: '1px solid var(--fc-color-border)',
                    padding: '4px 8px',
                }}>
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => handleSelectConv(conv.id)}
                            style={{
                                padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                                background: conv.id === activeConversationId ? 'var(--fc-color-bg-secondary)' : 'transparent',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                fontSize: 'var(--fc-font-size-sm)',
                            }}
                        >
                            <div style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                                {conv.title}
                                <div style={{
                                    fontSize: 'var(--fc-font-size-xs)',
                                    color: 'var(--fc-color-text-secondary)'
                                }}>
                                    {conv.messages.length} 条消息
                                </div>
                            </div>
                            <button
                                onClick={(e) => handleDeleteConv(conv.id, e)}
                                style={{
                                    padding: '4px 12px', fontSize: 'var(--fc-font-size-xs)',
                                    border: 'none', background: 'none', color: 'var(--fc-color-error)',
                                    cursor: 'pointer', touchAction: 'manipulation',
                                }}
                            >
                                删除
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* 消息列表：min-height:0 保证 flex 子元素可以收缩 */}
            <div style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px'}}>
                {messages.length === 0 && !isStreaming && (
                    <div className="mobile-page__empty" style={{height: '100%'}}>
                        <p>发送消息开始对话</p>
                    </div>
                )}
                {messages.map(message => (
                    <MessageBubble key={message.id} message={message}/>
                ))}
                {isStreaming && streamingBlocks.length > 0 && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 12,
                    }}>
                        <div style={{
                            maxWidth: '85%', padding: '10px 14px',
                            borderRadius: '16px 16px 16px 4px',
                            background: 'var(--fc-color-bg-secondary)',
                            color: 'var(--fc-color-text)',
                            fontSize: 'var(--fc-font-size-sm)',
                        }}>
                            {streamingBlocks.map((block, i) => {
                                if (block.type === 'content') {
                                    return <span key={i} style={{whiteSpace: 'pre-wrap'}}>{block.content}</span>
                                }
                                if (block.type === 'reasoning') {
                                    return (
                                        <details key={i} style={{fontSize: 'var(--fc-font-size-xs)', opacity: 0.7}}>
                                            <summary>思考中…</summary>
                                            <p>{block.content}</p>
                                        </details>
                                    )
                                }
                                return null
                            })}
                            <span className="fc-cursor-blink" style={{
                                display: 'inline-block', width: 2, height: '1em',
                                background: 'var(--fc-color-primary)', marginLeft: 2, verticalAlign: 'text-bottom',
                            }}/>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef}/>
            </div>

            {/* 底部输入区 */}
            <div style={{
                padding: '8px 12px', borderTop: '1px solid var(--fc-color-border)',
                background: 'var(--fc-color-bg-elevated)', display: 'flex', gap: 8, alignItems: 'flex-end',
            }}>
                <textarea
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void handleSend()
                        }
                    }}
                    placeholder="输入消息…"
                    rows={1}
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: 20,
                        border: '1px solid var(--fc-color-border)',
                        background: 'var(--fc-color-bg)',
                        color: 'var(--fc-color-text)',
                        fontSize: 'var(--fc-font-size-sm)',
                        resize: 'none', maxHeight: 120,
                        fontFamily: 'inherit',
                    }}
                />
                <Button
                    size="sm"
                    onClick={isStreaming ? stopStreaming : () => {
                        void handleSend()
                    }}
                    disabled={!inputValue.trim() && !isStreaming}
                    style={{borderRadius: 20, minWidth: 48}}
                >
                    {isStreaming ? '■' : '↑'}
                </Button>
            </div>
        </div>
    )
}
