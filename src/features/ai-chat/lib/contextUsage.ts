/**
 * AI 上下文用量的前端估算适配层。
 *
 * 字符分类、消息固定开销和校准边界与 core_ai_client 保持一致；供应商真实 usage 仍优先。
 */
import type {Message} from '../model/AiControllerTypes'

const CJK_CHARS_PER_TOKEN = 1.5
const OTHER_CHARS_PER_TOKEN = 3.8
const MESSAGE_OVERHEAD_TOKENS = 4
const MIN_CALIBRATION_FACTOR = 0.5
const MAX_CALIBRATION_FACTOR = 2

type EstimatableMessage = Pick<Message, 'content'> & Partial<Pick<Message, 'reasoning' | 'blocks'>>

function normalizeCalibrationFactor(factor?: number | null): number {
    return typeof factor === 'number' && Number.isFinite(factor)
        ? Math.min(MAX_CALIBRATION_FACTOR, Math.max(MIN_CALIBRATION_FACTOR, factor))
        : 1
}

function isCjk(codePoint: number): boolean {
    return (codePoint >= 0x3000 && codePoint <= 0x303f)
        || (codePoint >= 0x3040 && codePoint <= 0x30ff)
        || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
        || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
        || (codePoint >= 0xac00 && codePoint <= 0xd7af)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xff00 && codePoint <= 0xffef)
        || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
}

function estimateBaseTextTokens(text?: string | null): number {
    if (!text?.trim()) return 0
    let cjk = 0
    let other = 0
    for (const char of text) {
        if (isCjk(char.codePointAt(0) ?? 0)) cjk += 1
        else other += 1
    }
    return Math.ceil(cjk / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN)
}

function estimateToolBlocksTokens(blocks: EstimatableMessage['blocks']): number {
    if (!blocks) return 0
    return blocks.reduce((total, block) => {
        if (block.type !== 'tool' && block.type !== 'tool_use') return total
        try {
            return total + estimateBaseTextTokens(JSON.stringify(block))
        } catch {
            return total
        }
    }, 0)
}

export function tokenCalibrationKey(pluginId?: string | null, model?: string | null): string | null {
    return pluginId && model ? `${pluginId}:${model}` : null
}

export function resolveTokenCalibrationFactor(
    factors: Record<string, number> | null | undefined,
    pluginId?: string | null,
    model?: string | null,
): number {
    const key = tokenCalibrationKey(pluginId, model)
    return normalizeCalibrationFactor(key ? factors?.[key] : null)
}

export function estimateTextTokens(text?: string | null, factor = 1): number {
    return Math.ceil(estimateBaseTextTokens(text) * normalizeCalibrationFactor(factor))
}

export function estimateMessagesTokens(messages: EstimatableMessage[], factor = 1): number {
    const baseEstimate = messages.reduce((total, message) => total
        + MESSAGE_OVERHEAD_TOKENS
        + estimateBaseTextTokens(message.content)
        + estimateBaseTextTokens(message.reasoning)
        + estimateToolBlocksTokens(message.blocks), 0)
    return Math.ceil(baseEstimate * normalizeCalibrationFactor(factor))
}

export function tokensToConservativeCharBudget(tokens: number, factor = 1): number {
    return Math.max(0, Math.floor(tokens * CJK_CHARS_PER_TOKEN / normalizeCalibrationFactor(factor)))
}

export function formatTokenCount(tokens: number): string {
    return Math.max(0, Math.round(tokens)).toLocaleString('zh-CN')
}
