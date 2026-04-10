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

function translatePluginMarketUploadError(error: unknown): string {
  const raw = String(error)
  const httpMatch = raw.match(/HTTP\s+(\d{3})[^:]*:\s*([\s\S]*)$/)
  const status = httpMatch ? Number(httpMatch[1]) : null
  const message = (httpMatch ? httpMatch[2] : raw).trim()

  if (message === 'plugin limit reached (max 100)') {
    return '插件数量已达上限，最多只能上传 100 个插件'
  }
  if (message === 'invalid multipart data') {
    return '上传请求格式无效'
  }
  if (message === 'failed to read password') {
    return '读取上传密码失败'
  }
  if (message === 'failed to read file data') {
    return '读取插件文件失败'
  }
  if (message === 'password field is required') {
    return '必须提供上传密码'
  }
  if (message === 'no file field provided') {
    return '未提供插件文件'
  }
  if (message === 'not a valid ZIP file') {
    return '插件包不是有效的 ZIP 文件'
  }
  if (message === 'missing manifest.json') {
    return '插件包缺少 manifest.json'
  }
  if (message === 'missing plugin.wasm') {
    return '插件包缺少 plugin.wasm'
  }
  if (message === 'manifest.meta.id is empty') {
    return '插件清单中的 manifest.meta.id 不能为空'
  }
  if (message.startsWith('invalid manifest.json:')) {
    const detail = message.slice('invalid manifest.json:'.length).trim()
    return detail ? `插件清单 manifest.json 无效：${detail}` : '插件清单 manifest.json 无效'
  }
  if (message.startsWith("manifest id '") && message.includes(" doesn't match path id '")) {
    return `插件包中的 manifest id 与路径 id 不一致：${message}`
  }
  if (message === 'invalid upload password') {
    return '上传密码错误'
  }
  if (message === 'plugin not found') {
    return '插件不存在'
  }

  if (status === 400) {
    return `插件包校验失败：${message}`
  }
  if (status === 401) {
    return '上传认证失败，请检查上传密码'
  }
  if (status === 404) {
    return '目标插件不存在'
  }
  if (status === 500) {
    return message ? `服务器文件读写失败：${message}` : '服务器文件读写失败'
  }

  return raw
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

export const plugin_market_list = () =>
  command<RemotePluginInfo[] | unknown>('plugin_market_list').then(
    (value) => value as RemotePluginInfo[],
  )

export const plugin_market_install = (pluginId: string) =>
  command<LocalPluginInfo>('plugin_market_install', { pluginId })

export const plugin_market_upload = (filePath: string, password: string) =>
  command<unknown>('plugin_market_upload', { filePath, password }).catch((error) => {
    throw new Error(translatePluginMarketUploadError(error))
  })

export const plugin_market_update = (pluginId: string, filePath: string) =>
  command<unknown>('plugin_market_update', { pluginId, filePath })

export const plugin_market_delete = (pluginId: string) =>
  command<void>('plugin_market_delete', { pluginId })
