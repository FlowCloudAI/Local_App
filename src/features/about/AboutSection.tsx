import {useCallback, useEffect, useState} from 'react'
import {getVersion} from '@tauri-apps/api/app'
import {openUrl} from '@tauri-apps/plugin-opener'
import {Button} from 'flowcloudai-ui'
import {logger} from '../../shared/logger'
import LicenseModal from './LicenseModal'
import './AboutSection.css'

const OFFICIAL_SITE_URL = 'https://www.flowcloudai.cn'
const OFFICIAL_GITHUB_URL = 'https://github.com/FlowCloudAI'
const OFFICIAL_EMAIL = 'flowcloudai@163.com'

interface AboutSectionProps {
    configDir: string
    onOpenDir: (path: string) => void
}

export default function AboutSection({configDir, onOpenDir}: AboutSectionProps) {
    const [appVersion, setAppVersion] = useState<string>('')
    const [licenseModalOpen, setLicenseModalOpen] = useState(false)

    useEffect(() => {
        let disposed = false

        getVersion()
            .then(version => {
                if (!disposed) {
                    setAppVersion(version)
                }
            })
            .catch(logger.error)

        return () => {
            disposed = true
        }
    }, [])

    const handleOpenUrl = useCallback((url: string) => {
        void openUrl(url).catch(logger.error)
    }, [])

    return (
        <>
            <section className="settings-section fc-section-card about-section">
                <h2 className="settings-section-title fc-section-title">关于</h2>
                <div className="settings-field">
                    <label className="settings-label-wide">当前版本</label>
                    <span className="about-section-value">{appVersion || '加载中…'}</span>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">开源协议</label>
                    <span className="about-section-value">MIT License</span>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">官网</label>
                    <button
                        type="button"
                        className="about-section-link"
                        onClick={() => handleOpenUrl(OFFICIAL_SITE_URL)}
                    >
                        {OFFICIAL_SITE_URL}
                    </button>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">官方 GitHub</label>
                    <button
                        type="button"
                        className="about-section-link"
                        onClick={() => handleOpenUrl(OFFICIAL_GITHUB_URL)}
                    >
                        {OFFICIAL_GITHUB_URL}
                    </button>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">官方邮箱</label>
                    <button
                        type="button"
                        className="about-section-link"
                        onClick={() => handleOpenUrl(`mailto:${OFFICIAL_EMAIL}`)}
                    >
                        {OFFICIAL_EMAIL}
                    </button>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">用户知情同意书</label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setLicenseModalOpen(true)}>
                        查看
                    </Button>
                </div>
                <div className="settings-field">
                    <label className="settings-label-wide">日志目录</label>
                    <Button type="button"
                        variant="outline"
                        size="sm"
                        disabled={!configDir}
                        onClick={() => onOpenDir(configDir)}
                    >
                        打开
                    </Button>
                    <span className="settings-field-hint about-section-log-hint">
                        日志文件 app.log 位于配置目录内（仅 release 构建写入）
                    </span>
                </div>
            </section>
            <LicenseModal open={licenseModalOpen} onClose={() => setLicenseModalOpen(false)}/>
        </>
    )
}
