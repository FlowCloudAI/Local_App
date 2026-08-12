// 移动端启动更新提示：仅 Android 静默检查，并将 APK 安装交给系统浏览器。

import {useCallback, useEffect, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {check_mobile_app_update, get_app_version, type MobileAppUpdate} from '../../api'
import {openUrl} from '../../api/opener'
import {
    getSkippedUpdateVersion,
    isAutoCheckUpdateEnabled,
    shouldOfferStartupUpdate,
    skipUpdateVersion,
} from '../../features/about/appUpdate'
import {logger} from '../../shared/logger'
import {FloatingPanel} from '../../shared/ui/overlay'

let mobileStartupUpdateCheck: Promise<MobileAppUpdate | null> | null = null

export default function MobileStartupUpdatePrompt({enabled}: {enabled: boolean}) {
    const [update, setUpdate] = useState<MobileAppUpdate | null>(null)
    const [opening, setOpening] = useState(false)
    const [status, setStatus] = useState('')

    useEffect(() => {
        if (!enabled || !isAutoCheckUpdateEnabled()) return
        mobileStartupUpdateCheck ??= get_app_version().then(check_mobile_app_update)
        mobileStartupUpdateCheck.then((available) => {
            if (!available || !shouldOfferStartupUpdate(
                isAutoCheckUpdateEnabled(),
                available.version,
                getSkippedUpdateVersion(),
            )) return
            setUpdate(available)
        }).catch((error) => {
            logger.warn('移动端启动时检查更新失败', error)
        })
    }, [enabled])

    const close = useCallback(() => {
        if (opening) return
        setUpdate(null)
        setStatus('')
    }, [opening])

    const handleSkip = useCallback(() => {
        if (!update) return
        skipUpdateVersion(update.version)
        close()
    }, [close, update])

    const handleUpdate = useCallback(async () => {
        if (!update) return
        setOpening(true)
        try {
            await openUrl(update.url)
            setUpdate(null)
        } catch (error) {
            logger.error('打开 Android 更新包失败', error)
            setStatus('无法打开下载地址，请稍后从更新页面重试。')
        } finally {
            setOpening(false)
        }
    }, [update])

    return (
        <FloatingPanel
            open={Boolean(update)}
            title={update ? `发现新版本 ${update.version}` : '发现新版本'}
            className="mobile-startup-update-panel"
            dismissible={!opening}
            showCloseButton={false}
            onClose={close}
        >
            {update && (
                <div className="mobile-startup-update-panel__content">
                    {update.pub_date && <time>发布时间：{update.pub_date}</time>}
                    <p>{update.notes?.trim() || '此版本未提供更新说明。'}</p>
                    {status && <strong>{status}</strong>}
                    <div className="mobile-startup-update-panel__actions">
                        <Button type="button" variant="primary" size="sm" radius="full" disabled={opening} onClick={() => void handleUpdate()}>
                            {opening ? '正在打开…' : '更新'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" radius="full" disabled={opening} onClick={close}>
                            取消
                        </Button>
                        <Button type="button" variant="ghost" size="sm" radius="full" disabled={opening} onClick={handleSkip}>
                            跳过此版本
                        </Button>
                    </div>
                </div>
            )}
        </FloatingPanel>
    )
}
