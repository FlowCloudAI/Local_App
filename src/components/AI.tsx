// cSpell:ignore msword openxmlformats officedocument wordprocessingml
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, TagItem, useAlert } from 'flowcloudai-ui';
import { listen } from '@tauri-apps/api/event';
import { VariableSizeList as List } from 'react-window';
import { useDropzone } from 'react-dropzone';
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
} from '../api';
import './AI.css';

// -------------------- 类型定义 --------------------
interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    attachments?: Attachment[];
}

interface Attachment {
    id: string;
    name: string;
    type: 'image' | 'file';
    data: string;
    preview?: string;
}

interface ToolCallInfo {
    index: number;
    name: string;
    status: 'calling' | 'completed' | 'error';
}

interface Conversation {
    id: string;
    title: string;
    messages: Message[];
    pluginId: string;
    model: string;
    apiKey: string;
    sessionId: string | null;
    timestamp: number;
}

// -------------------- 常量 --------------------
const MAX_CHARS = 10000;
const SHOW_HINT_THRESHOLD = 9000;
const STORAGE_KEY = 'ai-conversations';

const messageQueueRef = { current: [] as Message[] };

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ');
    if (cleaned.length <= 20) return cleaned;
    return cleaned.slice(0, 20) + '...';
};

// -------------------- 组件 --------------------
export default function AIChat() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([]);
    const [selectedPlugin, setSelectedPlugin] = useState<string>('');
    const [selectedModel, setSelectedModel] = useState<string>('');

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    const activeConversation = conversations.find(c => c.id === activeConversationId);
    const messages = useMemo(() => activeConversation?.messages || [], [activeConversation]);

    const [inputValue, setInputValue] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);

    const accumulatedMessageRef = useRef('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const listRef = useRef<List>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState(400);
    const itemHeights = useRef<Record<number, number>>({});

    const { showAlert } = useAlert();

    // -------------------- 初始化加载插件 --------------------
    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error);
    }, []);

    // -------------------- 自动选择默认模型 --------------------
    useEffect(() => {
        if (selectedPlugin && plugins.length > 0 && !selectedModel) {
            const plugin = plugins.find(p => p.id === selectedPlugin);
            if (plugin) {
                const defaultModel = plugin.default_model || plugin.models[0] || '';
                if (defaultModel) {
                    setSelectedModel(defaultModel);
                }
            }
        }
    }, [selectedPlugin, plugins, selectedModel]);

    // -------------------- 监听容器高度变化（虚拟列表） --------------------
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // -------------------- 流式消息后滚动 --------------------
    useEffect(() => {
        if (!isStreaming && listRef.current && messages.length > 0) {
            listRef.current.scrollToItem(messages.length - 1, 'end');
        }
    }, [messages, isStreaming]);

    // -------------------- 输入框自动高度 --------------------
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }, [inputValue]);

    // -------------------- 会话创建 --------------------
    const createSession = useCallback(async (convId: string) => {
        if (!selectedPlugin || !selectedModel) {
            void showAlert('请填写完整的配置信息', 'warning', 'toast', 2000);
            return false;
        }

        const newSessionId = `session_${Date.now()}`;
        try {
            await ai_create_llm_session({
                sessionId: newSessionId,
                pluginId: selectedPlugin,
                apiKey: '',
                model: selectedModel,
            });
            setSessionId(newSessionId);
            setConversations(prev => prev.map(c =>
                c.id === convId ? { ...c, sessionId: newSessionId } : c
            ));
            return true;
        } catch (e) {
            void showAlert(`创建会话失败: ${e}`, 'error', 'toast', 3000);
            return false;
        }
    }, [selectedPlugin, selectedModel, showAlert]);

    // -------------------- 新对话 --------------------
    const handleNewConversation = useCallback(() => {
        if (sessionId) {
            ai_close_session(sessionId).catch(console.error);
        }

        const newId = `conv_${Date.now()}`;
        const newConversation: Conversation = {
            id: newId,
            title: '新对话',
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            apiKey: '',
            sessionId: null,
            timestamp: Date.now(),
        };

        setConversations(prev => [newConversation, ...prev]);
        setActiveConversationId(newId);
        setSessionId(null);
        setCurrentAssistantMessage('');
        accumulatedMessageRef.current = '';
        setToolCalls([]);
        setIsStreaming(false);
        setAttachments([]);

        if (sidebarCollapsed) {
            setSidebarCollapsed(false);
        }
    }, [sessionId, selectedPlugin, selectedModel, sidebarCollapsed]);

    // -------------------- 加载/初始化历史对话 --------------------
    useEffect(() => {
        const loadOrInit = () => {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                try {
                    const parsed: Conversation[] = JSON.parse(stored);
                    setConversations(parsed);
                    if (parsed.length > 0) {
                        const latest = parsed.sort((a, b) => b.timestamp - a.timestamp)[0];
                        setActiveConversationId(latest.id);
                        setSelectedPlugin(latest.pluginId);
                        setSelectedModel(latest.model);
                    } else {
                        handleNewConversation();
                    }
                } catch {
                    handleNewConversation();
                }
            } else {
                handleNewConversation();
            }
        };
        loadOrInit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // -------------------- 同步 conversations 到本地存储 --------------------
    useEffect(() => {
        if (conversations.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
        }
    }, [conversations]);

    // -------------------- 文件上传（react-dropzone） --------------------
    const onDrop = useCallback((acceptedFiles: File[]) => {
        const newAttachments: Attachment[] = [];
        acceptedFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result as string;
                const isImage = file.type.startsWith('image/');
                newAttachments.push({
                    id: `att_${Date.now()}_${Math.random()}`,
                    name: file.name,
                    type: isImage ? 'image' : 'file',
                    data: base64,
                    preview: isImage ? base64 : undefined,
                });
                setAttachments(prev => [...prev, ...newAttachments]);
            };
            reader.readAsDataURL(file);
        });
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: true,
        accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
            'text/plain': ['.txt'],
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    // -------------------- 粘贴图片/文件 --------------------
    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }
        if (files.length > 0) {
            onDrop(files);
        }
    }, [onDrop]);

    // -------------------- 消息复制 --------------------
    const copyMessage = (content: string) => {
        navigator.clipboard.writeText(content).then(() => {
            void showAlert('已复制到剪贴板', 'success', 'toast', 1500);
        }).catch(() => {
            void showAlert('复制失败', 'error', 'toast', 1500);
        });
    };

    // -------------------- 重新生成 --------------------
    const handleRegenerate = useCallback(async () => {
        if (!activeConversationId || messages.length < 2) return;
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return;

        const newMessages = messages.slice(0, -1);
        setConversations(prev => prev.map(c =>
            c.id === activeConversationId ? { ...c, messages: newMessages } : c
        ));

        try {
            let currentSessionId = sessionId;
            if (!currentSessionId) {
                const success = await createSession(activeConversationId);
                if (!success) return;
                currentSessionId = `session_${Date.now()}`;
            }
            setIsStreaming(true);
            setCurrentAssistantMessage('');
            accumulatedMessageRef.current = '';
            setToolCalls([]);
            await ai_send_message(currentSessionId, lastUserMsg.content);
        } catch (e) {
            void showAlert(`重新生成失败: ${e}`, 'error', 'toast', 3000);
            setIsStreaming(false);
        }
    }, [activeConversationId, messages, sessionId, createSession, showAlert]);

    // -------------------- 停止生成 --------------------
    const handleStopGeneration = useCallback(async () => {
        if (sessionId) {
            await ai_close_session(sessionId);
            setSessionId(null);
        }
        setIsStreaming(false);
        setCurrentAssistantMessage('');
        accumulatedMessageRef.current = '';
        setToolCalls([]);
    }, [sessionId]);

    // -------------------- 事件监听 --------------------
    const flushMessages = useCallback(() => {
        if (messageQueueRef.current.length > 0 && activeConversationId) {
            const queuedMessages = [...messageQueueRef.current];
            messageQueueRef.current = [];
            setConversations(prev => prev.map(conv => {
                if (conv.id === activeConversationId) {
                    return { ...conv, messages: [...conv.messages, ...queuedMessages] };
                }
                return conv;
            }));
        }
    }, [activeConversationId]);

    useEffect(() => {
        const unlistenReady = listen<AiEventReady>('ai:ready', () => {
            console.log('[AI] Session ready');
        });

        const unlistenDelta = listen<AiEventDelta>('ai:delta', event => {
            const text = event.payload.text;
            accumulatedMessageRef.current += text;
            requestAnimationFrame(() => {
                setCurrentAssistantMessage(accumulatedMessageRef.current);
            });
        });

        const unlistenToolCall = listen<AiEventToolCall>('ai:tool_call', event => {
            setToolCalls(prev => [
                ...prev,
                { index: event.payload.index, name: event.payload.name, status: 'calling' },
            ]);
        });

        const unlistenTurnEnd = listen<AiEventTurnEnd>('ai:turn_end', event => {
            const status = event.payload.status;
            if (status === 'ok') {
                if (accumulatedMessageRef.current) {
                    messageQueueRef.current.push({
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: accumulatedMessageRef.current,
                        timestamp: Date.now(),
                    });
                }
                setTimeout(() => {
                    setCurrentAssistantMessage('');
                    accumulatedMessageRef.current = '';
                    setIsStreaming(false);
                    setToolCalls([]);
                    flushMessages();
                }, 0);
            } else if (status.startsWith('error:')) {
                void showAlert(`对话失败: ${status.slice(6)}`, 'error', 'toast', 3000);
                setTimeout(() => {
                    setCurrentAssistantMessage('');
                    accumulatedMessageRef.current = '';
                    setToolCalls([]);
                    setIsStreaming(false);
                }, 0);
            }
        });

        const unlistenError = listen<AiEventError>('ai:error', event => {
            void showAlert(`AI 错误: ${event.payload.error}`, 'error', 'toast', 3000);
            setTimeout(() => {
                setIsStreaming(false);
                setCurrentAssistantMessage('');
                accumulatedMessageRef.current = '';
            }, 0);
        });

        return () => {
            unlistenReady.then(fn => fn());
            unlistenDelta.then(fn => fn());
            unlistenToolCall.then(fn => fn());
            unlistenTurnEnd.then(fn => fn());
            unlistenError.then(fn => fn());
        };
    }, [showAlert, flushMessages]);

    // -------------------- 切换对话 --------------------
    const handleSwitchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationId) return;

        if (sessionId) {
            await ai_close_session(sessionId).catch(console.error);
        }

        setActiveConversationId(convId);
        setSessionId(null);
        setCurrentAssistantMessage('');
        accumulatedMessageRef.current = '';
        setToolCalls([]);
        setIsStreaming(false);
        setAttachments([]);

        const targetConv = conversations.find(c => c.id === convId);
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId);
            setSelectedModel(targetConv.model);
        }
    }, [activeConversationId, sessionId, conversations]);

    // -------------------- 删除对话 --------------------
    const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const conv = conversations.find(c => c.id === convId);
        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error);
        }

        setConversations(prev => prev.filter(c => c.id !== convId));

        if (activeConversationId === convId) {
            setActiveConversationId(null);
            setSessionId(null);
            setCurrentAssistantMessage('');
        }
    }, [conversations, activeConversationId]);

    // -------------------- 发送消息 --------------------
    const handleSend = useCallback(async () => {
        const trimmed = inputValue.trim();
        if ((!trimmed && attachments.length === 0) || isStreaming) return;

        if (!activeConversationId) {
            void showAlert('请先创建新对话', 'warning', 'toast', 2000);
            return;
        }

        let currentSessionId = sessionId;
        if (!currentSessionId) {
            const success = await createSession(activeConversationId);
            if (!success) return;
            currentSessionId = `session_${Date.now()}`;
        }

        let content = trimmed;
        if (attachments.length > 0) {
            const attachDesc = attachments.map(a => `[附件: ${a.name}]`).join(' ');
            content = trimmed ? `${trimmed}\n${attachDesc}` : attachDesc;
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: Date.now(),
            attachments: [...attachments],
        };

        const isFirstMessage = messages.length === 0;

        setConversations(prev => prev.map(conv => {
            if (conv.id === activeConversationId) {
                const newTitle = isFirstMessage ? generateTitleFromMessage(trimmed) : conv.title;
                return {
                    ...conv,
                    title: newTitle,
                    messages: [...conv.messages, userMessage],
                };
            }
            return conv;
        }));

        setInputValue('');
        setAttachments([]);
        setIsStreaming(true);
        setCurrentAssistantMessage('');
        accumulatedMessageRef.current = '';
        setToolCalls([]);

        try {
            await ai_send_message(currentSessionId, content);
        } catch (e) {
            void showAlert(`发送失败: ${e}`, 'error', 'toast', 3000);
            setIsStreaming(false);
        }
    }, [inputValue, attachments, isStreaming, activeConversationId, sessionId, createSession, showAlert, messages.length]);

    // -------------------- 键盘事件 --------------------
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                void handleSend();
            }
        },
        [handleSend]
    );

    // -------------------- 输入字数限制 --------------------
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        if (val.length <= MAX_CHARS) {
            setInputValue(val);
        }
    };

    const charCount = inputValue.length;
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD;

    // -------------------- 虚拟列表相关 --------------------
    const getItemSize = useCallback((index: number) => {
        return itemHeights.current[index] || 80;
    }, []);

    const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
        const message = messages[index];
        const rowRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            if (rowRef.current) {
                const height = rowRef.current.getBoundingClientRect().height;
                if (itemHeights.current[index] !== height) {
                    itemHeights.current[index] = height;
                    listRef.current?.resetAfterIndex(index);
                }
            }
        }, [index, message]);

        return (
            <div style={style}>
                <div ref={rowRef} className={`ai-message ai-message--${message.role}`}>
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
                                <button
                                    className="ai-action-btn"
                                    onClick={() => copyMessage(message.content)}
                                    title="复制"
                                >
                                    📋
                                </button>
                                <button
                                    className="ai-action-btn"
                                    onClick={() => void handleRegenerate()}
                                    title="重新生成"
                                >
                                    🔄
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const selectedPluginInfo = plugins.find(p => p.id === selectedPlugin);
    const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

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
                            <button
                                className="ai-sidebar-toggle"
                                onClick={toggleSidebar}
                                title="收起侧边栏"
                            >
                                <span className="ai-toggle-icon">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10 3L5 8L10 13" />
                                    </svg>
                                </span>
                            </button>
                        </>
                    )}
                    {sidebarCollapsed && (
                        <button
                            className="ai-sidebar-toggle"
                            onClick={toggleSidebar}
                            title="展开侧边栏"
                        >
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
                                <button className="ai-conversation-delete" onClick={(e) => void handleDeleteConversation(conv.id, e)}>
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
                {/* 配置面板 - 只保留 className，移除不支持的属性 */}
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

                {/* 消息区域 - 虚拟列表 */}
                <div className="ai-messages-container" ref={messagesContainerRef} {...getRootProps()}>
                    <input {...getInputProps()} />
                    {isDragActive && <div className="ai-drop-overlay">拖拽文件到此处上传</div>}
                    {!activeConversationId && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">💬</div>
                            <p className="ai-empty-text">开始新的对话</p>
                            <p className="ai-empty-hint">点击左侧"新对话"按钮开始聊天</p>
                        </div>
                    )}
                    {messages.length > 0 && (
                        <List
                            ref={listRef}
                            height={containerHeight}
                            itemCount={messages.length}
                            itemSize={getItemSize}
                            width="100%"
                            className="ai-virtual-list"
                        >
                            {Row}
                        </List>
                    )}
                    {currentAssistantMessage && (
                        <div className="ai-message ai-message--assistant ai-streaming-message">
                            <div className="ai-message-avatar">🤖</div>
                            <div className="ai-message-content">
                                <div className="ai-message-text ai-message-text--streaming">
                                    {currentAssistantMessage}
                                    <span className="ai-cursor" />
                                </div>
                                {toolCalls.length > 0 && (
                                    <div className="ai-tool-calls">
                                        {toolCalls.map((tool, idx) => (
                                            <TagItem key={idx} schema={{ id: `tool-${idx}`, name: tool.name, type: 'string', range_min: null, range_max: null }}
                                                     value={tool.status === 'calling' ? '调用中' : '已完成'} mode="show" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* 输入区域 */}
                <div className="ai-input-area">
                    {attachments.length > 0 && (
                        <div className="ai-attachments-preview">
                            {attachments.map(att => (
                                <div key={att.id} className="ai-attachment-preview-item">
                                    {att.type === 'image' && att.preview ? (
                                        <img src={att.preview} alt={att.name} />
                                    ) : (
                                        <span>📄 {att.name}</span>
                                    )}
                                    <button className="ai-remove-attachment" onClick={() => removeAttachment(att.id)}>×</button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="ai-input-wrapper">
                        <textarea
                            ref={(node) => {
                                inputRef.current = node;
                                textareaRef.current = node;
                            }}
                            className="ai-input-textarea"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={activeConversationId ? "请输入消息 (Enter 发送，支持粘贴图片/文件)" : "请先创建新对话"}
                            disabled={isStreaming || !activeConversationId}
                            rows={1}
                        />
                        <div className="ai-input-actions">
                            {showCharHint && (
                                <span className="ai-char-count">{charCount}/{MAX_CHARS}</span>
                            )}
                            {isStreaming ? (
                                <Button size="sm" className="ai-stop-btn" onClick={() => void handleStopGeneration()}>
                                    停止
                                </Button>
                            ) : (
                                <button
                                    className="ai-send-icon-btn"
                                    onClick={() => void handleSend()}
                                    disabled={(!inputValue.trim() && attachments.length === 0) || !activeConversationId}
                                    title="发送"
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="12" y1="19" x2="12" y2="5"></line>
                                        <polyline points="5 12 12 5 19 12"></polyline>
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}