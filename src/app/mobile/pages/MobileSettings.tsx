import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Input, Select, useAlert, useTheme} from 'flowcloudai-ui'
import {
    ai_close_all_sessions,
    ai_list_plugins,
    exit_app,
    plugin_install_from_file,
    plugin_list_local,
    plugin_market_install,
    plugin_market_list,
    read_app_log,
    setting_delete_api_key,
    setting_get_settings,
    setting_has_api_key,
    setting_set_api_key,
    setting_update_settings,
    type AppLogSnapshot,
    type AppSettings,
    type LocalPluginInfo,
    type PluginInfo,
    type RemotePluginInfo,
} from '../../../api'
import {getVersion} from '@tauri-apps/api/app'
import {open} from '@tauri-apps/plugin-dialog'
import {type MobilePage} from '../usePageStack'
import './MobileSettings.css'

interface Props {
    push?: (page: MobilePage) => void
    page?: MobilePage | null
}

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type SettingsSection = 'menu' | 'ai' | 'plugins' | 'appearance' | 'about'

function getApiKeyStatusLabel(status: ApiKeyStatus): string {
    if (status === 'checking') return '检查中'
    if (status === 'configured') return '已配置'
    if (status === 'missing') return '未配置'
    if (status === 'error') return '检查失败'
    return '未选择'
}

function normalizePluginKey(value: string): string {
    return value.trim().toLowerCase()
}

function getPluginKindLabel(kind: string): string {
    if (kind.includes('image')) return 'IMAGE'
    if (kind.includes('tts')) return 'TTS'
    return 'LLM'
}

function formatUnknownError(error: unknown): string {
    if (error instanceof Error) return error.message || error.name
    if (typeof error === 'string') return error
    try {
        const text = JSON.stringify(error)
        if (text && text !== '{}') return text
    } catch {
        // 失败时回退到 String，避免错误格式化自身中断流程。
    }
    return String(error)
}

function getSettingsSection(page?: MobilePage | null): SettingsSection {
    switch (page?.type) {
        case 'settingsAi': return 'ai'
        case 'settingsPlugins': return 'plugins'
        case 'settingsAppearance': return 'appearance'
        case 'settingsAbout': return 'about'
        default: return 'menu'
    }
}

function ChevronRightIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="mobile-settings-menu-item__icon"
        >
            <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function LogIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M7 4h7l4 4v12H7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M14 4v4h4M10 12h5M10 16h5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function RefreshIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M20 12a8 8 0 0 1-13.66 5.66M4 12A8 8 0 0 1 17.66 6.34"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M20 5v6h-6M4 19v-6h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function CopyIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M8 8h10v10H8zM6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export default function MobileSettings({push, page}: Props) {
    const {showAlert} = useAlert()
    const {theme, setTheme} = useTheme()
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('unknown')
    const [apiKeyBusy, setApiKeyBusy] = useState(false)
    const [localPlugins, setLocalPlugins] = useState<LocalPluginInfo[]>([])
    const [marketPlugins, setMarketPlugins] = useState<RemotePluginInfo[]>([])
    const [localPluginError, setLocalPluginError] = useState<string | null>(null)
    const [marketPluginError, setMarketPluginError] = useState<string | null>(null)
    const [loadingLocalPlugins, setLoadingLocalPlugins] = useState(false)
    const [loadingMarketPlugins, setLoadingMarketPlugins] = useState(false)
    const [installingLocalFile, setInstallingLocalFile] = useState(false)
    const [installingPluginIds, setInstallingPluginIds] = useState<Set<string>>(new Set())
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [version, setVersion] = useState('')
    const [loading, setLoading] = useState(true)
    const [logViewerOpen, setLogViewerOpen] = useState(false)
    const [logSnapshot, setLogSnapshot] = useState<AppLogSnapshot | null>(null)
    const [logLoading, setLogLoading] = useState(false)
    const [logError, setLogError] = useState('')
    const marketLoadSeqRef = useRef(0)
    const pluginRefreshSeqRef = useRef(0)
    const pluginRefreshInFlightRef = useRef(false)

    useEffect(() => {
        getVersion().then(setVersion).catch(() => {
        })
        Promise.all([
            ai_list_plugins('llm'),
            setting_get_settings().catch(() => null),
        ]).then(([plugs, s]) => {
            setPlugins(plugs)
            setSettings(s)
            setSelectedPlugin(current => current || s?.llm?.plugin_id || plugs[0]?.id || '')
        }).catch(logger.error).finally(() => setLoading(false))
    }, [])

    const loadLocalPlugins = useCallback(async () => {
        const startedAt = Date.now()
        logger.info('[MobileSettings] 开始加载本地插件列表')
        setLoadingLocalPlugins(true)
        setLocalPluginError(null)
        try {
            const nextLocalPlugins = await plugin_list_local()
            logger.info('[MobileSettings] 本地插件列表加载成功', {
                count: nextLocalPlugins.length,
                elapsedMs: Date.now() - startedAt,
            })
            setLocalPlugins(nextLocalPlugins)
        } catch (error) {
            const message = formatUnknownError(error)
            logger.error('[MobileSettings] 加载本地插件失败', error)
            setLocalPluginError(message)
        } finally {
            logger.info('[MobileSettings] 本地插件列表加载结束', {
                elapsedMs: Date.now() - startedAt,
            })
            setLoadingLocalPlugins(false)
        }
    }, [])

    const loadMarketPlugins = useCallback(async () => {
        const requestId = marketLoadSeqRef.current + 1
        marketLoadSeqRef.current = requestId
        const startedAt = Date.now()
        logger.info('[MobileSettings] 开始加载插件库列表', {requestId})
        const slowTimer = window.setTimeout(() => {
            logger.warn('[MobileSettings] 插件库列表加载超过 15 秒仍未完成', {
                requestId,
                elapsedMs: Date.now() - startedAt,
            })
        }, 15000)

        setLoadingMarketPlugins(true)
        setMarketPluginError(null)
        try {
            const nextMarketPlugins = await plugin_market_list()
            logger.info('[MobileSettings] 插件库列表加载成功', {
                requestId,
                count: nextMarketPlugins.length,
                elapsedMs: Date.now() - startedAt,
            })
            setMarketPlugins(nextMarketPlugins)
        } catch (error) {
            const message = formatUnknownError(error)
            logger.error('[MobileSettings] 加载插件库失败', {
                requestId,
                elapsedMs: Date.now() - startedAt,
                error: message,
            })
            setMarketPluginError(message)
        } finally {
            window.clearTimeout(slowTimer)
            logger.info('[MobileSettings] 插件库列表加载结束', {
                requestId,
                elapsedMs: Date.now() - startedAt,
            })
            setLoadingMarketPlugins(false)
        }
    }, [])

    const refreshPluginInstallSources = useCallback(async () => {
        if (pluginRefreshInFlightRef.current) {
            logger.warn('[MobileSettings] 已有插件安装来源刷新进行中，跳过重复请求')
            return
        }

        const refreshId = pluginRefreshSeqRef.current + 1
        pluginRefreshSeqRef.current = refreshId
        const startedAt = Date.now()
        pluginRefreshInFlightRef.current = true
        logger.info('[MobileSettings] 开始刷新插件安装来源', {refreshId})
        try {
            await Promise.all([
                loadLocalPlugins(),
                loadMarketPlugins(),
            ])
        } finally {
            pluginRefreshInFlightRef.current = false
            logger.info('[MobileSettings] 插件安装来源刷新结束', {
                refreshId,
                elapsedMs: Date.now() - startedAt,
            })
        }
    }, [loadLocalPlugins, loadMarketPlugins])

    useEffect(() => {
        void refreshPluginInstallSources()
    }, [refreshPluginInstallSources])

    useEffect(() => {
        const plugin = plugins.find(p => p.id === selectedPlugin)
        if (plugin && (!selectedModel || !plugin.models.includes(selectedModel))) {
            setSelectedModel(plugin.default_model ?? plugin.models[0] ?? '')
        }
    }, [selectedPlugin, selectedModel, plugins])

    const refreshLlmPluginSelection = useCallback(async (preferredPluginId?: string) => {
        const [nextPlugins, nextSettings] = await Promise.all([
            ai_list_plugins('llm'),
            setting_get_settings().catch(() => null),
        ])
        setPlugins(nextPlugins)
        if (nextSettings) setSettings(nextSettings)
        setSelectedPlugin(current => {
            const hasCurrent = current && nextPlugins.some(plugin => plugin.id === current)
            if (hasCurrent) return current

            const preferredKey = preferredPluginId ? normalizePluginKey(preferredPluginId) : ''
            const preferredPlugin = preferredKey
                ? nextPlugins.find(plugin => normalizePluginKey(plugin.id) === preferredKey)
                : null
            return preferredPlugin?.id || nextSettings?.llm?.plugin_id || nextPlugins[0]?.id || ''
        })
    }, [])

    const upsertLocalPlugin = useCallback((plugin: LocalPluginInfo) => {
        setLocalPlugins(current => {
            const nextKey = normalizePluginKey(plugin.id)
            const exists = current.some(item => normalizePluginKey(item.id) === nextKey)
            return exists
                ? current.map(item => normalizePluginKey(item.id) === nextKey ? plugin : item)
                : [...current, plugin]
        })
    }, [])

    useEffect(() => {
        if (!selectedPlugin) {
            setApiKeyDraft('')
            setApiKeyStatus('unknown')
            return
        }

        let cancelled = false
        setApiKeyDraft('')
        setApiKeyStatus('checking')

        setting_has_api_key(selectedPlugin)
            .then(hasApiKey => {
                if (cancelled) return
                setApiKeyStatus(hasApiKey ? 'configured' : 'missing')
            })
            .catch(error => {
                logger.error('[MobileSettings] API Key 状态检查失败', error)
                if (!cancelled) setApiKeyStatus('error')
            })

        return () => {
            cancelled = true
        }
    }, [selectedPlugin])

    const handleSave = useCallback(async () => {
        if (!settings) return
        const merged: AppSettings = {
            ...settings,
            theme,
            llm: {
                ...settings.llm,
                plugin_id: selectedPlugin || null,
                default_model: selectedModel || null,
            },
        }
        try {
            await setting_update_settings(merged)
            setSettings(merged)
            window.dispatchEvent(new CustomEvent('fc:settings-updated', {
                detail: merged,
            }))
            await showAlert('设置已保存', 'success', 'nonInvasive', 1500)
        } catch (e) {
            await showAlert(`保存失败：${String(e)}`, 'error', 'toast', 3000)
        }
    }, [selectedPlugin, selectedModel, theme, settings, showAlert])

    const handleSaveApiKey = useCallback(async () => {
        if (!selectedPlugin) {
            await showAlert('请先选择 LLM 插件', 'warning', 'toast', 1800)
            return
        }
        const nextApiKey = apiKeyDraft.trim()
        if (!nextApiKey) {
            await showAlert('请输入 API Key', 'warning', 'toast', 1800)
            return
        }

        try {
            setApiKeyBusy(true)
            await setting_set_api_key(selectedPlugin, nextApiKey)
            setApiKeyDraft('')
            setApiKeyStatus('configured')
            window.dispatchEvent(new CustomEvent('fc:api-key-changed', {
                detail: {pluginId: selectedPlugin, hasApiKey: true},
            }))
            await showAlert('API Key 已保存', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`API Key 保存失败：${String(error)}`, 'error', 'toast', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [apiKeyDraft, selectedPlugin, showAlert])

    const handleDeleteApiKey = useCallback(async () => {
        if (!selectedPlugin) return
        const result = await showAlert('确认删除当前插件的 API Key？', 'warning', 'confirm')
        if (result !== 'yes') return

        try {
            setApiKeyBusy(true)
            await setting_delete_api_key(selectedPlugin)
            setApiKeyDraft('')
            setApiKeyStatus('missing')
            window.dispatchEvent(new CustomEvent('fc:api-key-changed', {
                detail: {pluginId: selectedPlugin, hasApiKey: false},
            }))
            await showAlert('API Key 已删除', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`API Key 删除失败：${String(error)}`, 'error', 'toast', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [selectedPlugin, showAlert])

    const handleInstallFromFile = useCallback(async () => {
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
        }).catch(error => {
            logger.error('[MobileSettings] 打开本地插件选择器失败', error)
            void showAlert(`打开文件选择器失败：${formatUnknownError(error)}`, 'error', 'toast', 3000)
            return null
        })
        if (!selected || Array.isArray(selected)) return

        setInstallingLocalFile(true)
        try {
            await ai_close_all_sessions()
            const info = await plugin_install_from_file(selected)
            upsertLocalPlugin(info)
            await refreshLlmPluginSelection(info.kind.includes('llm') ? info.id : undefined)
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
            await showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 1800)
        } catch (error) {
            logger.error('[MobileSettings] 本地插件安装失败', error)
            await showAlert(`本地插件安装失败：${formatUnknownError(error)}`, 'error', 'toast', 3000)
        } finally {
            setInstallingLocalFile(false)
        }
    }, [refreshLlmPluginSelection, showAlert, upsertLocalPlugin])

    const handleInstallMarketPlugin = useCallback(async (pluginId: string) => {
        setInstallingPluginIds(current => new Set([...current, pluginId]))
        try {
            await ai_close_all_sessions()
            const info = await plugin_market_install(pluginId)
            upsertLocalPlugin(info)
            await refreshLlmPluginSelection(info.kind.includes('llm') ? info.id : undefined)
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
            await showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 1800)
        } catch (error) {
            logger.error('[MobileSettings] 插件安装失败', error)
            await showAlert(`插件安装失败：${formatUnknownError(error)}`, 'error', 'toast', 3000)
        } finally {
            setInstallingPluginIds(current => {
                const next = new Set(current)
                next.delete(pluginId)
                return next
            })
        }
    }, [refreshLlmPluginSelection, showAlert, upsertLocalPlugin])

    const installedPluginMap = useMemo(() => {
        return new Map(localPlugins.map(plugin => [normalizePluginKey(plugin.id), plugin]))
    }, [localPlugins])

    const sortedMarketPlugins = useMemo(() => {
        return [...marketPlugins].sort((a, b) => {
            const aInstalled = installedPluginMap.has(normalizePluginKey(a.id))
            const bInstalled = installedPluginMap.has(normalizePluginKey(b.id))
            if (aInstalled !== bInstalled) return aInstalled ? 1 : -1
            return a.name.localeCompare(b.name, 'zh-CN')
        })
    }, [installedPluginMap, marketPlugins])

    const pluginSourcesRefreshing = loadingLocalPlugins || loadingMarketPlugins

    const handleExit = useCallback(async () => {
        const result = await showAlert('确定要退出应用吗？', 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await exit_app()
        } catch (e) {
            logger.error('退出失败', e)
        }
    }, [showAlert])

    const loadAppLog = useCallback(async () => {
        setLogLoading(true)
        setLogError('')
        try {
            setLogSnapshot(await read_app_log())
        } catch (error) {
            const message = formatUnknownError(error)
            logger.error('[MobileSettings] 读取应用日志失败', error)
            setLogError(message)
            await showAlert(`读取日志失败：${message}`, 'error', 'toast', 3000)
        } finally {
            setLogLoading(false)
        }
    }, [showAlert])

    const handleOpenLogViewer = useCallback(() => {
        setLogViewerOpen(true)
        void loadAppLog()
    }, [loadAppLog])

    const handleCopyLog = useCallback(async () => {
        if (!logSnapshot?.content) return
        try {
            await navigator.clipboard.writeText(logSnapshot.content)
            await showAlert('日志内容已复制', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('[MobileSettings] 复制日志失败', error)
            await showAlert(`复制日志失败：${formatUnknownError(error)}`, 'error', 'toast', 3000)
        }
    }, [logSnapshot, showAlert])

    const openSettingsPage = useCallback((type: string) => {
        push?.({type})
    }, [push])

    if (loading) return <div className="mobile-page__loading">加载中…</div>

    const section = getSettingsSection(page)
    const pluginOptions = plugins.map(p => ({value: p.id, label: p.name}))
    const currentPlugin = plugins.find(p => p.id === selectedPlugin)
    const modelOptions = (currentPlugin?.models ?? []).map(m => ({value: m, label: m}))
    const apiKeyStatusLabel = getApiKeyStatusLabel(apiKeyStatus)
    const apiKeyPlaceholder = apiKeyStatus === 'configured'
        ? '已配置，输入新 Key 可覆盖'
        : '输入当前 LLM 插件的 API Key'

    const themeOptions = [
        {value: 'system', label: '跟随系统'},
        {value: 'light', label: '浅色'},
        {value: 'dark', label: '深色'},
    ]

    if (section === 'menu') {
        const themeLabel = themeOptions.find(option => option.value === theme)?.label ?? '跟随系统'
        const marketSummary = loadingMarketPlugins ? '插件库加载中' : `插件库 ${marketPlugins.length} 个`
        return (
            <div className="mobile-page mobile-settings-page">
                <div className="mobile-settings-menu">
                    <button
                        type="button"
                        className="mobile-settings-menu-item"
                        onClick={() => openSettingsPage('settingsAi')}
                    >
                        <span className="mobile-settings-menu-item__content">
                            <span className="mobile-settings-menu-item__label">AI 设置</span>
                            <span className="mobile-settings-menu-item__summary">
                                {currentPlugin?.name ?? '未选择插件'} · {apiKeyStatusLabel}
                            </span>
                        </span>
                        <ChevronRightIcon/>
                    </button>
                    <button
                        type="button"
                        className="mobile-settings-menu-item"
                        onClick={() => openSettingsPage('settingsPlugins')}
                    >
                        <span className="mobile-settings-menu-item__content">
                            <span className="mobile-settings-menu-item__label">插件安装</span>
                            <span className="mobile-settings-menu-item__summary">
                                已安装 {localPlugins.length} 个 · {marketSummary}
                            </span>
                        </span>
                        <ChevronRightIcon/>
                    </button>
                    <button
                        type="button"
                        className="mobile-settings-menu-item"
                        onClick={() => openSettingsPage('settingsAppearance')}
                    >
                        <span className="mobile-settings-menu-item__content">
                            <span className="mobile-settings-menu-item__label">外观</span>
                            <span className="mobile-settings-menu-item__summary">{themeLabel}</span>
                        </span>
                        <ChevronRightIcon/>
                    </button>
                    <button
                        type="button"
                        className="mobile-settings-menu-item"
                        onClick={() => openSettingsPage('settingsAbout')}
                    >
                        <span className="mobile-settings-menu-item__content">
                            <span className="mobile-settings-menu-item__label">关于</span>
                            <span className="mobile-settings-menu-item__summary">
                                FlowCloudAI 移动端{version ? ` · ${version}` : ''}
                            </span>
                        </span>
                        <ChevronRightIcon/>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="mobile-page mobile-settings-page">
            {section === 'ai' && (
                <div className="mobile-settings-section">
                    <div className="mobile-settings-form-stack">
                        <div>
                            <div className="mobile-settings-field-label">插件</div>
                            <Select
                                value={selectedPlugin}
                                onChange={v => setSelectedPlugin(String(v ?? ''))}
                                options={pluginOptions}
                                placeholder="选择插件"
                            />
                        </div>
                        <div>
                            <div className="mobile-settings-field-label">模型</div>
                            <Select
                                value={selectedModel}
                                onChange={v => setSelectedModel(String(v ?? ''))}
                                options={modelOptions}
                                placeholder="选择模型"
                            />
                        </div>
                        <div className="mobile-settings-api-key">
                            <div className="mobile-settings-api-key__header">
                                <div>
                                    <div className="mobile-settings-field-label">API Key</div>
                                    <div className="mobile-settings-api-key__desc">
                                        仅保存到系统密钥链，不在设置文件中写入明文
                                    </div>
                                </div>
                                <span className={`mobile-settings-api-key__status mobile-settings-api-key__status--${apiKeyStatus}`}>
                                    {apiKeyStatusLabel}
                                </span>
                            </div>
                            <Input
                                type="password"
                                value={apiKeyDraft}
                                onValueChange={setApiKeyDraft}
                                placeholder={apiKeyPlaceholder}
                                disabled={!selectedPlugin || apiKeyBusy}
                                autoComplete="off"
                                className="mobile-settings-api-key__input"
                            />
                            <div className="mobile-settings-api-key__actions">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => void handleSaveApiKey()}
                                    disabled={!selectedPlugin || apiKeyBusy || !apiKeyDraft.trim()}
                                >
                                    {apiKeyBusy ? '处理中…' : '保存 API Key'}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void handleDeleteApiKey()}
                                    disabled={!selectedPlugin || apiKeyBusy || apiKeyStatus !== 'configured'}
                                >
                                    删除
                                </Button>
                            </div>
                        </div>
                        <Button type="button" onClick={handleSave} className="mobile-settings-full-button">
                            保存设置
                        </Button>
                    </div>
                </div>
            )}

            {section === 'plugins' && (
                <div className="mobile-settings-section">
                    <div className="mobile-settings-section__header">
                        <div className="mobile-settings-plugin-count">已安装 {localPlugins.length} 个</div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void refreshPluginInstallSources()}
                            disabled={pluginSourcesRefreshing}
                        >
                            {pluginSourcesRefreshing ? '刷新中…' : '刷新'}
                        </Button>
                    </div>
                    <div className="mobile-settings-plugin-actions">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handleInstallFromFile()}
                            disabled={installingLocalFile}
                        >
                            {installingLocalFile ? '安装中…' : '安装本地插件'}
                        </Button>
                    </div>
                    {localPluginError && (
                        <div className="mobile-settings-plugin-error">本地插件加载失败：{localPluginError}</div>
                    )}
                    {marketPluginError && (
                        <div className="mobile-settings-plugin-error">插件库加载失败：{marketPluginError}</div>
                    )}
                    <div className="mobile-settings-plugin-list">
                        {loadingMarketPlugins ? (
                            <div className="mobile-settings-plugin-empty">正在加载插件库…</div>
                        ) : sortedMarketPlugins.length === 0 ? (
                            <div className="mobile-settings-plugin-empty">暂无可安装插件</div>
                        ) : (
                            sortedMarketPlugins.map(plugin => {
                                const installedPlugin = installedPluginMap.get(normalizePluginKey(plugin.id))
                                const installed = Boolean(installedPlugin)
                                const hasUpdate = installedPlugin ? installedPlugin.version !== plugin.version : false
                                const installing = installingPluginIds.has(plugin.id)
                                const actionDisabled = installing || (installed && !hasUpdate)
                                const actionLabel = installed
                                    ? hasUpdate
                                        ? installing ? '更新中…' : '更新'
                                        : '已安装'
                                    : installing ? '安装中…' : '安装'

                                return (
                                    <div className="mobile-settings-plugin-item" key={plugin.id}>
                                        <div className="mobile-settings-plugin-item__body">
                                            <div className="mobile-settings-plugin-item__title">{plugin.name}</div>
                                            <div className="mobile-settings-plugin-item__meta">
                                                <span>{getPluginKindLabel(plugin.kind)}</span>
                                                <span>v{plugin.version}</span>
                                                <span>{plugin.author}</span>
                                            </div>
                                            {installedPlugin && (
                                                <div className={`mobile-settings-plugin-item__status${hasUpdate ? ' is-update' : ''}`}>
                                                    {hasUpdate
                                                        ? `已安装 v${installedPlugin.version}，可更新`
                                                        : `已安装 v${installedPlugin.version}`}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={installed && !hasUpdate ? 'outline' : 'primary'}
                                            disabled={actionDisabled}
                                            onClick={() => void handleInstallMarketPlugin(plugin.id)}
                                        >
                                            {actionLabel}
                                        </Button>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            )}

            {section === 'appearance' && (
                <div className="mobile-settings-section">
                    <div className="mobile-settings-form-stack">
                        <div>
                            <div className="mobile-settings-field-label">主题</div>
                            <Select
                                value={theme}
                                onChange={v => setTheme(String(v ?? 'system') as 'system' | 'light' | 'dark')}
                                options={themeOptions}
                                placeholder="选择主题"
                            />
                        </div>
                        <Button type="button" onClick={handleSave} className="mobile-settings-full-button">
                            保存设置
                        </Button>
                    </div>
                </div>
            )}

            {section === 'about' && (
                <div className="mobile-settings-section">
                    <div className="mobile-settings-about-card">
                        <div className="mobile-settings-about-card__title">FlowCloudAI 移动端</div>
                        {version && <div>版本 {version}</div>}
                    </div>
                    <div className="mobile-settings-about-actions">
                        <div className="mobile-settings-about-action">
                            <div className="mobile-settings-about-action__copy">
                                <span className="mobile-settings-about-action__title">应用日志</span>
                                <span className="mobile-settings-about-action__desc">
                                    查看最近 app.log 内容，用于排查插件安装等运行问题。
                                </span>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleOpenLogViewer}
                            >
                                <span className="mobile-settings-button-content">
                                    <LogIcon/>
                                    查看日志
                                </span>
                            </Button>
                        </div>
                    </div>
                    {logViewerOpen && (
                        <div className="mobile-settings-log-viewer">
                            <div className="mobile-settings-log-viewer__header">
                                <div className="mobile-settings-log-viewer__copy">
                                    <div className="mobile-settings-log-viewer__title">最近日志</div>
                                    <div className="mobile-settings-log-viewer__path">
                                        {logSnapshot?.path || '正在读取日志路径…'}
                                    </div>
                                </div>
                                <div className="mobile-settings-log-viewer__actions">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void loadAppLog()}
                                        disabled={logLoading}
                                    >
                                        <span className="mobile-settings-button-content">
                                            <RefreshIcon/>
                                            {logLoading ? '读取中…' : '刷新'}
                                        </span>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleCopyLog()}
                                        disabled={!logSnapshot?.content}
                                    >
                                        <span className="mobile-settings-button-content">
                                            <CopyIcon/>
                                            复制
                                        </span>
                                    </Button>
                                </div>
                            </div>
                            {logSnapshot?.truncated && (
                                <div className="mobile-settings-log-viewer__notice">
                                    日志较大，仅显示最近 256KB。
                                </div>
                            )}
                            {logError ? (
                                <div className="mobile-settings-log-viewer__error">
                                    读取失败：{logError}
                                </div>
                            ) : (
                                <pre className="mobile-settings-log-viewer__content">{logLoading && !logSnapshot
                                    ? '正在读取日志…'
                                    : logSnapshot?.content || '暂无日志内容'}</pre>
                            )}
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={handleExit}
                        className="mobile-settings-exit-button"
                    >
                        退出应用
                    </Button>
                </div>
            )}
        </div>
    )
}
