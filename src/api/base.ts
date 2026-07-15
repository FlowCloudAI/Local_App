import { invoke } from '@tauri-apps/api/core'

export type DevCommandHandler = <T>(name: string, args?: Record<string, unknown>) => Promise<T>

/**
 * 开发期浏览器预览的 mock 后端注入点（见 shared/devPreviewBackend）。
 * 用可变持有者而不是直接 import mock 模块，是为了让生产构建里
 * `import.meta.env.DEV` 为 false 时整条分支被 DCE，mock 代码不会被打进产物。
 */
let devCommandHandler: DevCommandHandler | null = null

export const setDevCommandHandler = (handler: DevCommandHandler | null) => {
  devCommandHandler = handler
}

export const command = <T>(name: string, args?: Record<string, unknown>) => {
  if (import.meta.env.DEV && devCommandHandler) return devCommandHandler<T>(name, args)
  return invoke<T>(name, args)
}
