import {useSyncExternalStore} from 'react'
import {
    ai_list_plugins,
    setting_get_settings,
    type AppSettings,
    type PluginInfo,
} from '../../../api'

interface AiPluginSnapshot {
    plugins: PluginInfo[]
    pluginsReady: boolean
    selectedPlugin: string
    selectedModel: string
    writerModeAvailable: boolean
    version: number
}

interface AiPluginRefreshOptions {
    preferredPluginId?: string | null
    preferredModel?: string | null
}

const listeners = new Set<() => void>()

let snapshot: AiPluginSnapshot = {
    plugins: [],
    pluginsReady: false,
    selectedPlugin: '',
    selectedModel: '',
    writerModeAvailable: false,
    version: 0,
}

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function setSnapshot(patch: Partial<Omit<AiPluginSnapshot, 'version'>>) {
    snapshot = {
        ...snapshot,
        ...patch,
        version: snapshot.version + 1,
    }
    emit()
}

function subscribeAiPluginStore(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getAiPluginSnapshot() {
    return snapshot
}

function resolvePluginSelection(
    pluginList: PluginInfo[],
    settings: AppSettings | null,
    options: AiPluginRefreshOptions = {},
) {
    const preferredPluginId = options.preferredPluginId
        || snapshot.selectedPlugin
        || settings?.llm?.plugin_id
        || ''
    const nextPlugin = pluginList.find((plugin) => plugin.id === preferredPluginId)
        ?? pluginList[0]
        ?? null
    const nextPluginId = nextPlugin?.id ?? ''

    if (!nextPlugin) {
        return {selectedPlugin: '', selectedModel: ''}
    }

    const preferredModel = options.preferredModel
        || snapshot.selectedModel
        || settings?.llm?.default_model
        || ''
    const nextModel = preferredModel && nextPlugin.models.includes(preferredModel)
        ? preferredModel
        : (nextPlugin.default_model ?? nextPlugin.models[0] ?? '')

    return {selectedPlugin: nextPluginId, selectedModel: nextModel}
}

function syncAiPluginSelection(
    pluginList: PluginInfo[],
    settings: AppSettings | null,
    options: AiPluginRefreshOptions = {},
) {
    setSnapshot({
        plugins: pluginList,
        pluginsReady: true,
        writerModeAvailable: Boolean(settings?.llm?.writer_mode_enabled),
        ...resolvePluginSelection(pluginList, settings, options),
    })
}

export async function refreshAiPluginStore(options: AiPluginRefreshOptions = {}) {
    const [pluginList, settings] = await Promise.all([
        ai_list_plugins('llm'),
        setting_get_settings().catch(() => null),
    ])

    syncAiPluginSelection(pluginList, settings, options)
    return {plugins: pluginList, settings}
}

export function setAiSelectedPlugin(pluginId: string) {
    const plugin = snapshot.plugins.find((item) => item.id === pluginId)
    const selectedModel = plugin && plugin.models.includes(snapshot.selectedModel)
        ? snapshot.selectedModel
        : (plugin?.default_model ?? plugin?.models[0] ?? '')
    setSnapshot({selectedPlugin: pluginId, selectedModel})
}

export function setAiSelectedModel(model: string) {
    setSnapshot({selectedModel: model})
}

export function setAiSelectedPluginModel(pluginId: string, model: string) {
    const plugin = snapshot.plugins.find((item) => item.id === pluginId)
    if (!plugin) {
        setSnapshot({selectedPlugin: pluginId, selectedModel: model})
        return
    }
    const selectedModel = model && plugin.models.includes(model)
        ? model
        : (plugin.default_model ?? plugin.models[0] ?? '')
    setSnapshot({selectedPlugin: pluginId, selectedModel})
}

export function setAiWriterModeAvailable(writerModeAvailable: boolean) {
    setSnapshot({writerModeAvailable})
}

export function useAiPluginStore() {
    return useSyncExternalStore(
        subscribeAiPluginStore,
        getAiPluginSnapshot,
        getAiPluginSnapshot,
    )
}
