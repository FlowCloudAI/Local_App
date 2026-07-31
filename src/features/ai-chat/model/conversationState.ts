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

export const hasMessageOutput = (message: Message) => Boolean(
    message.content.trim() || message.reasoning?.trim() || message.blocks?.length,
)

export const isIncompleteMessage = (message: Message) => hasMessageOutput(message) && (
    message.finishReason === 'length'
    || message.turnStatus === 'cancelled'
    || message.turnStatus === 'interrupted'
    || message.turnStatus === 'error'
)

/** 将独立保存的续写节点合并到原气泡，同时把 checkpoint 推进到最新尾节点。 */
export const appendOrMergeContinuation = (messages: Message[], incoming: Message): Message[] => {
    if (incoming.continuationOfNodeId == null) return [...messages, incoming]
    const targetIndex = messages.findIndex(message => message.nodeId === incoming.continuationOfNodeId)
    if (targetIndex === -1) return [...messages, incoming]

    const target = messages[targetIndex]
    const next = [...messages]
    next[targetIndex] = {
        ...target,
        content: target.content + incoming.content,
        reasoning: `${target.reasoning ?? ''}${incoming.reasoning ?? ''}` || undefined,
        blocks: [...(target.blocks ?? []), ...(incoming.blocks ?? [])],
        timestamp: incoming.timestamp,
        nodeId: incoming.nodeId ?? target.nodeId,
        usage: incoming.usage,
        error: incoming.error,
        turnStatus: incoming.turnStatus,
        finishReason: incoming.finishReason,
        continuationOfNodeId: incoming.continuationOfNodeId,
    }
    return next
}
