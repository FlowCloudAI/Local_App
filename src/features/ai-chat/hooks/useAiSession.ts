import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {type MessageBoxBlock, type ToolCallInfo} from 'flowcloudai-ui'
import {
    ai_cancel_session,
    ai_checkout,
    ai_close_session,
    ai_create_character_session,
    ai_create_llm_session,
    ai_get_conversation_tree,
    ai_send_message,
    ai_switch_plugin,
    ai_update_session,
    type AiEventBranchChanged,
    type AiEventDelta,
    type AiEventError,
    type AiEventReady,
    type AiEventReasoning,
    type AiEventToolCall,
    type AiEventToolResult,
    type AiEventTurnBegin,
    type AiEventTurnEnd,
    type AiUsage,
    type CharacterChatProjectSnapshot,
    type ConversationNode,
    formatApiError,
    type StoredConversationSettings,
    toApiError,
} from '../../../api'
import {isMissingBackendSessionError} from '../lib/sessionErrors'

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
    /** 本轮 API 用量。供应商未返回 usage 时为空。 */
    usage?: AiUsage | null
}

export interface SessionIdentity {
    sessionId: string
    conversationId: string
    runId: string
}

export interface CreateSessionToolAccess {
    toolAccess: 'read' | 'edit'
    webSearchEnabled: boolean
}

// ── 钩子 ─────────────────────────────────────────────────────

interface UseAiSessionOptions {
    /** 一轮对话完成时调用（助手消息已完整） */
    onMessage: (msg: SessionMessage) => void
    /** 用户轮次开始时调用，用于给对应会话回填节点 ID */
    onUserTurnBegin?: (payload: { sessionId: string; runId: string; nodeId: number }) => void
    /** 会话级错误时调用 */
    onError: (msg: string) => void
}

