import { command } from './base'

export interface LocalPluginInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  kind: string
  path: string
  ref_count: number
  icon_url?: string
}

export interface RemotePluginInfo {
  id: string
  name: string
  kind: string
  version: string
  author: string
  abi_version: number
  url: string
  uploaded_at: string
  updated_at: string
  extra: unknown
  icon_url?: string
}

export interface PluginUpdateInfo {
  plugin_id: string
  current_version: string
  latest_version: string
  has_update: boolean
}

let pluginMarketListInFlight: Promise<RemotePluginInfo[]> | null = null

const PLUGIN_MARKET_LIST_TIMEOUT_MS = 18000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof window.setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId)
  })
}

export const plugin_list_local = () => command<LocalPluginInfo[]>('plugin_list_local')

export const plugin_install_from_file = (filePath: string) =>
  command<LocalPluginInfo>('plugin_install_from_file', { filePath })

export const plugin_uninstall = (pluginId: string) =>
  command<void>('plugin_uninstall', { pluginId })

export const plugin_fetch_remote = (registryUrl: string) =>
  command<RemotePluginInfo[]>('plugin_fetch_remote', { registryUrl })

export const plugin_check_updates = (registryUrl: string) =>
  command<PluginUpdateInfo[]>('plugin_check_updates', { registryUrl })

export const plugin_market_list = () => {
  if (!pluginMarketListInFlight) {
    pluginMarketListInFlight = withTimeout(
      command<RemotePluginInfo[] | unknown>('plugin_market_list')
        .then((value) => value as RemotePluginInfo[]),
      PLUGIN_MARKET_LIST_TIMEOUT_MS,
      `插件库列表加载超时（${PLUGIN_MARKET_LIST_TIMEOUT_MS / 1000} 秒）`,
    )
      .finally(() => {
        pluginMarketListInFlight = null
      })
  }

  return pluginMarketListInFlight
}

export const plugin_market_install = (pluginId: string) =>
  command<LocalPluginInfo>('plugin_market_install', { pluginId })
