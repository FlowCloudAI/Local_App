import {useCallback, useEffect, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    ai_checkout,
    ai_close_session,
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
} from '../api'

// ── 导出类型 ──────────────────────────────────────────────────

export interface SessionMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    reasoning?: string
    /** 产生此消息的 session ID，用于跨对话路由 */
    sessionId: string
    /** TurnEnd 事件携带的助手消息节点 ID，用于 checkout / 重说 */
    nodeId?: number
}

export interface ToolCallInfo {
    index: number
    name: string
    status: 'calling' | 'completed' | 'error'
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
    const [isStreaming, setIsStreaming] = useState(false)
    const [currentText, setCurrentText] = useState('')
    const [currentReasoning, setCurrentReasoning] = useState('')
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])

    // 内部缓冲
    const accumulatedRef = useRef('')
    const reasoningRef = useRef('')
    const messageQueueRef = useRef<SessionMessage[]>([])

    // 每个用户轮次（非工具续轮）的起始节点 ID
    // 用于 regenerate：checkout 到此节点后后端免等直接重跑
    const lastUserNodeIdRef = useRef<number | null>(null)
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

    // ── 事件监听（仅注册一次） ────────────────────────────────
    useEffect(() => {
        const unlistenReady = listen<AiEventReady>('ai:ready', () => {
        })

        // 只记录用户发起轮次的起始节点（工具续轮不更新）
        const unlistenTurnBegin = listen<AiEventTurnBegin>('ai:turn_begin', event => {
            if (expectUserTurnRef.current) {
                lastUserNodeIdRef.current = event.payload.node_id
                expectUserTurnRef.current = false
            }
        })

        const unlistenDelta = listen<AiEventDelta>('ai:delta', event => {
            accumulatedRef.current += event.payload.text
            requestAnimationFrame(() => setCurrentText(accumulatedRef.current))
        })

        const unlistenReasoning = listen<AiEventReasoning>('ai:reasoning', event => {
            reasoningRef.current += event.payload.text
            requestAnimationFrame(() => setCurrentReasoning(reasoningRef.current))
        })

        const unlistenToolCall = listen<AiEventToolCall>('ai:tool_call', event => {
            console.log('[ai:tool_call]', event.payload.session_id, event.payload)
            setToolCalls(prev => [
                ...prev,
                {index: event.payload.index, name: event.payload.name, status: 'calling'},
            ])
        })

        const unlistenToolResult = listen<AiEventToolResult>('ai:tool_result', event => {
            console.log('[ai:tool_result]', event.payload.session_id, event.payload)
            setToolCalls(prev => prev.map(t =>
                t.index === event.payload.index
                    ? {...t, status: event.payload.is_error ? 'error' : 'completed'}
                    : t
            ))
        })

        const unlistenTurnEnd = listen<AiEventTurnEnd>('ai:turn_end', event => {
            const {status, node_id} = event.payload
            if (status === 'ok') {
                if (accumulatedRef.current) {
                    messageQueueRef.current.push({
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: accumulatedRef.current,
                        timestamp: Date.now(),
                        reasoning: reasoningRef.current || undefined,
                        sessionId: event.payload.session_id,
                        nodeId: node_id,
                    })
                }
                setTimeout(() => {
                    const queued = [...messageQueueRef.current]
                    messageQueueRef.current = []
                    queued.forEach(m => onMessageRef.current(m))
                    setCurrentText('')
                    accumulatedRef.current = ''
                    setCurrentReasoning('')
                    reasoningRef.current = ''
                    setIsStreaming(false)
                    setToolCalls([])
                }, 0)
            } else if (status.startsWith('error:')) {
                onErrorRef.current(`对话失败: ${status.slice(6)}`)
                setTimeout(() => {
                    setCurrentText('')
                    accumulatedRef.current = ''
                    setCurrentReasoning('')
                    reasoningRef.current = ''
                    setToolCalls([])
                    setIsStreaming(false)
                }, 0)
            } else if (status === 'cancelled' || status === 'interrupted') {
                setTimeout(() => {
                    setCurrentText('')
                    accumulatedRef.current = ''
                    setCurrentReasoning('')
                    reasoningRef.current = ''
                    setToolCalls([])
                    setIsStreaming(false)
                }, 0)
            }
        })

        const unlistenError = listen<AiEventError>('ai:error', event => {
            console.log('[ai:error]', event.payload.session_id, event.payload)
            onErrorRef.current(`AI 错误: ${event.payload.error}`)
            setTimeout(() => {
                setIsStreaming(false)
                setCurrentText('')
                accumulatedRef.current = ''
                setCurrentReasoning('')
                reasoningRef.current = ''
            }, 0)
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
    ): Promise<string | null> => {
        const newId = `session_${Date.now()}`
        try {
            await ai_create_llm_session({sessionId: newId, pluginId, model})
            setSessionId(newId)
            lastUserNodeIdRef.current = null
            return newId
        } catch (e) {
            onErrorRef.current(`创建会话失败: ${e}`)
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
        lastUserNodeIdRef.current = null
        setCurrentText('')
        accumulatedRef.current = ''
        setCurrentReasoning('')
        reasoningRef.current = ''
        setToolCalls([])
        setIsStreaming(false)
    }, [sessionId])

    const sendMessage = useCallback(async (content: string, sid: string) => {
        expectUserTurnRef.current = true
        setIsStreaming(true)
        setCurrentText('')
        accumulatedRef.current = ''
        setCurrentReasoning('')
        reasoningRef.current = ''
        setToolCalls([])
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
            setCurrentText('')
            accumulatedRef.current = ''
            setCurrentReasoning('')
            reasoningRef.current = ''
            setToolCalls([])
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
        isStreaming,
        currentText,
        currentReasoning,
        toolCalls,
        /** 当前用户轮次的起始节点 ID（用于 checkout / 重说） */
        lastUserNodeIdRef,
        createSession,
        closeSession,
        sendMessage,
        checkout,
        switchPlugin,
        updateModel,
    }
}
