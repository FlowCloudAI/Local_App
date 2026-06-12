import {open as tauriOpen, save as tauriSave} from '@tauri-apps/plugin-dialog'
import {isBrowserPreview} from '../shared/devPreview'

export const openFileDialog: typeof tauriOpen = ((options) => {
    if (isBrowserPreview()) return Promise.resolve(null)
    return tauriOpen(options)
}) as typeof tauriOpen

export const saveFileDialog: typeof tauriSave = ((options) => {
    if (isBrowserPreview()) return Promise.resolve(null)
    return tauriSave(options)
}) as typeof tauriSave
