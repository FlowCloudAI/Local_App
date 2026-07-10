import {open as tauriOpen, save as tauriSave} from '@tauri-apps/plugin-dialog'
import type {DragDropEvent} from '@tauri-apps/api/webview'
import {isBrowserPreview, isTauriRuntime} from '../shared/devPreview'

export const openFileDialog: typeof tauriOpen = ((options) => {
    if (isBrowserPreview()) return Promise.resolve(null)
    return tauriOpen(options)
}) as typeof tauriOpen

export const saveFileDialog: typeof tauriSave = ((options) => {
    if (isBrowserPreview()) return Promise.resolve(null)
    return tauriSave(options)
}) as typeof tauriSave

export async function listenNativeFileDrop(
    handler: (event: DragDropEvent) => void,
): Promise<() => void> {
    if (!isTauriRuntime()) return () => {}
    const {getCurrentWebview} = await import('@tauri-apps/api/webview')
    return getCurrentWebview().onDragDropEvent(({payload}) => handler(payload))
}
