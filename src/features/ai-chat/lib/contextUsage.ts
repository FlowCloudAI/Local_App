import type {Message} from '../model/AiControllerTypes'

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 2

export function estimateTextTokens(text?: string | null): number {
    const trimmed = text?.trim()
    if (!trimmed) return 0
    return Math.ceil([...trimmed].length / TOKEN_ESTIMATE_CHARS_PER_TOKEN)
}

export function estimateMessagesTokens(messages: Array<Pick<Message, 'content'>>): number {
    return messages.reduce((total, message) => total + estimateTextTokens(message.content), 0)
}

export function formatTokenCount(tokens: number): string {
    return Math.max(0, Math.round(tokens)).toLocaleString('zh-CN')
}
