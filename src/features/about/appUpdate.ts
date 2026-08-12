// 应用更新共享能力：统一检查、安装与仅作用于启动提示的本地偏好。

import {relaunch} from '@tauri-apps/plugin-process'
import {check, type DownloadEvent, type Update} from '@tauri-apps/plugin-updater'

const AUTO_CHECK_KEY = 'flowcloudai.auto-check-update'
const SKIPPED_VERSION_KEY = 'flowcloudai.skipped-update-version'

export function isAutoCheckUpdateEnabled() {
    try {
        return localStorage.getItem(AUTO_CHECK_KEY) !== 'false'
    } catch {
        return true
    }
}

export function setAutoCheckUpdateEnabled(enabled: boolean) {
    try {
        localStorage.setItem(AUTO_CHECK_KEY, String(enabled))
    } catch {
        // 本地存储不可用时仅保持本次页面状态，不阻断更新功能。
    }
}

export function getSkippedUpdateVersion() {
    try {
        return localStorage.getItem(SKIPPED_VERSION_KEY)
    } catch {
        return null
    }
}

export function skipUpdateVersion(version: string) {
    try {
        localStorage.setItem(SKIPPED_VERSION_KEY, version)
    } catch {
        // 跳过记录失败时不影响用户关闭当前提示。
    }
}

export function shouldOfferStartupUpdate(enabled: boolean, version: string, skippedVersion: string | null) {
    return enabled && version !== skippedVersion
}

export function checkAppUpdate() {
    return check({timeout: 30000})
}

export async function installAppUpdate(update: Update, onEvent?: (event: DownloadEvent) => void) {
    await update.downloadAndInstall(onEvent)
    await relaunch()
}

export type {DownloadEvent, Update}
