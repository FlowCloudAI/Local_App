import {type CSSProperties, useCallback, useEffect, useMemo, useState} from 'react'
import {open} from '@tauri-apps/plugin-dialog'
import {Button, Input, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    type LocalPluginInfo,
    plugin_install_from_file,
    plugin_list_local,
    plugin_market_install,
    plugin_market_list,
    plugin_uninstall,
    type RemotePluginInfo,
} from '../api'
import {LocalPluginCard, MarketPluginCard} from '../features/plugins/PluginCard'
import UploadPlugin from '../features/plugins/UploadPlugin'
import './Plugins.css'

function normalizePluginKey(value: string): string {
    return value.trim().toLowerCase()
}

function normalizeVersionString(version: string): string {
    return String(version).trim().replace(/^[vV]/, '')
}

function parseVersionParts(version: string): number[] | null {
    const trimmed = normalizeVersionString(version)
    if (!trimmed) return null

    const mainPart = trimmed.split(/[+-]/, 1)[0]
    const rawParts = mainPart.split('.')
    if (rawParts.length === 0 || rawParts.length > 3) return null

    const parts: number[] = []
    for (const part of rawParts) {
        if (!/^\d+$/.test(part)) return null
        parts.push(Number(part))
    }
    while (parts.length < 3) {
        parts.push(0)
    }
    return parts
}

function isRemoteVersionNewer(currentVersion: string, remoteVersion: string): boolean {
    const current = parseVersionParts(currentVersion)
    const remote = parseVersionParts(remoteVersion)
    if (!current || !remote) {
        return normalizeVersionString(currentVersion) !== normalizeVersionString(remoteVersion)
    }

    for (let i = 0; i < 3; i += 1) {
        if (remote[i] > current[i]) return true
        if (remote[i] < current[i]) return false
    }
    return false
}

