/**
 * Tauri 事件监听适配层。
 *
 * 统一处理浏览器预览降级，以及 React StrictMode/HMR 下监听器可能被原生层提前
 * 释放的竞态，避免清理函数产生未处理的 Promise 拒绝。
 */
import {listen as tauriListen} from '@tauri-apps/api/event'
import {isBrowserPreview} from '../shared/devPreview'

function isAlreadyReleasedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes("listeners[eventId].handlerId")
}

function releaseSafely(release: () => void, label: string): void {
    void Promise.resolve()
        .then(release)
        .catch((error: unknown) => {
            if (!isAlreadyReleasedError(error)) {
                console.warn(`[events] 释放 ${label} 监听器失败`, error)
            }
        })
}

/** 统一清理由 Tauri Window/Event API 异步创建的监听器。 */
export function releaseTauriListener(listener: Promise<() => void>, label = 'Tauri'): void {
    void listener
        .then(release => releaseSafely(release, label))
        .catch((error: unknown) => {
            if (!isAlreadyReleasedError(error)) {
                console.warn(`[events] 获取 ${label} 监听器清理函数失败`, error)
            }
        })
}

export const listen: typeof tauriListen = (async (event, handler, options) => {
    if (isBrowserPreview()) {
        return () => undefined
    }

    const release = await tauriListen(event, handler, options)
    let released = false

    return () => {
        if (released) {
            return
        }
        released = true

        // Tauri 的 UnlistenFn 类型声明为同步函数，但当前实现会返回 Promise。
        // WebView/HMR 可能先于 React 清理原生监听器；只吞掉这个已知竞态，其他错误保留告警。
        releaseSafely(release, 'Tauri 事件')
    }
}) as typeof tauriListen
