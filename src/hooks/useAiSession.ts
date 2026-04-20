import {useCallback, useEffect, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {type MessageBoxBlock} from 'flowcloudai-ui'
import {
    ai_cancel_session,
    ai_checkout,
    ai_close_session,
    ai_create_character_session,
    ai_create_llm_session,
    ai_send_message,
    ai_switch_plugin,
    ai_update_session,
    type AiEventDelta,
    type AiEventError,
    type AiEventReady,
    type AiEventReasoning,
    type AiEventToolCall,
    type AiEventToolResult,
    type AiEventTurnBegin,
    type AiEventTurnEnd,
    type CharacterChatProjectSnapshot,
} from '../api'

// ── 导出类型 ──────────────────────────────────────────────────

export interface SessionMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    reasoning?: string
    blocks?: MessageBoxBlock[]
    /** 产生此消息的 session ID，用于跨对话路由 */
    sessionId: string
    /** 产生此消息的运行实例 ID，用于隔离同 session 的新旧轮次 */
    runId: string
    /** TurnEnd 事件携带的助手消息节点 ID，用于 checkout / 重说 */
    nodeId?: number
}

export interface SessionIdentity {
    sessionId: string
    conversationId: string
    runId: string
}

// ── Hook ─────────────────────────────────────────────────────

interface UseAiSessionOptions {
    /** 一轮对话完成时调用（助手消息已完整） */
    onMessage: (msg: SessionMessage) => void
    /** 会话级错误时调用 */
    onError: (msg: string) => void
}

