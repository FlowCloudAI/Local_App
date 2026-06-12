import {listen as tauriListen} from '@tauri-apps/api/event'
import {isBrowserPreview} from '../shared/devPreview'

export const listen: typeof tauriListen = ((event, handler, options) => {
    if (isBrowserPreview()) {
        return Promise.resolve(() => undefined)
    }
    return tauriListen(event, handler, options)
}) as typeof tauriListen
