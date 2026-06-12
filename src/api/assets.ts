import {convertFileSrc as tauriConvertFileSrc} from '@tauri-apps/api/core'
import {isBrowserPreview} from '../shared/devPreview'

export const convertFileSrc: typeof tauriConvertFileSrc = ((filePath, protocol) => {
    if (isBrowserPreview()) return String(filePath)
    return tauriConvertFileSrc(filePath, protocol)
}) as typeof tauriConvertFileSrc
