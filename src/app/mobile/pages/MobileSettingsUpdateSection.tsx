// 移动端更新页：展示 APK 更新状态、自动检查偏好以及与桌面端共享的版本日志。

import {useCallback, useEffect, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    check_mobile_app_update,
    formatApiError,
    get_app_update_changelog,
    type MobileAppUpdate,
    toApiError,
} from '../../../api'
import {
    isAutoCheckUpdateEnabled,
    setAutoCheckUpdateEnabled,
} from '../../../features/about/appUpdate'
import {
    mergeUpdateChangelogEntries,
    UPDATE_CHANGELOG,
    type UpdateChangelogEntry,
} from '../../../features/about/updateChangelog'
import {openUrl} from '../../../api/opener'
import {logger} from '../../../shared/logger'

interface Props {
    version: string
    supported: boolean
}

export default function MobileSettingsUpdateSection({version, supported}: Props) {
    const {showAlert} = useAlert()
    const [autoCheck, setAutoCheck] = useState(isAutoCheckUpdateEnabled)
    const [checking, setChecking] = useState(false)
    const [availableUpdate, setAvailableUpdate] = useState<MobileAppUpdate | null>(null)
    const [status, setStatus] = useState('')
    const [remoteChangelog, setRemoteChangelog] = useState<readonly UpdateChangelogEntry[]>([])

    useEffect(() => {
        if (!supported) return
        get_app_update_changelog('android', 'universal').then((entries) => {
            setRemoteChangelog(entries.map((entry) => ({
                version: entry.version,
                date: entry.pub_date ?? '',
                notes: entry.notes?.trim() ?? '',
            })))
        }).catch((error) => logger.warn('获取官网更新日志失败，继续使用内置日志', error))
    }, [supported])

    const handleCheck = useCallback(async () => {
        if (!supported || !version) return
        setChecking(true)
        setStatus('正在检查更新…')
        setAvailableUpdate(null)
        try {
            const update = await check_mobile_app_update(version)
            setAvailableUpdate(update)
            setStatus(update ? `发现新版本 ${update.version}` : '当前已是最新版本')
            if (!update) void showAlert('当前已是最新版本', 'success', 'nonInvasive', 1800)
        } catch (error) {
            const message = formatApiError(toApiError(error))
            setStatus(`检查更新失败：${message}`)
            void showAlert(`检查更新失败：${message}`, 'error', 'nonInvasive', 3200)
        } finally {
            setChecking(false)
        }
    }, [showAlert, supported, version])

    const handleUpdate = useCallback(async () => {
        if (!availableUpdate) return
        try {
            await openUrl(availableUpdate.url)
        } catch (error) {
            const message = formatApiError(toApiError(error))
            void showAlert(`打开下载地址失败：${message}`, 'error', 'nonInvasive', 3200)
        }
    }, [availableUpdate, showAlert])

    const changelog = mergeUpdateChangelogEntries(
        remoteChangelog,
        availableUpdate ? [{
            version: availableUpdate.version,
            date: availableUpdate.pub_date ?? '',
            notes: availableUpdate.notes?.trim() || '此版本未提供更新说明。',
        }] : [],
        UPDATE_CHANGELOG,
    )

    return (
        <div className="mobile-settings-section mobile-settings-update">
            <section className="mobile-settings-panel mobile-settings-update__status">
                <div>
                    <h2 className="mobile-settings-panel__title">应用更新</h2>
                    <p className="mobile-settings-field-hint">
                        {supported
                            ? `当前版本 ${version || '加载中…'}；下载后由 Android 系统完成安装与签名校验。`
                            : '此平台暂不支持应用内检查更新。'}
                    </p>
                    {status && <p className="mobile-settings-update__message">{status}</p>}
                    {availableUpdate?.pub_date && (
                        <p className="mobile-settings-field-hint">发布时间：{availableUpdate.pub_date}</p>
                    )}
                </div>
                {supported && (
                    <Button
                        type="button"
                        variant={availableUpdate ? 'primary' : 'outline'}
                        size="sm"
                        radius="full"
                        disabled={checking || !version}
                        onClick={() => void (availableUpdate ? handleUpdate() : handleCheck())}
                    >
                        {checking ? '检查中…' : availableUpdate ? '更新' : '检查更新'}
                    </Button>
                )}
            </section>

            {supported && (
                <section className="mobile-settings-panel">
                    <label className="mobile-settings-switch-field mobile-settings-switch-field--stacked">
                        <span>
                            自动检查更新
                            <small>软件启动时静默检查一次；只有发现新版本时才会提示。</small>
                        </span>
                        <input
                            type="checkbox"
                            checked={autoCheck}
                            onChange={(event) => {
                                const enabled = event.currentTarget.checked
                                setAutoCheck(enabled)
                                setAutoCheckUpdateEnabled(enabled)
                            }}
                        />
                    </label>
                </section>
            )}

            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">更新日志</h2>
                <div className="mobile-settings-update-log">
                    {changelog.map((entry) => (
                        <details key={entry.version} open={entry.version === version}>
                            <summary>
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M5 3.5 12 8l-7 4.5Z"/>
                                </svg>
                                <span>版本 {entry.version}</span>
                                {entry.version === version && <strong>当前</strong>}
                                {entry.version === availableUpdate?.version && <strong>可更新</strong>}
                                {entry.date && <time>{entry.date}</time>}
                            </summary>
                            <p>{entry.notes}</p>
                        </details>
                    ))}
                </div>
            </section>
        </div>
    )
}
