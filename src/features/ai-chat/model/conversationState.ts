/**
 * AI 对话的轻量状态判断。
 *
 * `conv_` 前缀表示尚未写入历史的前端对话；普通空对话只作为编辑态存在，
 * 角色与报告对话即使尚未落盘，也仍需保留在对话列表中。
 */
import type {Conversation, Message} from './AiControllerTypes.ts'

export const isPendingConversationId = (id: string) => id.startsWith('conv_')

export const isEmptyDraftConversation = (conversation: Conversation) =>
    isPendingConversationId(conversation.id)
    && conversation.messages.length === 0
    && (!conversation.mode || conversation.mode === 'default')

export const toConversationHistory = (conversations: Conversation[]) =>
    conversations.filter((conversation) => !isEmptyDraftConversation(conversation))

/** 切换模型后旧运行时会话不可复用，但对话内容与设置必须保留。 */
export const applyConversationModelSwitch = (
    conversation: Conversation,
    conversationId: string,
    pluginId: string,
    model: string,
): Conversation => conversation.id !== conversationId
    ? conversation
    : {...conversation, pluginId, model, sessionId: null, runId: null}

export const hasMessageOutput = (message: Message) => Boolean(
    message.content.trim() || message.reasoning?.trim() || message.blocks?.length,
)

export const isIncompleteMessage = (message: Message) => hasMessageOutput(message) && (
    message.finishReason === 'length'
    || message.turnStatus === 'cancelled'
    || message.turnStatus === 'interrupted'
    || message.turnStatus === 'error'
)

type TurnOutcome = Pick<
    Message,
    'turnStatus' | 'finishReason' | 'continuationOfNodeId' | 'error'
>

/** 结果字段属于节点而非气泡；即使末节点缺字段，也必须覆盖前一段的旧值。 */
export const applyLatestTurnOutcome = (message: Message, outcome: TurnOutcome): Message => ({
    ...message,
    turnStatus: outcome.turnStatus,
    finishReason: outcome.finishReason,
    continuationOfNodeId: outcome.continuationOfNodeId,
    error: outcome.error,
})

const mergeContinuationUsage = (
    current: Message['usage'],
    incoming: Message['usage'],
): Message['usage'] => {
    if (!incoming) return current
    if (!current) return incoming
    return {
        prompt_tokens: current.prompt_tokens + incoming.prompt_tokens,
        completion_tokens: current.completion_tokens + incoming.completion_tokens,
        total_tokens: current.total_tokens + incoming.total_tokens,
    }
}

/** 将独立保存的续写节点合并到原气泡，同时把 checkpoint 推进到最新尾节点。 */
export const appendOrMergeContinuation = (messages: Message[], incoming: Message): Message[] => {
    if (incoming.continuationOfNodeId == null) return [...messages, incoming]
    const targetIndex = messages.findIndex(message => message.nodeId === incoming.continuationOfNodeId)
    if (targetIndex === -1) return [...messages, incoming]

    const target = messages[targetIndex]
    const next = [...messages]
    next[targetIndex] = applyLatestTurnOutcome({
        ...target,
        content: target.content + incoming.content,
        reasoning: `${target.reasoning ?? ''}${incoming.reasoning ?? ''}` || undefined,
        blocks: [...(target.blocks ?? []), ...(incoming.blocks ?? [])],
        timestamp: incoming.timestamp,
        nodeId: incoming.nodeId ?? target.nodeId,
        usage: mergeContinuationUsage(target.usage, incoming.usage),
    }, incoming)
    return next
}
