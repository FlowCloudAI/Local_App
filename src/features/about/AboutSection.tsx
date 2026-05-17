import {useCallback, useEffect, useState, type ReactNode} from 'react'
import {getVersion} from '@tauri-apps/api/app'
import {openUrl} from '@tauri-apps/plugin-opener'
import {Button, useAlert} from 'flowcloudai-ui'
import {logger} from '../../shared/logger'
import LicenseModal from './LicenseModal'
import githubInvertocat from './assets/github-invertocat.png'
import './AboutSection.css'

const OFFICIAL_SITE_URL = 'https://www.flowcloudai.cn'
const OFFICIAL_GITHUB_URL = 'https://github.com/FlowCloudAI/Local_App'
const OFFICIAL_EMAIL = 'flowcloudai@163.com'
const RELEASE_DATE = '2026-05-17'

interface AboutSectionProps {
    configDir: string
    onOpenDir: (path: string) => void
}

interface OfficialLink {
    id: string
    label: string
    value: string
    description: string
    action: 'open' | 'copy'
    url?: string
    icon: ReactNode
    tone: 'site' | 'github' | 'mail'
}

function WebsiteIcon() {
    return (
        <svg className="about-section-svg-icon" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="10.5"/>
            <path d="M5.5 16h21M16 5.5c3 3.2 4.5 6.7 4.5 10.5S19 23.3 16 26.5M16 5.5c-3 3.2-4.5 6.7-4.5 10.5s1.5 7.3 4.5 10.5"/>
            <path d="M8.4 9.2c2 .9 4.5 1.4 7.6 1.4s5.6-.5 7.6-1.4M8.4 22.8c2-.9 4.5-1.4 7.6-1.4s5.6.5 7.6 1.4"/>
            <circle className="about-section-svg-node" cx="24" cy="8" r="2.2"/>
            <circle className="about-section-svg-node" cx="7" cy="20.5" r="2"/>
        </svg>
    )
}

function MailIcon() {
    return (
        <svg className="about-section-svg-icon" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="5" y="8" width="22" height="16" rx="3"/>
            <path d="M7 10.5l9 7 9-7M7.5 22l7-6M24.5 22l-7-6"/>
        </svg>
    )
}

export default function AboutSection({configDir, onOpenDir}: AboutSectionProps) {
    const {showAlert} = useAlert()
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

    const handleCopyEmail = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(OFFICIAL_EMAIL)
            void showAlert('邮箱已复制', 'success', 'toast', 1600)
        } catch (error) {
            logger.error('复制官方邮箱失败:', error)
            void showAlert(`复制邮箱失败：${String(error)}`, 'error', 'toast', 2200)
        }
    }, [showAlert])

    const officialLinks: OfficialLink[] = [
        {
            id: 'site',
            label: '官网',
            value: OFFICIAL_SITE_URL,
            description: '产品主页与发布信息',
            action: 'open',
            url: OFFICIAL_SITE_URL,
            icon: <WebsiteIcon/>,
            tone: 'site',
        },
        {
            id: 'github',
            label: '官方 GitHub',
            value: OFFICIAL_GITHUB_URL,
            description: '桌面应用源码仓库',
            action: 'open',
            url: OFFICIAL_GITHUB_URL,
            icon: (
                <img
                    className="about-section-github-mark"
                    src={githubInvertocat}
                    alt=""
                    aria-hidden="true"
                />
            ),
            tone: 'github',
        },
        {
            id: 'mail',
            label: '官方邮箱',
            value: OFFICIAL_EMAIL,
            description: '反馈、合作与支持联系',
            action: 'copy',
            icon: <MailIcon/>,
            tone: 'mail',
        },
    ]

    return (
        <>
            <section className="settings-section fc-section-card about-section-hero">
                <div className="about-section-brand">
                    <div className="about-section-brand-mark" aria-hidden="true">
                        <img className="about-section-brand-icon" src="/icon.svg" alt=""/>
                    </div>
                    <div className="about-section-brand-copy">
                        <div className="about-section-kicker">FlowCloudAI</div>
                        <h2 className="about-section-title">流云AI</h2>
                        <p className="about-section-summary">
                            桌面端创意写作与知识管理应用。
                        </p>
                    </div>
                </div>
                <div className="about-section-meta">
                    <div className="about-section-meta-item">
                        <span className="about-section-meta-label">当前版本</span>
                        <span className="about-section-meta-value">{appVersion || '加载中…'}</span>
                    </div>
                    <div className="about-section-meta-item">
                        <span className="about-section-meta-label">发布日期</span>
                        <span className="about-section-meta-value">{RELEASE_DATE}</span>
                    </div>
                    <div className="about-section-meta-item">
                        <span className="about-section-meta-label">开源协议</span>
                        <span className="about-section-meta-value">MIT License</span>
                    </div>
                </div>
            </section>

            <section className="settings-section about-section-channel-grid" aria-label="官方渠道">
                {officialLinks.map(link => (
                    <div
                        key={link.id}
                        className={`about-section-channel about-section-channel--${link.tone}`}
                    >
                        <span className="about-section-channel-icon">{link.icon}</span>
                        <span className="about-section-channel-copy">
                            <span className="about-section-channel-label">{link.label}</span>
                            <span className="about-section-channel-description">{link.description}</span>
                            <span className="about-section-channel-value">{link.value}</span>
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="about-section-channel-action"
                            onClick={() => {
                                if (link.action === 'copy') {
                                    void handleCopyEmail()
                                    return
                                }
                                if (link.url) {
                                    handleOpenUrl(link.url)
                                }
                            }}
                        >
                            {link.action === 'copy' ? '复制' : '打开'}
                        </Button>
                    </div>
                ))}
            </section>

            <section className="settings-section fc-section-card about-section-actions">
                <h2 className="settings-section-title fc-section-title">许可与诊断</h2>
                <div className="about-section-action-row">
                    <div className="about-section-action-copy">
                        <span className="about-section-action-title">用户知情同意书</span>
                        <span className="about-section-action-desc">查看应用使用中的数据与权限说明。</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setLicenseModalOpen(true)}>
                        查看
                    </Button>
                </div>
                <div className="about-section-action-row">
                    <div className="about-section-action-copy">
                        <span className="about-section-action-title">日志目录</span>
                        <span className="about-section-action-desc">
                            app.log 位于配置目录内，仅 release 构建写入。
                        </span>
                    </div>
                    <Button type="button"
                        variant="outline"
                        size="sm"
                        disabled={!configDir}
                        onClick={() => onOpenDir(configDir)}
                    >
                        打开
                    </Button>
                </div>
            </section>
            <LicenseModal open={licenseModalOpen} onClose={() => setLicenseModalOpen(false)}/>
        </>
    )
}
