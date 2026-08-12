import type {EntryTag} from '../../../api'

export const CHARACTER_VOICE_PLUGIN_ID_TAG = 'fc_role_voice_plugin_id'
export const CHARACTER_VOICE_MODEL_TAG = 'fc_role_voice_model'
export const CHARACTER_VOICE_ID_TAG = 'fc_role_voice_id'
export const CHARACTER_VOICE_AUTO_PLAY_TAG = 'fc_role_voice_auto_play'

export const CHARACTER_VOICE_PLUGIN_ID_TAG_ID = 'c64f7bf6-737d-4c4d-9ad9-97f12b7bac01'
export const CHARACTER_VOICE_MODEL_TAG_ID = 'c64f7bf6-737d-4c4d-9ad9-97f12b7bac02'
export const CHARACTER_VOICE_ID_TAG_ID = 'c64f7bf6-737d-4c4d-9ad9-97f12b7bac03'
export const CHARACTER_VOICE_AUTO_PLAY_TAG_ID = 'c64f7bf6-737d-4c4d-9ad9-97f12b7bac04'

export interface CharacterVoiceConfig {
    pluginId: string | null
    model: string | null
    voiceId: string | null
    autoPlay: boolean | null
}

interface CharacterVoiceTagDefinition {
    name: string
    id: string
}

export const CHARACTER_VOICE_TAG_DEFINITIONS: CharacterVoiceTagDefinition[] = [
    {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
    {name: CHARACTER_VOICE_MODEL_TAG, id: CHARACTER_VOICE_MODEL_TAG_ID},
    {name: CHARACTER_VOICE_ID_TAG, id: CHARACTER_VOICE_ID_TAG_ID},
    {name: CHARACTER_VOICE_AUTO_PLAY_TAG, id: CHARACTER_VOICE_AUTO_PLAY_TAG_ID},
]

function normalizeTagValue(value: EntryTag['value'] | undefined): string | number | boolean | null {
    if (value == null) return null
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'object' && value !== null && 'value' in value) {
        return normalizeTagValue((value as { value?: EntryTag['value'] }).value ?? null)
    }
    return null
}

export function readCharacterVoiceConfigFromTags(tags?: EntryTag[] | null): CharacterVoiceConfig {
    const findTag = (name: string, id: string) => (tags ?? []).find(
        (tag) => tag.schema_id === id || tag.name === name,
    )
    const pluginValue = normalizeTagValue(findTag(CHARACTER_VOICE_PLUGIN_ID_TAG, CHARACTER_VOICE_PLUGIN_ID_TAG_ID)?.value)
    const modelValue = normalizeTagValue(findTag(CHARACTER_VOICE_MODEL_TAG, CHARACTER_VOICE_MODEL_TAG_ID)?.value)
    const voiceTag = findTag(CHARACTER_VOICE_ID_TAG, CHARACTER_VOICE_ID_TAG_ID)
    const autoPlayTag = findTag(CHARACTER_VOICE_AUTO_PLAY_TAG, CHARACTER_VOICE_AUTO_PLAY_TAG_ID)
    const voiceValue = normalizeTagValue(voiceTag?.value)
    const autoPlayValue = normalizeTagValue(autoPlayTag?.value)

    return {
        pluginId: typeof pluginValue === 'string' ? pluginValue : null,
        model: typeof modelValue === 'string' ? modelValue : null,
        voiceId: typeof voiceValue === 'string' ? voiceValue : null,
        autoPlay: typeof autoPlayValue === 'boolean' ? autoPlayValue : null,
    }
}

export function readCharacterVoiceConfigFromDraftTags(
    tags: Record<string, string | number | boolean | null>,
    tagSchemas: Array<{id: string; name: string}> = [],
): CharacterVoiceConfig {
    const readValue = (name: string, id: string) => {
        const legacySchemaId = tagSchemas.find((schema) => schema.name === name)?.id
        return tags[id] ?? tags[name] ?? (legacySchemaId ? tags[legacySchemaId] : null)
    }
    const pluginValue = readValue(CHARACTER_VOICE_PLUGIN_ID_TAG, CHARACTER_VOICE_PLUGIN_ID_TAG_ID)
    const modelValue = readValue(CHARACTER_VOICE_MODEL_TAG, CHARACTER_VOICE_MODEL_TAG_ID)
    const voiceValue = readValue(CHARACTER_VOICE_ID_TAG, CHARACTER_VOICE_ID_TAG_ID)
    const autoPlayValue = readValue(CHARACTER_VOICE_AUTO_PLAY_TAG, CHARACTER_VOICE_AUTO_PLAY_TAG_ID)
    return {
        pluginId: typeof pluginValue === 'string' && pluginValue.trim() ? pluginValue.trim() : null,
        model: typeof modelValue === 'string' && modelValue.trim() ? modelValue.trim() : null,
        voiceId: typeof voiceValue === 'string' && voiceValue.trim() ? voiceValue.trim() : null,
        autoPlay: typeof autoPlayValue === 'boolean' ? autoPlayValue : null,
    }
}

export function writeCharacterVoiceDraftTag(
    tags: Record<string, string | number | boolean | null>,
    tagSchemas: Array<{id: string; name: string}>,
    definition: CharacterVoiceTagDefinition,
    value: string | boolean | null,
) {
    const next = {...tags}
    const legacySchemaId = tagSchemas.find((schema) => schema.name === definition.name)?.id
    delete next[definition.name]
    tagSchemas
        .filter((schema) => schema.name === definition.name)
        .forEach((schema) => delete next[schema.id])
    if (value == null || (typeof value === 'string' && !value.trim())) {
        delete next[definition.id]
    } else {
        next[legacySchemaId ?? definition.id] = typeof value === 'string' ? value.trim() : value
    }
    return next
}
