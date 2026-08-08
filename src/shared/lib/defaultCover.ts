/**
 * 默认封面的稳定身份规则：只从实体 ID 与标题派生视觉变体，不依赖主题或运行时状态。
 * 项目封面与词条封面共用有效首字符提取，避免标点开头的标题显示成“《”等符号。
 */

const DEFAULT_COVER_PALETTE_COUNT = 8
const DEFAULT_COVER_COMPOSITION_COUNT = 4

export interface DefaultCoverTheme {
    palette: number
    composition: number
}

function fnv1a(value: string): number {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

export function getDefaultCoverTheme(id: string): DefaultCoverTheme {
    const hash = fnv1a(id)
    return {
        palette: hash % DEFAULT_COVER_PALETTE_COUNT,
        composition: (hash >>> 8) % DEFAULT_COVER_COMPOSITION_COUNT,
    }
}

export function getMeaningfulCoverMark(
    title: string | null | undefined,
    fallback = '词',
): string {
    const mark = title?.match(/[\p{L}\p{N}]/u)?.[0]
    if (!mark) return fallback
    return /[a-z]/.test(mark) ? mark.toUpperCase() : mark
}
