/**
 * 解析数字标签编辑态文本，区分清空、合法数值与尚未完成的输入。
 */
export function resolveEditableNumberTagValue(raw: string): number | null | undefined {
    const normalized = raw.trim()
    if (!normalized) return null

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
}
