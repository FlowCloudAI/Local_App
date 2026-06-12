import {openUrl as tauriOpenUrl} from '@tauri-apps/plugin-opener'
import {isBrowserPreview} from '../shared/devPreview'

export const openUrl: typeof tauriOpenUrl = ((url) => {
    if (isBrowserPreview()) {
        window.open(String(url), '_blank', 'noopener,noreferrer')
        return Promise.resolve()
    }
    return tauriOpenUrl(url)
}) as typeof tauriOpenUrl
