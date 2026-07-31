/**
 * AI 上下文用量的前端估算适配层。
 *
 * 消息只在这里转换为 IPC 结构，字符分类、消息开销和校准边界由 core_ai_client 计算。
 */
import {ai_estimate_tokens} from '../../../api/ai_client'
import type {Message} from '../model/AiControllerTypes'

const CJK_CHARS_PER_TOKEN = 1.5
const MIN_CALIBRATION_FACTOR = 0.5
const MAX_CALIBRATION_FACTOR = 2

type EstimatableMessage = Pick<Message, 'content'> & Partial<Pick<Message, 'reasoning' | 'blocks'>>

function normalizeCalibrationFactor(factor?: number | null): number {
    return typeof factor === 'number' && Number.isFinite(factor)
        ? Math.min(MAX_CALIBRATION_FACTOR, Math.max(MIN_CALIBRATION_FACTOR, factor))
        : 1
}

function serializeToolBlocks(blocks: EstimatableMessage['blocks']): string[] {
    if (!blocks) return []
    return blocks.flatMap(block => {
        if (block.type !== 'tool' && block.type !== 'tool_use') return []
        try {
            return [JSON.stringify(block)]
        } catch {
            return []
        }
    })
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

export function estimateMessagesTokens(messages: EstimatableMessage[], factor = 1): Promise<number> {
    return ai_estimate_tokens({
        messages: messages.map(message => ({
            content: message.content || null,
            reasoning_content: message.reasoning || null,
            tool_payloads: serializeToolBlocks(message.blocks),
        })),
        calibration_factor: normalizeCalibrationFactor(factor),
    })
}

export function tokensToConservativeCharBudget(tokens: number, factor = 1): number {
    return Math.max(0, Math.floor(tokens * CJK_CHARS_PER_TOKEN / normalizeCalibrationFactor(factor)))
}

export function formatTokenCount(tokens: number): string {
    return Math.max(0, Math.round(tokens)).toLocaleString('zh-CN')
}
