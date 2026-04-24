import {Button} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import type {LocalPluginInfo, RemotePluginInfo} from '../../api'
import './PluginCard.css'

// ── 默认 SVG 图标 ──────────────────────────────────────────────────────────────

function KindIcon({kind}: { kind: string }) {
    if (kind.includes('image')) {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5"/>
                <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/>
                <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
        )
    }
    if (kind.includes('tts')) {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeWidth="1.5"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
        )
    }
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeWidth="1.5" strokeLinecap="round"
                  strokeLinejoin="round"/>
        </svg>
    )
}

// ── 图标容器：有 icon_url 显示图片，否则显示 SVG ──────────────────────────────

interface IconDisplayProps {
    kind: string
    iconUrl?: string
    /** true = 本地文件路径，需要 convertFileSrc；false = 远程 https URL */
    isLocalPath?: boolean
}

function IconDisplay({kind, iconUrl, isLocalPath = false}: IconDisplayProps) {
    const src = iconUrl
        ? (isLocalPath ? convertFileSrc(iconUrl) : iconUrl)
        : null

    return (
        <div className="plugin-card-icon">
            {src ? (
                <img
                    src={src}
                    alt=""
                    className="plugin-card-icon-img"
                    onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                />
            ) : (
                <KindIcon kind={kind}/>
            )}
        </div>
    )
}

function kindLabel(kind: string): string {
    if (kind.includes('image')) return 'image'
    if (kind.includes('tts')) return 'tts'
    return 'llm'
}

function normalizePluginKey(value: string): string {
    return value.trim().toLowerCase()
}

// ── 本地插件卡片 ──────────────────────────────────────────────────────────────

interface LocalPluginCardProps {
    plugin: LocalPluginInfo
    updateVersion?: string
    onUninstall: (id: string) => void
    uninstalling: boolean
}

export function LocalPluginCard({plugin, updateVersion, onUninstall, uninstalling}: LocalPluginCardProps) {
    return (
        <div className="plugin-card">
            <IconDisplay kind={plugin.kind} iconUrl={plugin.icon_url} isLocalPath/>
            <div className="plugin-card-info">
                <div className="plugin-card-name">{plugin.name}</div>
                <div className="plugin-card-meta">
                    <span className="plugin-card-kind">{kindLabel(plugin.kind)}</span>
                    <span>v{plugin.version}</span>
                    <span>{plugin.author}</span>
                </div>
                {updateVersion && (
                    <div className="plugin-card-status plugin-card-status-update">
                        可更新到 v{updateVersion}
                    </div>
                )}
            </div>
            <div className="plugin-card-actions">
                <Button
                    variant="danger"
                    size="sm"
                    disabled={uninstalling}
                    onClick={() => onUninstall(plugin.id)}
                >
                    {uninstalling ? '卸载中…' : '卸载'}
                </Button>
            </div>
        </div>
    )
}

// ── 市场插件卡片 ──────────────────────────────────────────────────────────────

interface MarketPluginCardProps {
    plugin: RemotePluginInfo
    installedIds: Set<string>
    installedVersion?: string
    hasUpdate?: boolean
    onInstall: (id: string) => void
    installing: boolean
}

export function MarketPluginCard({
                                     plugin,
                                     installedIds,
                                     installedVersion,
                                     hasUpdate = false,
                                     onInstall,
                                     installing,
                                 }: MarketPluginCardProps) {
    const installed = installedIds.has(normalizePluginKey(plugin.id))

    return (
        <div className="plugin-card">
            <IconDisplay kind={plugin.kind} iconUrl={plugin.icon_url}/>
            <div className="plugin-card-info">
                <div className="plugin-card-name">{plugin.name}</div>
                <div className="plugin-card-meta">
                    <span className="plugin-card-kind">{kindLabel(plugin.kind)}</span>
                    <span>v{plugin.version}</span>
                    <span>{plugin.author}</span>
                </div>
                {installed && installedVersion && (
                    <div className={`plugin-card-status${hasUpdate ? ' plugin-card-status-update' : ''}`}>
                        {hasUpdate ? `已安装 v${installedVersion}，可更新` : `已安装 v${installedVersion}`}
                    </div>
                )}
            </div>
            <div className="plugin-card-actions">
                {installed ? (
                    hasUpdate ? (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={installing}
                            onClick={() => onInstall(plugin.id)}
                        >
                            {installing ? '更新中…' : '更新'}
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" disabled>已安装</Button>
                    )
                ) : (
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={installing}
                        onClick={() => onInstall(plugin.id)}
                    >
                        {installing ? '安装中…' : '安装'}
                    </Button>
                )}
            </div>
        </div>
    )
}