export function useAiSession({onMessage, onError}: UseAiSessionOptions) {
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [runId, setRunId] = useState<string | null>(null)
    const [isStreaming, setIsStreaming] = useState(false)
    const [blocks, setBlocks] = useState<MessageBoxBlock[]>([])
    const [lastUserNodeId, setLastUserNodeId] = useState<number | null>(null)

    // 内部缓冲
    const messageQueueRef = useRef<SessionMessage[]>([])

    // 每个用户轮次（非工具续轮）的起始节点 ID
    // 用于 regenerate：checkout 到此节点后后端免等直接重跑
    const lastUserNodeIdRef = useRef<number | null>(null)
    const blocksByRunRef = useRef<Record<string, MessageBoxBlock[]>>({})
    const processingNodeIdByRunRef = useRef<Record<string, number | null>>({})
    const sessionIdRef = useRef<string | null>(null)
    const runIdRef = useRef<string | null>(null)
    // 标记下一个 TurnBegin 是用户发起的（非工具续轮）
    const expectUserTurnRef = useRef(false)

    // 通过 ref 访问回调，避免 event listener 内部 stale closure
    const onMessageRef = useRef(onMessage)
    const onErrorRef = useRef(onError)
    useEffect(() => {
        onMessageRef.current = onMessage
    }, [onMessage])
    useEffect(() => {
        onErrorRef.current = onError
    }, [onError])
    useEffect(() => {
        sessionIdRef.current = sessionId
    }, [sessionId])
    useEffect(() => {
        runIdRef.current = runId
    }, [runId])

    useEffect(() => {
        queueMicrotask(() => {
            setBlocks(runId ? (blocksByRunRef.current[runId] ?? []) : [])
            if (!runId) {
                setLastUserNodeId(null)
            }
        })
    }, [runId])

    // ── 事件监听（仅注册一次） ────────────────────────────────
    useEffect(() => {
        const unlistenReady = listen<AiEventReady>('ai:ready', () => {
        })

        // 只记录用户发起轮次的起始节点（工具续轮不更新）
        const unlistenTurnBegin = listen<AiEventTurnBegin>('ai:turn_begin', event => {
            console.log('[useAiSession][turn_begin]', {
                sessionId: event.payload.session_id,
                runId: event.payload.run_id,
                turnId: event.payload.turn_id,
                nodeId: event.payload.node_id,
                currentSessionId: sessionIdRef.current,
                currentRunId: runIdRef.current,
                expectUserTurn: expectUserTurnRef.current,
            })
            if (expectUserTurnRef.current && event.payload.run_id === runIdRef.current) {
                lastUserNodeIdRef.current = event.payload.node_id
                setLastUserNodeId(event.payload.node_id)
                expectUserTurnRef.current = false
            }
            processingNodeIdByRunRef.current[event.payload.run_id] = event.payload.node_id
        })

        const unlistenDelta = listen<AiEventDelta>('ai:delta', event => {
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.type === 'content') {
                next[next.length - 1] = {...last, content: last.content + event.payload.text}
            } else {
                next.push({type: 'content', content: event.payload.text, markdown: true, streaming: true})
            }
            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) {
                setBlocks(next)
            }
        })

        const unlistenReasoning = listen<AiEventReasoning>('ai:reasoning', event => {
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.type === 'reasoning') {
                next[next.length - 1] = {...last, content: last.content + event.payload.text}
            } else {
                next.push({type: 'reasoning', content: event.payload.text, streaming: true})
            }
            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) {
                setBlocks(next)
            }
        })

        const unlistenToolCall = listen<AiEventToolCall>('ai:tool_call', event => {
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const existingIndex = prev.findIndex(
                block => block.type === 'tool' && block.tool.index === event.payload.index,
            )
            let next: MessageBoxBlock[]
            if (existingIndex !== -1) {
                next = prev.map((block, index) => {
                    if (index !== existingIndex || block.type !== 'tool') return block
                    return {
                        ...block,
                        tool: {
                            ...block.tool,
                            name: event.payload.name,
                            args: event.payload.arguments || block.tool.args,
                        },
                    }
                })
            } else {
                next = [
                    ...prev,
                    {
                        type: 'tool',
                        tool: {
                            index: event.payload.index,
                            name: event.payload.name,
                            args: event.payload.arguments,
                        },
                        detail: 'verbose',
                    },
                ]
            }
            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) {
                setBlocks(next)
            }
        })

        const unlistenToolResult = listen<AiEventToolResult>('ai:tool_result', event => {
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const next = prev.map(b => {
                if (b.type !== 'tool' || b.tool.index !== event.payload.index) return b
                return {
                    ...b,
                    tool: {
                        ...b.tool,
                        result: event.payload.result ?? event.payload.output,
                        isError: event.payload.is_error,
                    },
                }
            })
            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) {
                setBlocks(next)
            }
        })

        const unlistenTurnEnd = listen<AiEventTurnEnd>('ai:turn_end', event => {
            const {session_id: sid, run_id: rid, status, node_id} = event.payload
            console.log('[useAiSession][turn_end]', {
                sessionId: sid,
                runId: rid,
                status,
                nodeId: node_id,
                currentSessionId: sessionIdRef.current,
                currentRunId: runIdRef.current,
                processingNodeId: processingNodeIdByRunRef.current[rid] ?? null,
            })
            if (status === 'ok') {
                processingNodeIdByRunRef.current[rid] = null

                const prev = blocksByRunRef.current[rid] ?? []
                const finalBlocks = prev.map(b => {
                    if (b.type === 'reasoning' || b.type === 'content') {
                        return {...b, streaming: false}
                    }
                    return b
                })
                blocksByRunRef.current[rid] = finalBlocks
                const contentText = finalBlocks
                    .filter(b => b.type === 'content')
                    .map(b => (b as { content: string }).content)
                    .join('')
                const reasoningText = finalBlocks
                    .filter(b => b.type === 'reasoning')
                    .map(b => (b as { content: string }).content)
                    .join('')
                if (contentText || reasoningText || finalBlocks.length > 0) {
                    console.log('[useAiSession][queueAssistant]', {
                        sessionId: sid,
                        runId: rid,
                        contentLength: contentText.length,
                        reasoningLength: reasoningText.length,
                        blockCount: finalBlocks.length,
                    })
                    messageQueueRef.current.push({
                        id: `a_${Date.now()}`,
                        role: 'assistant',
                        content: contentText,
                        timestamp: Date.now(),
                        reasoning: reasoningText || undefined,
                        blocks: finalBlocks,
                        sessionId: sid,
                        runId: rid,
                        nodeId: node_id,
                    })
                }

                queueMicrotask(() => {
                    const queued = [...messageQueueRef.current]
                    console.log('[useAiSession][flushQueue]', {
                        currentRunId: runIdRef.current,
                        queued: queued.map(item => ({
                            sessionId: item.sessionId,
                            runId: item.runId,
                            nodeId: item.nodeId ?? null,
                            contentLength: item.content.length,
                        })),
                    })
                    messageQueueRef.current = []
                    queued.forEach(m => onMessageRef.current(m))
                    delete blocksByRunRef.current[rid]
                    if (runIdRef.current === rid) {
                        setBlocks([])
                        setIsStreaming(false)
                    }
                })
            } else if (status.startsWith('error:')) {
                processingNodeIdByRunRef.current[rid] = null
                onErrorRef.current(`对话失败: ${status.slice(6)}`)
                queueMicrotask(() => {
                    delete blocksByRunRef.current[rid]
                    if (runIdRef.current === rid) {
                        setBlocks([])
                        setIsStreaming(false)
                    }
                })
            } else if (status === 'cancelled' || status === 'interrupted') {
                processingNodeIdByRunRef.current[rid] = null
                queueMicrotask(() => {
                    delete blocksByRunRef.current[rid]
                    if (runIdRef.current === rid) {
                        setBlocks([])
                        setIsStreaming(false)
                    }
                })
            }
        })

        const unlistenError = listen<AiEventError>('ai:error', event => {
            onErrorRef.current(`AI 错误: ${event.payload.error}`)
            queueMicrotask(() => {
                delete blocksByRunRef.current[event.payload.run_id]
                if (runIdRef.current === event.payload.run_id) {
                    setIsStreaming(false)
                    setBlocks([])
                }
            })
        })

        return () => {
            unlistenReady.then(fn => fn())
            unlistenTurnBegin.then(fn => fn())
            unlistenDelta.then(fn => fn())
            unlistenReasoning.then(fn => fn())
            unlistenToolCall.then(fn => fn())
            unlistenToolResult.then(fn => fn())
            unlistenTurnEnd.then(fn => fn())
            unlistenError.then(fn => fn())
        }
    }, []) // 空依赖——回调通过 ref 访问

    // ── 操作 ─────────────────────────────────────────────────

    const createSession = useCallback(async (
        pluginId: string,
        model: string,
        /** 复用已有对话时传入其 id，避免后端创建重复记录；不传则生成新 id */
        conversationId?: string,
    ): Promise<SessionIdentity | null> => {
        const newId = `session_${Date.now()}`
        try {
            const created = await ai_create_llm_session({
                sessionId: newId,
                pluginId,
                model,
                // 续聊时告知后端回放历史，新对话不传
                conversationId: conversationId ?? null,
            })
            console.log('[useAiSession][createSession]', created)
            sessionIdRef.current = created.session_id
            runIdRef.current = created.run_id
            setSessionId(created.session_id)
            setRunId(created.run_id)
            lastUserNodeIdRef.current = null
            return {
                sessionId: created.session_id,
                conversationId: created.conversation_id,
                runId: created.run_id,
            }
        } catch (e) {
            onErrorRef.current(`创建会话失败: ${e}`)
            return null
        }
    }, [])

    const createCharacterSession = useCallback(async (
        pluginId: string,
        model: string,
        params: {
            characterName: string
            projectSnapshot: CharacterChatProjectSnapshot
        },
    ): Promise<SessionIdentity | null> => {
        const newId = `session_${Date.now()}`
        try {
            const created = await ai_create_character_session({
                sessionId: newId,
                pluginId,
                characterName: params.characterName,
                projectSnapshot: params.projectSnapshot,
                model,
            })
            sessionIdRef.current = created.session_id
            runIdRef.current = created.run_id
            setSessionId(created.session_id)
            setRunId(created.run_id)
            lastUserNodeIdRef.current = null
            return {
                sessionId: created.session_id,
                conversationId: created.conversation_id,
                runId: created.run_id,
            }
        } catch (e) {
            onErrorRef.current(`创建角色会话失败: ${e}`)
            return null
        }
    }, [])

    /** 关闭会话并重置流式状态。传入 sid 可关闭非当前会话（用于删除对话）。 */
    const closeSession = useCallback(async (overrideSid?: string | null) => {
        const target = overrideSid !== undefined ? overrideSid : sessionId
        if (target) {
            await ai_close_session(target).catch(console.error)
        }
        setSessionId(null)
        setRunId(null)
        lastUserNodeIdRef.current = null
        setBlocks([])
        setIsStreaming(false)
    }, [sessionId])

    const cancelSession = useCallback(async (overrideSid?: string | null) => {
        const target = overrideSid !== undefined ? overrideSid : sessionIdRef.current
        if (!target) return
        await ai_cancel_session(target).catch(console.error)
    }, [])

    const sendMessage = useCallback(async (content: string, sid: string) => {
        expectUserTurnRef.current = true
        setIsStreaming(true)
        setBlocks([])
        try {
            await ai_send_message(sid, content)
        } catch (e) {
            onErrorRef.current(`发送失败: ${e}`)
            setIsStreaming(false)
        }
    }, [])

    /**
     * Checkout 到指定节点（重说 / 分支 / 历史回退）。
     * - 目标节点 role 为 user → drive loop 立即继续，无需再发消息
     * - 目标节点 role 为 assistant → drive loop 继续等待用户输入
     * 返回 true 表示指令已发送。
     */
    const checkout = useCallback(async (nodeId: number): Promise<boolean> => {
        if (!sessionId) return false
        try {
            await ai_checkout(sessionId, nodeId)
            expectUserTurnRef.current = true
            setIsStreaming(true)
            setBlocks([])
            return true
        } catch {
            return false
        }
    }, [sessionId])

    /**
     * 编辑模式专用 checkout：checkout 到 assistant 节点，让 session 等待新输入。
     * 不设 isStreaming=true，避免 UI 提前进入流式状态。
     */
    const checkoutForEdit = useCallback(async (nodeId: number): Promise<boolean> => {
        if (!sessionId) return false
        try {
            await ai_checkout(sessionId, nodeId)
            expectUserTurnRef.current = true
            setBlocks([])
            return true
        } catch {
            return false
        }
    }, [sessionId])

    /** 切换插件（下一轮对话生效） */
    const switchPlugin = useCallback(async (pluginId: string) => {
        if (!sessionId) return
        await ai_switch_plugin(sessionId, pluginId).catch(console.error)
    }, [sessionId])

    /** 运行时更新模型（立即生效） */
    const updateModel = useCallback(async (model: string) => {
        if (!sessionId) return
        await ai_update_session(sessionId, {model}).catch(console.error)
    }, [sessionId])

    return {
        sessionId,
        runId,
        isStreaming,
        blocks,
        /** 当前用户轮次的起始节点 ID（用于 checkout / 重说），state 版本供 effect 依赖 */
        lastUserNodeId,
        lastUserNodeIdRef,
        createSession,
        createCharacterSession,
        closeSession,
        cancelSession,
        sendMessage,
        checkout,
        checkoutForEdit,
        switchPlugin,
        updateModel,
    }
}
