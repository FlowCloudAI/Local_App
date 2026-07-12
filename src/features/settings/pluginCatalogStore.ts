import {useSyncExternalStore} from 'react'
import {
    ai_close_all_sessions,
    plugin_install_from_file,
    plugin_list_local,
    plugin_market_install,
    plugin_market_list,
    plugin_uninstall,
    type LocalPluginInfo,
    type RemotePluginInfo,
} from '../../api'
import {refreshAiPluginStore} from '../ai-chat/stores/aiPluginStore'
import {refreshAppSettings} from './appSettingsStore'

interface PluginCatalogSnapshot {
    localPlugins: LocalPluginInfo[]
    marketPlugins: RemotePluginInfo[]
    loadingLocal: boolean
    loadingMarket: boolean
    localError: string | null
    marketError: string | null
    installingLocalFile: boolean
    installingIds: Set<string>
    uninstallingId: string | null
    version: number
}

const listeners = new Set<() => void>()
let snapshot: PluginCatalogSnapshot = {
    localPlugins: [],
    marketPlugins: [],
    loadingLocal: false,
    loadingMarket: false,
    localError: null,
    marketError: null,
    installingLocalFile: false,
    installingIds: new Set(),
    uninstallingId: null,
    version: 0,
}
let localLoad: Promise<LocalPluginInfo[]> | null = null
let marketLoad: Promise<RemotePluginInfo[]> | null = null

function emit() {
    for (const listener of listeners) listener()
}

function setSnapshot(patch: Partial<Omit<PluginCatalogSnapshot, 'version'>>) {
    snapshot = {...snapshot, ...patch, version: snapshot.version + 1}
    emit()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getSnapshot() {
    return snapshot
}

export function refreshLocalPlugins() {
    if (localLoad) return localLoad
    setSnapshot({loadingLocal: true, localError: null})
    localLoad = plugin_list_local()
        .then(localPlugins => {
            setSnapshot({localPlugins, loadingLocal: false})
            return localPlugins
        })
        .catch(error => {
            setSnapshot({loadingLocal: false, localError: String(error)})
            return snapshot.localPlugins
        })
        .finally(() => {
            localLoad = null
        })
    return localLoad
}

export function refreshMarketPlugins() {
    if (marketLoad) return marketLoad
    setSnapshot({loadingMarket: true, marketError: null})
    marketLoad = plugin_market_list()
        .then(marketPlugins => {
            setSnapshot({marketPlugins, loadingMarket: false})
            return marketPlugins
        })
        .catch(error => {
            setSnapshot({loadingMarket: false, marketError: String(error)})
            return snapshot.marketPlugins
        })
        .finally(() => {
            marketLoad = null
        })
    return marketLoad
}

async function finishPluginMutation() {
    await Promise.all([refreshLocalPlugins(), refreshAppSettings()])
    await refreshAiPluginStore()
}

export async function installLocalPlugin(filePath: string) {
    setSnapshot({installingLocalFile: true})
    try {
        await ai_close_all_sessions()
        const plugin = await plugin_install_from_file(filePath)
        await finishPluginMutation()
        return plugin
    } finally {
        setSnapshot({installingLocalFile: false})
    }
}

export async function installMarketPlugin(pluginId: string) {
    setSnapshot({installingIds: new Set([...snapshot.installingIds, pluginId])})
    try {
        await ai_close_all_sessions()
        const plugin = await plugin_market_install(pluginId)
        await finishPluginMutation()
        return plugin
    } finally {
        const installingIds = new Set(snapshot.installingIds)
        installingIds.delete(pluginId)
        setSnapshot({installingIds})
    }
}

export async function uninstallPlugin(pluginId: string) {
    setSnapshot({uninstallingId: pluginId})
    try {
        await ai_close_all_sessions()
        await plugin_uninstall(pluginId)
        await finishPluginMutation()
    } finally {
        setSnapshot({uninstallingId: null})
    }
}

export function usePluginCatalogStore() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
