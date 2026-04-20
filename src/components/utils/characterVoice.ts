import type {EntryTag} from '../../api'

export const CHARACTER_VOICE_ID_TAG = 'fc_role_voice_id'
export const CHARACTER_VOICE_AUTO_PLAY_TAG = 'fc_role_voice_auto_play'

export interface CharacterVoiceConfig {
    voiceId: string | null
    autoPlay: boolean | null
}

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
    const voiceTag = (tags ?? []).find((tag) => tag.name === CHARACTER_VOICE_ID_TAG)
    const autoPlayTag = (tags ?? []).find((tag) => tag.name === CHARACTER_VOICE_AUTO_PLAY_TAG)
    const voiceValue = normalizeTagValue(voiceTag?.value)
    const autoPlayValue = normalizeTagValue(autoPlayTag?.value)

    return {
        voiceId: typeof voiceValue === 'string' ? voiceValue : null,
        autoPlay: typeof autoPlayValue === 'boolean' ? autoPlayValue : null,
    }
}

export function readCharacterVoiceConfigFromDraftTags(
    tags: Record<string, string | number | boolean | null>,
): CharacterVoiceConfig {
    const voiceValue = tags[CHARACTER_VOICE_ID_TAG]
    const autoPlayValue = tags[CHARACTER_VOICE_AUTO_PLAY_TAG]
    return {
        voiceId: typeof voiceValue === 'string' && voiceValue.trim() ? voiceValue.trim() : null,
        autoPlay: typeof autoPlayValue === 'boolean' ? autoPlayValue : null,
    }
}
