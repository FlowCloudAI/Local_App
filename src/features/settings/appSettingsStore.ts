import {useEffect, useSyncExternalStore} from 'react'
import {
    setting_delete_api_key,
    setting_get_settings_bootstrap,
    setting_set_api_key,
    setting_update_settings,
    type AppSettings,
    type DefaultPaths,
    type PluginInfo,
} from '../../api'
import {refreshAiPluginStore} from '../ai-chat/stores/aiPluginStore'

interface AppSettingsSnapshot {
    settings: AppSettings | null
    llmPlugins: PluginInfo[]
    imagePlugins: PluginInfo[]
    ttsPlugins: PluginInfo[]
    apiKeyStatus: Record<string, boolean>
    mediaDir: string
    defaultPaths: DefaultPaths | null
    loading: boolean
    hasLoaded: boolean
    error: string | null
    version: number
}

const listeners = new Set<() => void>()
let snapshot: AppSettingsSnapshot = {
    settings: null,
    llmPlugins: [],
    imagePlugins: [],
    ttsPlugins: [],
    apiKeyStatus: {},
    mediaDir: '',
    defaultPaths: null,
    loading: false,
    hasLoaded: false,
    error: null,
    version: 0,
}
let refreshPromise: Promise<AppSettingsSnapshot> | null = null
let saveQueue: Promise<unknown> = Promise.resolve()

function emit() {
    for (const listener of listeners) listener()
}

function setSnapshot(patch: Partial<Omit<AppSettingsSnapshot, 'version'>>) {
    snapshot = {...snapshot, ...patch, version: snapshot.version + 1}
    emit()
}

export function subscribeAppSettings(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function getAppSettingsSnapshot() {
    return snapshot
}

export async function refreshAppSettings() {
    if (refreshPromise) return refreshPromise
    setSnapshot({loading: true, error: null})
    refreshPromise = setting_get_settings_bootstrap()
        .then(bootstrap => {
            setSnapshot({
                settings: bootstrap.settings,
                llmPlugins: bootstrap.llmPlugins,
                imagePlugins: bootstrap.imagePlugins,
                ttsPlugins: bootstrap.ttsPlugins,
                apiKeyStatus: bootstrap.apiKeyStatus,
                mediaDir: bootstrap.mediaDir,
                defaultPaths: bootstrap.defaultPaths,
                loading: false,
                hasLoaded: true,
                error: null,
            })
            return snapshot
        })
        .catch(error => {
            setSnapshot({loading: false, hasLoaded: true, error: String(error)})
            throw error
        })
        .finally(() => {
            refreshPromise = null
        })
    return refreshPromise
}

export function saveAppSettings(settings: AppSettings) {
    const task = saveQueue.then(async () => {
        const migrationMessage = await setting_update_settings(settings)
        const next = await refreshAppSettings()
        await refreshAiPluginStore()
        return {migrationMessage, settings: next.settings ?? settings}
    })
    saveQueue = task.catch(() => undefined)
    return task
}

export async function saveAppApiKey(pluginId: string, apiKey: string) {
    await setting_set_api_key(pluginId, apiKey)
    setSnapshot({apiKeyStatus: {...snapshot.apiKeyStatus, [pluginId]: true}})
}

export async function deleteAppApiKey(pluginId: string) {
    await setting_delete_api_key(pluginId)
    setSnapshot({apiKeyStatus: {...snapshot.apiKeyStatus, [pluginId]: false}})
}

export function useAppSettingsStore() {
    const current = useSyncExternalStore(subscribeAppSettings, getAppSettingsSnapshot, getAppSettingsSnapshot)
    useEffect(() => {
        if (!current.hasLoaded && !current.loading) void refreshAppSettings()
    }, [current.hasLoaded, current.loading])
    return current
}