export default function Plugins() {
    const {showAlert} = useAlert()

    const [localPlugins, setLocalPlugins] = useState<LocalPluginInfo[]>([])
    const [marketPlugins, setMarketPlugins] = useState<RemotePluginInfo[]>([])
    const [loadingLocal, setLoadingLocal] = useState(false)
    const [loadingMarket, setLoadingMarket] = useState(false)
    const [installingLocalFile, setInstallingLocalFile] = useState(false)
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const [marketError, setMarketError] = useState<string | null>(null)

    // 正在安装/卸载的插件 id
    const [installingId, setInstallingId] = useState<string | null>(null)
    const [uninstallingId, setUninstallingId] = useState<string | null>(null)

    // 市场过滤
    const [searchText, setSearchText] = useState('')
    const [kindFilter, setKindFilter] = useState<'all' | 'llm' | 'image' | 'tts'>('all')

    const loadLocal = useCallback(async () => {
        setLoadingLocal(true)
        setLocalError(null)
        try {
            setLocalPlugins(await plugin_list_local())
        } catch (e) {
            setLocalError(String(e))
        } finally {
            setLoadingLocal(false)
        }
    }, [])

    const loadMarket = useCallback(async () => {
        setLoadingMarket(true)
        setMarketError(null)
        try {
            setMarketPlugins(await plugin_market_list())
        } catch (e) {
            setMarketError(String(e))
        } finally {
            setLoadingMarket(false)
        }
    }, [])

    useEffect(() => {
        void loadLocal()
        void loadMarket()
    }, [loadLocal, loadMarket])

    const handleInstall = async (pluginId: string) => {
        setInstallingId(pluginId)
        try {
            const info = await plugin_market_install(pluginId)
            setLocalPlugins(prev => {
                const exists = prev.some(p => p.id === info.id)
                return exists
                    ? prev.map(p => (p.id === info.id ? info : p))
                    : [...prev, info]
            })
            void showAlert(`${info.name} 安装成功`, 'success')
        } catch (e) {
            void showAlert('安装失败: ' + e, 'error')
        } finally {
            setInstallingId(null)
        }
    }

    const handleInstallFromFile = async () => {
        const selected = await open({
            multiple: false,
            directory: false,
            title: '选择本地插件包',
            filters: [
                {
                    name: 'FlowCloudAI 插件包',
                    extensions: ['fcplug'],
                },
            ],
        })
        if (!selected || Array.isArray(selected)) return

        setInstallingLocalFile(true)
        try {
            const info = await plugin_install_from_file(selected)
            setLocalPlugins(prev => {
                const exists = prev.some(p => p.id === info.id)
                return exists
                    ? prev.map(p => (p.id === info.id ? info : p))
                    : [...prev, info]
            })
            void showAlert(`${info.name} 安装成功`, 'success')
        } catch (e) {
            void showAlert('本地插件安装失败: ' + e, 'error')
        } finally {
            setInstallingLocalFile(false)
        }
    }

    const handleUploadLocalPlugin = () => {
        setUploadDialogOpen(true)
    }

    const handleUninstall = async (pluginId: string) => {
        const res = await showAlert('确认删除', 'warning', 'confirm')
        if (res !== 'yes') return
        setUninstallingId(pluginId)
        try {
            await plugin_uninstall(pluginId)
            setLocalPlugins(prev => prev.filter(p => p.id !== pluginId))
        } catch (e) {
            void showAlert('卸载失败: ' + e, 'error')
        } finally {
            setUninstallingId(null)
        }
    }

    const installedIds = new Set(localPlugins.map(p => normalizePluginKey(p.id)))
    const localVersionMap = useMemo(
        () => new Map(localPlugins.map(plugin => [normalizePluginKey(plugin.id), plugin.version])),
        [localPlugins],
    )
    const updateVersionMap = useMemo(() => {
        const result = new Map<string, string>()
        const marketPluginMap = new Map(
            marketPlugins.map(plugin => [normalizePluginKey(plugin.id), plugin]),
        )
        for (const localPlugin of localPlugins) {
            const normalizedId = normalizePluginKey(localPlugin.id)
            const remotePlugin = marketPluginMap.get(normalizedId)
            if (!remotePlugin) continue
            if (isRemoteVersionNewer(localPlugin.version, remotePlugin.version)) {
                result.set(normalizedId, remotePlugin.version)
            }
        }
        return result
    }, [localPlugins, marketPlugins])

    const filteredMarket = marketPlugins.filter(p => {
        const matchKind = kindFilter === 'all' || p.kind.includes(kindFilter)
        const q = searchText.trim().toLowerCase()
        const matchSearch = !q || p.name.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)
        return matchKind && matchSearch
    })

    return (
        <RollingBox style={{padding: '1rem'} as CSSProperties} thumbSize="thin">
            <div className="plugins-container">
                <h1 className="plugins-title">插件管理</h1>
                <UploadPlugin
                    open={uploadDialogOpen}
                    onClose={() => setUploadDialogOpen(false)}
                    onUploaded={() => {
                        void loadMarket()
                    }}
                />

                {/* 已安装 */}
                <section className="plugins-section">
                    <div className="plugins-section-header">
                        <h2 className="plugins-section-title">已安装</h2>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingLocal}
                            onClick={loadLocal}
                        >
                            {loadingLocal ? '刷新中…' : '刷新'}
                        </Button>
                    </div>

                    {localError && <div className="plugins-error">{localError}</div>}

                    <div className="plugins-list">
                        {localPlugins.length === 0 && !loadingLocal ? (
                            <div className="plugins-empty">暂无已安装插件</div>
                        ) : (
                            localPlugins.map(plugin => (
                                <LocalPluginCard
                                    key={plugin.id}
                                    plugin={plugin}
                                    updateVersion={updateVersionMap.get(normalizePluginKey(plugin.id))}
                                    onUninstall={handleUninstall}
                                    uninstalling={uninstallingId === plugin.id}
                                />
                            ))
                        )}
                    </div>
                </section>

                {/* 市场 */}
                <section className="plugins-section">
                    <div className="plugins-section-header">
                        <h2 className="plugins-section-title">插件库</h2>
                        <div className="plugins-section-actions">
                            <Button
                                size="sm"
                                disabled={installingLocalFile}
                                onClick={handleInstallFromFile}
                            >
                                {installingLocalFile ? '安装中…' : '安装本地插件'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleUploadLocalPlugin}
                            >
                                上传本地插件
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={loadingMarket}
                                onClick={loadMarket}
                            >
                                {loadingMarket ? '加载中…' : '刷新'}
                            </Button>
                        </div>
                    </div>

                    <div className="plugins-filter-bar">
                        <Input
                            placeholder="搜索名称或作者…"
                            value={searchText}
                            onChange={setSearchText}
                            className="plugins-search"
                        />
                        <div className="plugins-kind-tabs">
                            {(['all', 'llm', 'image', 'tts'] as const).map(k => (
                                <button
                                    key={k}
                                    className={`plugins-kind-tab${kindFilter === k ? ' active' : ''}`}
                                    onClick={() => setKindFilter(k)}
                                >
                                    {k === 'all' ? '全部' : k.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {marketError && <div className="plugins-error">{marketError}</div>}

                    <div className="plugins-list">
                        {filteredMarket.length === 0 && !loadingMarket ? (
                            <div className="plugins-empty">
                                {marketPlugins.length === 0 ? '暂无可用插件' : '无匹配结果'}
                            </div>
                        ) : (
                            filteredMarket.map(plugin => (
                                <MarketPluginCard
                                    key={plugin.id}
                                    plugin={plugin}
                                    installedIds={installedIds}
                                    installedVersion={localVersionMap.get(normalizePluginKey(plugin.id))}
                                    hasUpdate={updateVersionMap.has(normalizePluginKey(plugin.id))}
                                    onInstall={handleInstall}
                                    installing={installingId === plugin.id}
                                />
                            ))
                        )}
                    </div>
                </section>
            </div>
        </RollingBox>
    )
}
