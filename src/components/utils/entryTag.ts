import type {TagSchema} from '../../api'

export function normalizeTagRuntimeValue(value: unknown): string | number | boolean | null {
    if (value == null) return null
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value
    }
    if (Array.isArray(value)) return null

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean') {
            return record.value
        }
    }

    return null
}

export function normalizeComparableTagValue(value: unknown): string | number | boolean | null {
    const normalized = normalizeTagRuntimeValue(value)
    if (typeof normalized === 'string') {
        const trimmed = normalized.trim()
        return trimmed ? trimmed : null
    }
    return normalized
}

export function getComparableTagValue(
    tags: Record<string, string | number | boolean | null>,
    schema: TagSchema,
): string | number | boolean | null {
    return normalizeComparableTagValue(tags[schema.id] ?? tags[schema.name] ?? null)
}

export function areTagMapsEqual(
    left: Record<string, string | number | boolean | null>,
    right: Record<string, string | number | boolean | null>,
    schemas: TagSchema[],
): boolean {
    for (const schema of schemas) {
        if (getComparableTagValue(left, schema) !== getComparableTagValue(right, schema)) return false
    }
    return true
}

export function mergeUniqueStringValues(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))]
}

export function normalizeTagTargets(target?: TagSchema['target'] | string | null): string[] {
    if (Array.isArray(target)) {
        return [...new Set(target.map((item) => item.trim()).filter(Boolean))]
    }

    if (typeof target !== 'string') return []

    const trimmed = target.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
            return [...new Set(parsed.map((item: unknown) => String(item).trim()).filter(Boolean))]
        }
        if (typeof parsed === 'string') {
            const parsedValue = parsed.trim()
            return parsedValue ? [parsedValue] : []
        }
    } catch {
        // 兼容历史上可能直接存成逗号分隔字符串的情况
    }

    return [...new Set(trimmed.split(',').map((item: string) => item.trim()).filter(Boolean))]
}

export function isSchemaImplantedForType(schema: TagSchema, entryType?: string | null): boolean {
    const normalizedType = entryType?.trim() || null
    if (!normalizedType) return false
    return normalizeTagTargets(schema.target).includes(normalizedType)
}

export function buildAutoVisibleTagSchemaIds(
    tagSchemas: TagSchema[],
    draftTags: Record<string, string | number | boolean | null>,
    entryType?: string | null,
): string[] {
    return tagSchemas.flatMap((schema) => {
        const hasValue = getComparableTagValue(draftTags, schema) !== null
        if (!hasValue && !isSchemaImplantedForType(schema, entryType)) return []
        return [schema.id]
    })
}
