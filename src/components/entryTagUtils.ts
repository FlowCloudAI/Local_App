import {type EntryTag, type TagSchema} from '../api'

export type EntryTagRuntimeValue = string | number | boolean | null

function normalizeEntryType(entryType?: string | null): string | null {
    if (typeof entryType !== 'string') return null
    const trimmed = entryType.trim()
    return trimmed || null
}

function hasSchemaTagKey(
    tags: Record<string, EntryTagRuntimeValue>,
    schema: TagSchema,
): boolean {
    return Object.prototype.hasOwnProperty.call(tags, schema.id)
        || Object.prototype.hasOwnProperty.call(tags, schema.name)
}

export function normalizeTagTargets(target?: TagSchema['target'] | string | null): string[] {
    if (Array.isArray(target)) {
        return [...new Set(target.map(item => item.trim()).filter(Boolean))]
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
    const normalizedType = normalizeEntryType(entryType)
    if (!normalizedType) {
        console.log('[entryTagUtils] 未设置词条类型，跳过 target 匹配', {
            schemaId: schema.id,
            schemaName: schema.name,
            schemaTarget: schema.target,
        })
        return false
    }
    const normalizedTargets = normalizeTagTargets(schema.target)
    const matched = normalizedTargets.includes(normalizedType)
    console.log('[entryTagUtils] target 匹配结果', {
        schemaId: schema.id,
        schemaName: schema.name,
        normalizedType,
        normalizedTargets,
        matched,
    })
    return matched
}

export function normalizeEntryTagValue(value: unknown): EntryTagRuntimeValue {
    if (value == null) return null
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'boolean') return value
    if (Array.isArray(value)) return null

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        return normalizeEntryTagValue(record.value)
    }

    return null
}

function getSchemaDefaultValue(schema: TagSchema): EntryTagRuntimeValue {
    const raw = typeof schema.default_val === 'string' ? schema.default_val.trim() : ''
    if (!raw) return null

    if (schema.type === 'number') {
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : null
    }

    if (schema.type === 'boolean') {
        const lowered = raw.toLowerCase()
        if (lowered === 'true') return true
        if (lowered === 'false') return false
        return null
    }

    return raw
}

export function ensureTypeTargetTagValues(
    tags: Record<string, EntryTagRuntimeValue>,
    tagSchemas: TagSchema[],
    entryType?: string | null,
): {
    tags: Record<string, EntryTagRuntimeValue>
    addedSchemaIds: string[]
} {
    const targetSchemas = tagSchemas.filter(schema => isSchemaImplantedForType(schema, entryType))
    console.log('[entryTagUtils] 开始补齐类型目标标签', {
        entryType,
        existingTagKeys: Object.keys(tags),
        targetSchemaIds: targetSchemas.map(schema => schema.id),
        targetSchemaNames: targetSchemas.map(schema => schema.name),
    })
    if (targetSchemas.length === 0) {
        return {
            tags,
            addedSchemaIds: [],
        }
    }

    let nextTags = tags
    const addedSchemaIds: string[] = []

    targetSchemas.forEach(schema => {
        if (hasSchemaTagKey(nextTags, schema)) {
            console.log('[entryTagUtils] 标签已存在，跳过自动补齐', {
                schemaId: schema.id,
                schemaName: schema.name,
            })
            return
        }
        if (nextTags === tags) {
            nextTags = {...tags}
        }
        nextTags[schema.id] = getSchemaDefaultValue(schema)
        addedSchemaIds.push(schema.id)
        console.log('[entryTagUtils] 自动补齐标签', {
            schemaId: schema.id,
            schemaName: schema.name,
            defaultValue: nextTags[schema.id],
        })
    })

    console.log('[entryTagUtils] 类型目标标签补齐完成', {
        entryType,
        addedSchemaIds,
        nextTags,
    })
    return {
        tags: nextTags,
        addedSchemaIds,
    }
}

export function buildAutoVisibleTagSchemaIds(
    tagSchemas: TagSchema[],
    draftTags: Record<string, EntryTagRuntimeValue>,
    entryType?: string | null,
): string[] {
    return tagSchemas.flatMap(schema => {
        const value = normalizeEntryTagValue(draftTags[schema.id] ?? draftTags[schema.name] ?? null)
        if (value === null && !isSchemaImplantedForType(schema, entryType)) return []
        return [schema.id]
    })
}

export function buildEntryTagsPayload(
    draftTags: Record<string, EntryTagRuntimeValue>,
    tagSchemas: TagSchema[],
    originalTags?: EntryTag[] | null,
): EntryTag[] | null {
    const schemaIds = new Set(tagSchemas.map(schema => schema.id))
    const preservedExtras = (originalTags ?? []).filter(tag => !tag.schema_id || !schemaIds.has(tag.schema_id))
    const schemaTags = tagSchemas.flatMap(schema => {
        const hasKey = hasSchemaTagKey(draftTags, schema)
        const value = normalizeEntryTagValue(draftTags[schema.id] ?? draftTags[schema.name] ?? null)
        if (!hasKey && value === null) return []
        return [{
            schema_id: schema.id,
            value,
        }]
    })
    const merged = [...preservedExtras, ...schemaTags]
    console.log('[entryTagUtils] 生成词条标签 payload', {
        draftTags,
        schemaTagCount: schemaTags.length,
        preservedExtraCount: preservedExtras.length,
        merged,
    })
    return merged.length ? merged : null
}
