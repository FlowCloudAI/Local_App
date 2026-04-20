import type {PluginInfo} from '../../api'

export interface TtsVoiceOption {
    value: string
    label: string
}

export function resolvePreferredTtsPlugin(
    plugins: PluginInfo[],
    configuredPluginId?: string | null,
): PluginInfo | null {
    if (plugins.length === 0) return null
    if (configuredPluginId) {
        return plugins.find((plugin) => plugin.id === configuredPluginId) ?? null
    }
    return plugins[0] ?? null
}

export function normalizeVoiceIdWithPlugin(
    plugin: PluginInfo | null,
    voiceId?: string | null,
): string | null {
    const trimmedVoiceId = voiceId?.trim()
    if (!trimmedVoiceId) return null
    if (!plugin || plugin.supported_voices.length === 0) {
        return trimmedVoiceId
    }
    return plugin.supported_voices.includes(trimmedVoiceId) ? trimmedVoiceId : null
}

export function resolveVoiceIdWithPlugin(
    plugin: PluginInfo | null,
    candidates: Array<string | null | undefined>,
    fallbackVoiceId: string,
): string {
    for (const candidate of candidates) {
        const normalized = normalizeVoiceIdWithPlugin(plugin, candidate)
        if (normalized) return normalized
    }
    if (plugin && plugin.supported_voices.length > 0) {
        return plugin.supported_voices[0]
    }
    return fallbackVoiceId
}

export function buildTtsVoiceOptions(
    plugin: PluginInfo | null,
    emptyLabel = '跟随默认设置',
): TtsVoiceOption[] {
    if (!plugin) {
        return [{value: '', label: '请先选择语音插件'}]
    }
    if (plugin.supported_voices.length === 0) {
        return [{value: '', label: '该插件未声明可用音色'}]
    }
    return [
        {value: '', label: emptyLabel},
        ...plugin.supported_voices.map((voiceId) => ({
            value: voiceId,
            label: voiceId,
        })),
    ]
}
