import {command} from './base'

export type PlatformOs = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'

export type PlatformFormFactor = 'desktop' | 'mobile'

export interface PlatformInfo {
    os: PlatformOs
    formFactor: PlatformFormFactor
    windowControls: boolean
}

export const get_platform_info = () => command<PlatformInfo>('get_platform_info')
