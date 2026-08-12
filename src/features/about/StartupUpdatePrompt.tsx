// 启动更新提示：静默检查一次，并在发现未跳过的新版本时承载更新操作。

import {useCallback, useEffect, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {FloatingPanel} from '../../shared/ui/overlay'
import {logger} from '../../shared/logger'
import {
    checkAppUpdate,
    getSkippedUpdateVersion,
    installAppUpdate,
    isAutoCheckUpdateEnabled,
    shouldOfferStartupUpdate,
    skipUpdateVersion,
    type DownloadEvent,
    type Update,
} from './appUpdate'
import './AboutSection.css'

let startupUpdateCheck: Promise<Update | null> | null = null

export default function StartupUpdatePrompt() {
    const [update, setUpdate] = useState<Update | null>(null)
    const [installing, setInstalling] = useState(false)
    const [status, setStatus] = useState('')

    useEffect(() => {
        if (!isAutoCheckUpdateEnabled()) return
        startupUpdateCheck ??= checkAppUpdate()

        startupUpdateCheck.then((available) => {
            if (!available) return
            if (!shouldOfferStartupUpdate(
                isAutoCheckUpdateEnabled(),
                available.version,
                getSkippedUpdateVersion(),
            )) return
            setUpdate(available)
        }).catch((error) => {
            logger.warn('启动时检查更新失败', error)
        })
    }, [])

    const close = useCallback(() => {
        if (installing) return
        setUpdate(null)
        setStatus('')
    }, [installing])

    const handleSkip = useCallback(() => {
        if (!update) return
        skipUpdateVersion(update.version)
        close()
    }, [close, update])

    const handleInstall = useCallback(async () => {
        if (!update) return
        if (!window.confirm('更新会在安装后重启应用，请先保存正在编辑的内容。是否继续？')) return
        let downloaded = 0
        setInstalling(true)
        setStatus('正在下载更新…')
        try {
            const onEvent = (event: DownloadEvent) => {
                if (event.event === 'Started') {
                    downloaded = 0
                    setStatus('正在下载更新…')
                } else if (event.event === 'Progress') {
                    downloaded += event.data.chunkLength
                    setStatus(`已下载 ${Math.round(downloaded / 1024 / 1024 * 10) / 10} MB`)
                } else if (event.event === 'Finished') {
                    setStatus('下载完成，正在安装…')
                }
            }
            await installAppUpdate(update, onEvent)
        } catch (error) {
            logger.error('安装更新失败:', error)
            const message = error instanceof Error ? error.message : String(error)
            setStatus(`安装更新失败：${message}`)
            setInstalling(false)
        }
    }, [update])

    return (
        <FloatingPanel
            open={Boolean(update)}
            title={update ? `发现新版本 ${update.version}` : '发现新版本'}
            className="startup-update-panel"
            dismissible={!installing}
            onClose={close}
        >
            {update && (
                <div className="startup-update-panel__content">
                    <div className="about-section-update-meta">
                        <span>当前版本：{update.currentVersion}</span>
                        {update.date && <span>发布时间：{update.date}</span>}
                    </div>
                    <p className="startup-update-panel__notes">
                        {update.body?.trim() || '此版本未提供更新说明。'}
                    </p>
                    {status && <p className="about-section-update-status">{status}</p>}
                    <div className="startup-update-panel__actions">
                        <Button type="button" variant="primary" size="sm" disabled={installing} onClick={() => void handleInstall()}>
                            {installing ? '更新中…' : '更新'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={installing} onClick={close}>
                            取消
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={installing} onClick={handleSkip}>
                            跳过此版本
                        </Button>
                    </div>
                </div>
            )}
        </FloatingPanel>
    )
}
