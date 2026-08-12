// 移动端更新 API：通过 Tauri 后端查询官网 APK 更新元数据。

import {command} from './base'

export interface MobileAppUpdate {
    version: string
    current_version: string
    url: string
    notes?: string
    pub_date?: string
}

export const check_mobile_app_update = (currentVersion: string) => command<MobileAppUpdate | null>(
    'check_mobile_app_update',
    {currentVersion},
)