export function useAiSession({onMessage, onUserTurnBegin, onError}: UseAiSessionOptions) {
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [runId, setRunId] = useState<string | null>(null)
    const [streamingByRun, setStreamingByRun] = useState<Record<string, boolean>>({})
    const [blocks, setBlocks] = useState<MessageBoxBlock[]>([])
    const [lastUserNodeId, setLastUserNodeId] = useState<number | null>(null)

    // 内部缓冲
    const messageQueueRef = useRef<SessionMessage[]>([])

    // 每个用户轮次（非工具续轮）的起始节点 ID
    // 用于 regenerate：checkout 到此节点后后端免等直接重跑
    const lastUserNodeIdRef = useRef<number | null>(null)
    const lastUserNodeIdByRunRef = useRef<Record<string, number | null>>({})
    const blocksByRunRef = useRef<Record<string, MessageBoxBlock[]>>({})
    const processingNodeIdByRunRef = useRef<Record<string, number | null>>({})
    const sessionIdByRunRef = useRef<Record<string, string>>({})
    const streamingByRunRef = useRef<Record<string, boolean>>({})
    const eventSeenAfterSendByRunRef = useRef<Record<string, boolean>>({})
    const lastEventNameByRunRef = useRef<Record<string, string>>({})
    const traceIdByRunRef = useRef<Record<string, string>>({})
    const sessionIdRef = useRef<string | null>(null)
    const runIdRef = useRef<string | null>(null)
    // 标记每个 run 的下一个 TurnBegin 是用户发起的（非工具续轮）
    const expectUserTurnByRunRef = useRef<Record<string, boolean>>({})

    // 分支导航
    const [treeNodes, setTreeNodes] = useState<ConversationNode[]>([])
    const [treeRefreshCounter, setTreeRefreshCounter] = useState(0)
    const [branchSwitchVersion, setBranchSwitchVersion] = useState(0)
    const branchInfoRef = useRef<Map<number, {branchIndex: number; branchTotal: number; siblings: number[]}>>(new Map())

    // 通过 ref 访问回调，避免 event listener 内部 stale closure
    const onMessageRef = useRef(onMessage)
    const onUserTurnBeginRef = useRef(onUserTurnBegin)
    const onErrorRef = useRef(onError)
    useEffect(() => {
        onMessageRef.current = onMessage
    }, [onMessage])
    useEffect(() => {
        onUserTurnBeginRef.current = onUserTurnBegin
    }, [onUserTurnBegin])
    useEffect(() => {
        onErrorRef.current = onError
    }, [onError])
    useEffect(() => {
        sessionIdRef.current = sessionId
    }, [sessionId])
    useEffect(() => {
        runIdRef.current = runId
    }, [runId])

    const syncActiveRunView = useCallback((nextRunId: string | null) => {
        setBlocks(nextRunId ? (blocksByRunRef.current[nextRunId] ?? []) : [])
        const nextLastUserNodeId = nextRunId ? (lastUserNodeIdByRunRef.current[nextRunId] ?? null) : null
        lastUserNodeIdRef.current = nextLastUserNodeId
        setLastUserNodeId(nextLastUserNodeId)
    }, [])

    const setRunStreaming = useCallback((targetRunId: string, streaming: boolean) => {
        const next = {...streamingByRunRef.current}
        if (streaming) {
            next[targetRunId] = true
        } else {
            delete next[targetRunId]
        }
        streamingByRunRef.current = next
        setStreamingByRun(next)
    }, [])

    const clearRunState = useCallback((targetRunId: string) => {
        delete blocksByRunRef.current[targetRunId]
        delete processingNodeIdByRunRef.current[targetRunId]
        delete sessionIdByRunRef.current[targetRunId]
        delete lastUserNodeIdByRunRef.current[targetRunId]
        delete expectUserTurnByRunRef.current[targetRunId]
        delete eventSeenAfterSendByRunRef.current[targetRunId]
        delete lastEventNameByRunRef.current[targetRunId]
        delete traceIdByRunRef.current[targetRunId]
        setRunStreaming(targetRunId, false)
        if (runIdRef.current === targetRunId) {
            sessionIdRef.current = null
            runIdRef.current = null
            setSessionId(null)
            setRunId(null)
            syncActiveRunView(null)
        }
    }, [setRunStreaming, syncActiveRunView])

    const activateSession = useCallback((nextSessionId: string | null, nextRunId: string | null) => {
        sessionIdRef.current = nextSessionId
        runIdRef.current = nextRunId
        setSessionId(nextSessionId)
        setRunId(nextRunId)
        if (nextSessionId && nextRunId) {
            sessionIdByRunRef.current[nextRunId] = nextSessionId
        }
        syncActiveRunView(nextRunId)
    }, [syncActiveRunView])

    const markRunEvent = useCallback((eventName: string, targetRunId: string) => {
        eventSeenAfterSendByRunRef.current[targetRunId] = true
        lastEventNameByRunRef.current[targetRunId] = eventName
        logger.debug('[useAiSession][事件链路] 收到 AI 事件', {
            eventName,
            runId: targetRunId,
            activeRunId: runIdRef.current,
        })
    }, [])

    const scheduleTurnBeginWatchdog = useCallback((payload: AiEventTurnBegin) => {
        window.setTimeout(() => {
            const rid = payload.run_id
            if (
                streamingByRunRef.current[rid]
                && lastEventNameByRunRef.current[rid] === 'ai:turn_begin'
            ) {
                logger.warn('[useAiSession][事件链路] 已进入 AI 轮次，但 15 秒内没有收到下游事件', {
                    traceId: traceIdByRunRef.current[rid] ?? null,
                    sessionId: payload.session_id,
                    runId: rid,
                    turnId: payload.turn_id,
                    nodeId: payload.node_id,
                    activeSessionId: sessionIdRef.current,
                    activeRunId: runIdRef.current,
                    hint: '卡点位于 flowcloudai_client 的 snapshot/orchestrator/prepare_request/http_send/stream_read 阶段。',
                })
            }
        }, 15000)
    }, [])

    useEffect(() => {
        queueMicrotask(() => {
            syncActiveRunView(runId)
        })
    }, [runId, syncActiveRunView])

    // ── 事件监听（仅注册一次） ────────────────────────────────
    useEffect(() => {
        const unlistenReady = listen<AiEventReady>('ai:ready', event => {
            markRunEvent('ai:ready', event.payload.run_id)
            logger.log('[useAiSession][ready]', {
                sessionId: event.payload.session_id,
                runId: event.payload.run_id,
            })
        })

        // 只记录用户发起轮次的起始节点（工具续轮不更新）
        const unlistenTurnBegin = listen<AiEventTurnBegin>('ai:turn_begin', event => {
            markRunEvent('ai:turn_begin', event.payload.run_id)
            scheduleTurnBeginWatchdog(event.payload)
            logger.log('[useAiSession][turn_begin]', {
                sessionId: event.payload.session_id,
                runId: event.payload.run_id,
                turnId: event.payload.turn_id,
                nodeId: event.payload.node_id,
                currentSessionId: sessionIdRef.current,
                currentRunId: runIdRef.current,
                expectUserTurn: Boolean(expectUserTurnByRunRef.current[event.payload.run_id]),
            })
            sessionIdByRunRef.current[event.payload.run_id] = event.payload.session_id
            if (expectUserTurnByRunRef.current[event.payload.run_id]) {
                lastUserNodeIdByRunRef.current[event.payload.run_id] = event.payload.node_id
                if (event.payload.run_id === runIdRef.current) {
                    lastUserNodeIdRef.current = event.payload.node_id
                    setLastUserNodeId(event.payload.node_id)
                }
                onUserTurnBeginRef.current?.({
                    sessionId: event.payload.session_id,
                    runId: event.payload.run_id,
                    nodeId: event.payload.node_id,
                })
                delete expectUserTurnByRunRef.current[event.payload.run_id]
            }
            processingNodeIdByRunRef.current[event.payload.run_id] = event.payload.node_id
        })

        const unlistenDelta = listen<AiEventDelta>('ai:delta', event => {
            markRunEvent('ai:delta', event.payload.run_id)
            logger.log('[useAiSession][delta]', {
                runId: event.payload.run_id,
                textLen: event.payload.text.length,
                text: event.payload.text,
            })
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
            markRunEvent('ai:reasoning', event.payload.run_id)
            logger.log('[useAiSession][reasoning]', {
                runId: event.payload.run_id,
                textLen: event.payload.text.length,
                text: event.payload.text,
            })
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
            markRunEvent('ai:tool_call', event.payload.run_id)
            logger.log('[useAiSession][tool_call]', {
                runId: event.payload.run_id,
                index: event.payload.index,
                name: event.payload.name,
                args: event.payload.arguments,
            })
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const pendingToolIndexes = prev.flatMap(block => {
                if (block.type === 'tool' && block.tool.result == null) return [block.tool.index]
                if (block.type === 'tool_use') {
                    return block.tools.filter(tool => tool.result == null).map(tool => tool.index)
                }
                return []
            })
            logger.info('[useAiSession][tool_call_state_before]', {
                runId: runKey,
                index: event.payload.index,
                name: event.payload.name,
                blockCount: prev.length,
                pendingToolIndexes,
            })

            // 按 index 去重：相同 tool_call 事件到达已有块
            const existingToolIdx = prev.findIndex(
                block => block.type === 'tool'
                    && block.tool.index === event.payload.index
                    && block.tool.result == null,
            )
            if (existingToolIdx !== -1) {
                const next = prev.map((block, index) => {
                    if (index !== existingToolIdx || block.type !== 'tool') return block
                    return {
                        ...block,
                        tool: {
                            ...block.tool,
                            name: event.payload.name,
                            args: event.payload.arguments || block.tool.args,
                        },
                    }
                })
                blocksByRunRef.current[runKey] = next
                if (runIdRef.current === runKey) setBlocks(next)
                logger.info('[useAiSession][tool_call_state_after]', {
                    runId: runKey,
                    index: event.payload.index,
                    action: 'update_existing_tool',
                    blockCount: next.length,
                })
                return
            }

            // 在 tool_use 组内按 index 去重
            const existingToolUseIdx = prev.findIndex(
                block => block.type === 'tool_use'
                    && block.tools.some(t => t.index === event.payload.index && t.result == null),
            )
            if (existingToolUseIdx !== -1) {
                const next = prev.map((block, index) => {
                    if (index !== existingToolUseIdx || block.type !== 'tool_use') return block
                    return {
                        ...block,
                        tools: block.tools.map(t => {
                            if (t.index !== event.payload.index || t.result != null) return t
                            return {...t, name: event.payload.name, args: event.payload.arguments || t.args}
                        }),
                    }
                })
                blocksByRunRef.current[runKey] = next
                if (runIdRef.current === runKey) setBlocks(next)
                logger.info('[useAiSession][tool_call_state_after]', {
                    runId: runKey,
                    index: event.payload.index,
                    action: 'update_existing_tool_group',
                    blockCount: next.length,
                })
                return
            }

            // 分组：合并连续的同名 tool 调用
            const newTool: ToolCallInfo = {
                index: event.payload.index,
                name: event.payload.name,
                args: event.payload.arguments,
            }
            const last = prev[prev.length - 1]
            let next: MessageBoxBlock[]

            if (last && last.type === 'tool_use'
                && last.tools.length > 0
                && last.tools[0].name === event.payload.name
                && last.tools.some(t => t.result == null)) {
                // 追加到已有 tool_use 组
                next = [...prev.slice(0, -1), {...last, tools: [...last.tools, newTool]}]
            } else if (last && last.type === 'tool'
                && last.tool.name === event.payload.name
                && last.tool.result == null) {
                // 将最后一个独立 tool 与新 tool 合并为 tool_use 组
                next = [...prev.slice(0, -1), {
                    type: 'tool_use' as const,
                    tools: [last.tool, newTool],
                    detail: 'verbose' as const,
                }]
            } else {
                next = [...prev, {type: 'tool', tool: newTool, detail: 'verbose'}]
            }

            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) setBlocks(next)
            logger.info('[useAiSession][tool_call_state_after]', {
                runId: runKey,
                index: event.payload.index,
                action: last && (last.type === 'tool' || last.type === 'tool_use') ? 'append_or_group_tool' : 'append_tool',
                blockCount: next.length,
            })
        })

        const unlistenToolResult = listen<AiEventToolResult>('ai:tool_result', event => {
            markRunEvent('ai:tool_result', event.payload.run_id)
            logger.log('[useAiSession][tool_result]', {
                runId: event.payload.run_id,
                index: event.payload.index,
                isError: event.payload.is_error,
                resultLen: (event.payload.result ?? event.payload.output)?.length ?? 0,
                result: event.payload.result ?? event.payload.output,
            })
            const runKey = event.payload.run_id
            const prev = blocksByRunRef.current[runKey] ?? []
            const pendingToolIndexes = prev.flatMap(block => {
                if (block.type === 'tool' && block.tool.result == null) return [block.tool.index]
                if (block.type === 'tool_use') {
                    return block.tools.filter(tool => tool.result == null).map(tool => tool.index)
                }
                return []
            })
            logger.info('[useAiSession][tool_result_state_before]', {
                runId: runKey,
                index: event.payload.index,
                isError: event.payload.is_error,
                blockCount: prev.length,
                pendingToolIndexes,
            })
            let matchedToolResult = false
            const next = prev.map(b => {
                // 独立 tool 块
                if (b.type === 'tool' && b.tool.index === event.payload.index && b.tool.result == null) {
                    matchedToolResult = true
                    return {
                        ...b,
                        tool: {
                            ...b.tool,
                            result: event.payload.result ?? event.payload.output,
                            isError: event.payload.is_error,
                        },
                    }
                }
                // tool_use 组内的 tool
                if (b.type === 'tool_use') {
                    const updated = b.tools.map(t => {
                        if (t.index === event.payload.index && t.result == null) {
                            matchedToolResult = true
                            return {
                                ...t,
                                result: event.payload.result ?? event.payload.output,
                                isError: event.payload.is_error,
                            }
                        }
                        return t
                    })
                    if (updated !== b.tools) return {...b, tools: updated}
                }
                return b
            })
            blocksByRunRef.current[runKey] = next
            if (runIdRef.current === runKey) {
                setBlocks(next)
            }
            if (!matchedToolResult) {
                logger.warn('[useAiSession][tool_result_unmatched]', {
                    runId: runKey,
                    index: event.payload.index,
                    isError: event.payload.is_error,
                    blockCount: prev.length,
                    pendingToolIndexes,
                })
            }
            logger.info('[useAiSession][tool_result_state_after]', {
                runId: runKey,
                index: event.payload.index,
                matched: matchedToolResult,
                blockCount: next.length,
            })
        })

        const unlistenTurnEnd = listen<AiEventTurnEnd>('ai:turn_end', event => {
            const {session_id: sid, run_id: rid, status, node_id, usage} = event.payload
            markRunEvent('ai:turn_end', rid)
            logger.log('[useAiSession][turn_end]', {
                sessionId: sid,
                runId: rid,
                status,
                nodeId: node_id,
                usage,
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
                    logger.log('[useAiSession][queueAssistant]', {
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
                        usage,
                    })
                }

                queueMicrotask(() => {
                    const queued = [...messageQueueRef.current]
                    logger.log('[useAiSession][flushQueue]', {
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
                    setRunStreaming(rid, false)
                    if (runIdRef.current === rid) {
                        setBlocks([])
                        setTreeRefreshCounter(c => c + 1)
                    }
                })
            } else if (status.startsWith('error:')) {
                processingNodeIdByRunRef.current[rid] = null
                onErrorRef.current(`对话失败: ${status.slice(6)}`)
                queueMicrotask(() => {
                    delete blocksByRunRef.current[rid]
                    setRunStreaming(rid, false)
                    if (runIdRef.current === rid) {
                        setBlocks([])
                    }
                })
            } else if (status === 'cancelled' || status === 'interrupted') {
                processingNodeIdByRunRef.current[rid] = null
                const prev = blocksByRunRef.current[rid] ?? []
                if (prev.length > 0) {
                    // 保留已生成的部分内容，标记为非流式并提交给上层
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
                    messageQueueRef.current.push({
                        id: `a_${Date.now()}`,
                        role: 'assistant',
                        content: contentText,
                        timestamp: Date.now(),
                        reasoning: reasoningText || undefined,
                        blocks: finalBlocks,
                        sessionId: sid,
                        runId: rid,
                        // 取消的轮次没有有效的 checkpoint 节点，不设 nodeId
                    })
                }
                queueMicrotask(() => {
                    const queued = [...messageQueueRef.current]
                    messageQueueRef.current = []
                    queued.forEach(m => onMessageRef.current(m))
                    delete blocksByRunRef.current[rid]
                    setRunStreaming(rid, false)
                    if (runIdRef.current === rid) {
                        setBlocks([])
                    }
                })
            }
        })

        const unlistenError = listen<AiEventError>('ai:error', event => {
            markRunEvent('ai:error', event.payload.run_id)
            const err = toApiError(event.payload.error)
            logger.error('[useAiSession] ai:error event', {
                code: err.code,
                message: err.message,
                detail: err.detail,
                currentSessionId: sessionIdRef.current,
                currentRunId: runIdRef.current,
            })
            onErrorRef.current(`AI 错误: ${formatApiError(err)}`)
            queueMicrotask(() => {
                delete blocksByRunRef.current[event.payload.run_id]
                setRunStreaming(event.payload.run_id, false)
                if (runIdRef.current === event.payload.run_id) {
                    setBlocks([])
                }
            })
        })

        const unlistenBranchChanged = listen<AiEventBranchChanged>('ai:branch_changed', event => {
            if (event.payload.run_id === runIdRef.current) {
                setTreeRefreshCounter(c => c + 1)
            }
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
            unlistenBranchChanged.then(fn => fn())
        }
    }, [markRunEvent, scheduleTurnBeginWatchdog, setRunStreaming]) // 回调通过 ref 访问

    // 分支树刷新
    const refreshTree = useCallback(async () => {
        const sid = sessionIdRef.current
        if (!sid) return
        try {
            const nodes = await ai_get_conversation_tree(sid)
            setTreeNodes(nodes)
        } catch {
            // 树数据不可用时静默降级（不显示分支 UI）
        }
    }, [])

    useEffect(() => {
        if (treeRefreshCounter > 0) {
            refreshTree()
        }
    }, [treeRefreshCounter, refreshTree])

    // ── 操作 ─────────────────────────────────────────────────

    const createSession = useCallback(async (
        pluginId: string,
        model: string,
        /** 复用已有对话时传入其 id，避免后端创建重复记录；不传则生成新 id */
        conversationId?: string,
        maxToolRounds?: number | null,
        traceId?: string,
        settings?: StoredConversationSettings | null,
        toolAccess?: CreateSessionToolAccess,
    ): Promise<SessionIdentity | null> => {
        const newId = `session_${Date.now()}`
        try {
            const created = await ai_create_llm_session({
                sessionId: newId,
                pluginId,
                model,
                maxToolRounds: maxToolRounds ?? null,
                // 续聊时告知后端回放历史，新对话不传
                conversationId: conversationId ?? null,
                clientTraceId: traceId ?? null,
                settings: settings ?? null,
                toolAccess: toolAccess?.toolAccess ?? 'read',
                webSearchEnabled: toolAccess?.webSearchEnabled ?? false,
            })
            logger.log('[useAiSession][createSession]', {
                traceId: traceId ?? null,
                ...created,
            })
            lastUserNodeIdByRunRef.current[created.run_id] = null
            activateSession(created.session_id, created.run_id)
            return {
                sessionId: created.session_id,
                conversationId: created.conversation_id,
                runId: created.run_id,
            }
        } catch (e) {
            onErrorRef.current(`创建会话失败: ${e}`)
            return null
        }
    }, [activateSession])

    const createCharacterSession = useCallback(async (
        pluginId: string,
        model: string,
        params: {
            characterName: string
            projectSnapshot: CharacterChatProjectSnapshot
            maxToolRounds?: number | null
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
                maxToolRounds: params.maxToolRounds ?? null,
            })
            lastUserNodeIdByRunRef.current[created.run_id] = null
            activateSession(created.session_id, created.run_id)
            return {
                sessionId: created.session_id,
                conversationId: created.conversation_id,
                runId: created.run_id,
            }
        } catch (e) {
            onErrorRef.current(`创建角色会话失败: ${e}`)
            return null
        }
    }, [activateSession])

    /** 关闭会话并重置流式状态。传入 sid 可关闭非当前会话（用于删除对话）。 */
    const closeSession = useCallback(async (overrideSid?: string | null) => {
        const target = overrideSid !== undefined ? overrideSid : sessionIdRef.current
        if (target) {
            await ai_close_session(target).catch(logger.error)
        }
        const targetRunIds = Object.entries(sessionIdByRunRef.current)
            .filter(([, sid]) => sid === target)
            .map(([rid]) => rid)
        targetRunIds.forEach(clearRunState)
        if (!target || target === sessionIdRef.current) {
            activateSession(null, null)
        }
    }, [activateSession, clearRunState])

    const cancelSession = useCallback(async (overrideSid?: string | null) => {
        const target = overrideSid !== undefined ? overrideSid : sessionIdRef.current
        if (!target) return
        await ai_cancel_session(target).catch(logger.error)
    }, [])

    const sendMessage = useCallback(async (content: string, sid: string, rid: string, traceId: string) => {
        expectUserTurnByRunRef.current[rid] = true
        eventSeenAfterSendByRunRef.current[rid] = false
        traceIdByRunRef.current[rid] = traceId
        blocksByRunRef.current[rid] = []
        setRunStreaming(rid, true)
        if (runIdRef.current === rid) {
            setBlocks([])
        }
        logger.log('[useAiSession][发送链路] 准备调用后端发送消息', {
            traceId,
            sessionId: sid,
            runId: rid,
            contentLength: content.length,
            contentChars: [...content].length,
            activeSessionId: sessionIdRef.current,
            activeRunId: runIdRef.current,
        })
        window.setTimeout(() => {
            if (
                streamingByRunRef.current[rid]
                && eventSeenAfterSendByRunRef.current[rid] === false
            ) {
                logger.warn('[useAiSession][发送链路] 消息已提交后端，但 8 秒内没有收到任何 AI 事件', {
                    traceId,
                    sessionId: sid,
                    runId: rid,
                    contentLength: content.length,
                    activeSessionId: sessionIdRef.current,
                    activeRunId: runIdRef.current,
                })
            }
        }, 8000)
        try {
            await ai_send_message(sid, content, traceId)
            logger.log('[useAiSession][发送链路] 后端发送命令已返回成功', {
                traceId,
                sessionId: sid,
                runId: rid,
            })
        } catch (e) {
            const missingBackendSession = isMissingBackendSessionError(e)
            const logPayload = {
                traceId,
                sessionId: sid,
                runId: rid,
                error: e,
            }
            if (missingBackendSession) {
                logger.warn('[useAiSession][发送链路] 后端会话不存在，交由控制层重建', logPayload)
            } else {
                logger.error('[useAiSession][发送链路] 后端发送命令失败', logPayload)
            }
            delete expectUserTurnByRunRef.current[rid]
            setRunStreaming(rid, false)
            if (missingBackendSession) {
                throw e
            }
            onErrorRef.current(`发送失败: ${formatApiError(toApiError(e))}`)
        }
    }, [setRunStreaming])

    /**
     * Checkout 到指定节点（重说 / 分支 / 历史回退）。
     * - 目标节点 role 为 user → drive loop 立即继续，无需再发消息
     * - 目标节点 role 为 assistant → drive loop 继续等待用户输入
     * 返回 true 表示指令已发送。
     */
    const checkout = useCallback(async (
        nodeId: number,
        overrideSid?: string | null,
        overrideRunId?: string | null,
    ): Promise<boolean> => {
        const sid = overrideSid !== undefined ? overrideSid : sessionIdRef.current
        const rid = overrideRunId !== undefined ? overrideRunId : runIdRef.current
        if (!sid || !rid) return false
        try {
            await ai_checkout(sid, nodeId)
            expectUserTurnByRunRef.current[rid] = true
            blocksByRunRef.current[rid] = []
            setRunStreaming(rid, true)
            if (runIdRef.current === rid) {
                setBlocks([])
            }
            return true
        } catch {
            return false
        }
    }, [setRunStreaming])

    /**
     * 编辑模式专用 checkout：checkout 到 assistant 节点，让 session 等待新输入。
     * 不设 isStreaming=true，避免 UI 提前进入流式状态。
     */
    const checkoutForEdit = useCallback(async (
        nodeId: number,
        overrideSid?: string | null,
        overrideRunId?: string | null,
    ): Promise<boolean> => {
        const sid = overrideSid !== undefined ? overrideSid : sessionIdRef.current
        const rid = overrideRunId !== undefined ? overrideRunId : runIdRef.current
        if (!sid || !rid) return false
        try {
            await ai_checkout(sid, nodeId)
            expectUserTurnByRunRef.current[rid] = true
            blocksByRunRef.current[rid] = []
            if (runIdRef.current === rid) {
                setBlocks([])
            }
            return true
        } catch {
            return false
        }
    }, [])

    /** 切换插件（下一轮对话生效） */
    const switchPlugin = useCallback(async (pluginId: string) => {
        if (!sessionId) return
        await ai_switch_plugin(sessionId, pluginId).catch(logger.error)
    }, [sessionId])

    /** 运行时更新模型（立即生效） */
    const updateModel = useCallback(async (model: string) => {
        if (!sessionId) return
        await ai_update_session(sessionId, {model}).catch(logger.error)
    }, [sessionId])

    // ── 分支导航 ─────────────────────────────────────────────

    // 从 treeNodes 计算每个节点的 branchIndex/branchTotal
    useEffect(() => {
        if (treeNodes.length === 0) {
            branchInfoRef.current = new Map()
            return
        }
        const children = new Map<number, number[]>()
        for (const n of treeNodes) {
            if (n.parent !== null) {
                const list = children.get(n.parent) ?? []
                list.push(n.id)
                children.set(n.parent, list)
            }
        }
        const info = new Map<number, {branchIndex: number; branchTotal: number; siblings: number[]}>()
        for (const [, siblingList] of children) {
            if (siblingList.length > 1) {
                siblingList.forEach((nodeId, index) => {
                    info.set(nodeId, {
                        branchIndex: index + 1,
                        branchTotal: siblingList.length,
                        siblings: siblingList,
                    })
                })
            }
        }
        branchInfoRef.current = info
    }, [treeNodes])

    const getBranchInfo = useCallback((nodeId: number) => {
        const info = branchInfoRef.current.get(nodeId)
        return info ? {branchIndex: info.branchIndex, branchTotal: info.branchTotal} : null
    }, [])

    const switchBranch = useCallback(async (nodeId: number, direction: 'prev' | 'next'): Promise<boolean> => {
        const info = branchInfoRef.current.get(nodeId)
        if (!info) return false
        const currentIdx = info.branchIndex - 1
        const targetIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1
        if (targetIdx < 0 || targetIdx >= info.siblings.length) return false
        const targetNodeId = info.siblings[targetIdx]
        const sid = sessionIdRef.current
        if (!sid) return false
        try {
            // 纯导航 checkout：只移动 head，不触发流式生成
            await ai_checkout(sid, targetNodeId)
            setBranchSwitchVersion(v => v + 1)
            return true
        } catch {
            return false
        }
    }, [])

    const isStreaming = runId ? Boolean(streamingByRun[runId]) : false
    const isRunStreaming = (targetRunId?: string | null) => (
        targetRunId ? Boolean(streamingByRunRef.current[targetRunId]) : false
    )

    return {
        sessionId,
        runId,
        isStreaming,
        streamingByRun,
        blocks,
        /** 当前用户轮次的起始节点 ID（用于 checkout / 重说），state 版本供 effect 依赖 */
        lastUserNodeId,
        lastUserNodeIdRef,
        createSession,
        createCharacterSession,
        activateSession,
        closeSession,
        cancelSession,
        isRunStreaming,
        sendMessage,
        checkout,
        checkoutForEdit,
        switchPlugin,
        updateModel,
        getBranchInfo,
        switchBranch,
        treeNodes,
        branchSwitchVersion,
    }
}
