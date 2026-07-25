/**
 * AI 对话的轻量状态判断。
 *
 * `conv_` 前缀表示尚未写入历史的前端对话；普通空对话只作为编辑态存在，
 * 角色与报告对话即使尚未落盘，也仍需保留在对话列表中。
 */
import type {Conversation} from './AiControllerTypes.ts'

export const isPendingConversationId = (id: string) => id.startsWith('conv_')

export const isEmptyDraftConversation = (conversation: Conversation) =>
    isPendingConversationId(conversation.id)
    && conversation.messages.length === 0
    && (!conversation.mode || conversation.mode === 'default')

export const toConversationHistory = (conversations: Conversation[]) =>
    conversations.filter((conversation) => !isEmptyDraftConversation(conversation))
