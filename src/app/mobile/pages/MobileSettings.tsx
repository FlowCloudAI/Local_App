import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useAlert, useTheme} from 'flowcloudai-ui'
import {
    ai_close_all_sessions,
    ai_get_usage_by_model,
    ai_get_usage_summary,
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
    type ApiUsageByModel,
    type ApiUsageSummary,
    type LocalPluginInfo,
    type PluginInfo,
    type RemotePluginInfo,
} from '../../../api'
import {getVersion} from '@tauri-apps/api/app'
import {openFileDialog} from '../../../api/dialog'
import {openUrl} from '../../../api/opener'
import {MobilePageTopBar, MobileTopIconButton} from '../components/MobileTopControls'
import {type MobilePage, type MobileSettingsPageType} from '../usePageStack'
import MobileSettingsAboutSection from './MobileSettingsAboutSection'
import {
    MobileSettingsAiSection,
    MobileSettingsAppearanceSection,
    MobileSettingsMenuSection,
    MobileSettingsPluginsSection,
    MobileSettingsUsageSection,
} from './MobileSettingsSections'
import './MobileSettings.css'

interface Props {
    push?: (page: MobilePage) => void
    pop?: () => void
    page?: MobilePage | null
}

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type SettingsSection = 'menu' | 'ai' | 'plugins' | 'appearance' | 'usage' | 'about'
type PluginKindFilter = 'all' | 'llm' | 'image' | 'tts'

const OFFICIAL_SITE_URL = 'https://www.flowcloudai.cn'
const OFFICIAL_GITHUB_URL = 'https://github.com/FlowCloudAI/Local_App'
const OFFICIAL_EMAIL = 'flowcloudai@163.com'

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

function getPluginKindFilterValue(kind: string): PluginKindFilter {
    if (kind.includes('image')) return 'image'
    if (kind.includes('tts')) return 'tts'
    return 'llm'
}

function clampEditorFontSize(value: number): number {
    if (!Number.isFinite(value)) return 14
    return Math.min(24, Math.max(10, Math.round(value)))
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
        case 'settingsUsage': return 'usage'
        case 'settingsAbout': return 'about'
        default: return 'menu'
    }
}

function getSettingsSectionTitle(section: SettingsSection): string {
    if (section === 'ai') return 'AI 设置'
    if (section === 'plugins') return '插件安装'
    if (section === 'appearance') return '外观'
    if (section === 'usage') return '用量统计'
    if (section === 'about') return '关于'
    return '设置'
}

function BackIcon() {
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M15 18 9 12l6-6"/>
        </svg>
    )
}

export default function MobileSettings({push, pop, page}: Props) {
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
    const [pluginSearch, setPluginSearch] = useState('')
    const [pluginKindFilter, setPluginKindFilter] = useState<PluginKindFilter>('all')
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
    const [usageSummary, setUsageSummary] = useState<ApiUsageSummary | null>(null)
    const [usageByModel, setUsageByModel] = useState<ApiUsageByModel[]>([])
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState('')
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
            await showAlert(`保存失败：${String(e)}`, 'error', 'nonInvasive', 3000)
        }
    }, [selectedPlugin, selectedModel, theme, settings, showAlert])

    const handleSaveApiKey = useCallback(async () => {
        if (!selectedPlugin) {
            await showAlert('请先选择 LLM 插件', 'warning', 'nonInvasive', 1800)
            return
        }
        const nextApiKey = apiKeyDraft.trim()
        if (!nextApiKey) {
            await showAlert('请输入 API Key', 'warning', 'nonInvasive', 1800)
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
            await showAlert(`API Key 保存失败：${String(error)}`, 'error', 'nonInvasive', 3000)
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
            await showAlert(`API Key 删除失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [selectedPlugin, showAlert])

    const handleInstallFromFile = useCallback(async () => {
        const selected = await openFileDialog({
            multiple: false,
            directory: false,
            title: '选择本地插件包',
            filters: [
                {
                    name: '流云AI 插件包',
                    extensions: ['fcplug'],
                },
            ],
        }).catch(error => {
            logger.error('[MobileSettings] 打开本地插件选择器失败', error)
            void showAlert(`打开文件选择器失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
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
            await showAlert(`本地插件安装失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
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
            await showAlert(`插件安装失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
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

    const sortedLocalPlugins = useMemo(() => {
        return [...localPlugins].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    }, [localPlugins])

    const sortedMarketPlugins = useMemo(() => {
        return [...marketPlugins].sort((a, b) => {
            const aInstalled = installedPluginMap.has(normalizePluginKey(a.id))
            const bInstalled = installedPluginMap.has(normalizePluginKey(b.id))
            if (aInstalled !== bInstalled) return aInstalled ? 1 : -1
            return a.name.localeCompare(b.name, 'zh-CN')
        })
    }, [installedPluginMap, marketPlugins])

    const filteredMarketPlugins = useMemo(() => {
        const keyword = pluginSearch.trim().toLocaleLowerCase('zh-CN')
        return sortedMarketPlugins.filter(plugin => {
            const matchesKind = pluginKindFilter === 'all' || getPluginKindFilterValue(plugin.kind) === pluginKindFilter
            if (!matchesKind) return false
            if (!keyword) return true
            return [plugin.name, plugin.id, plugin.author, plugin.kind]
                .join(' ')
                .toLocaleLowerCase('zh-CN')
                .includes(keyword)
        })
    }, [pluginKindFilter, pluginSearch, sortedMarketPlugins])

    const getInstalledPlugin = useCallback((pluginId: string) => {
        return installedPluginMap.get(normalizePluginKey(pluginId))
    }, [installedPluginMap])

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
            await showAlert(`读取日志失败：${message}`, 'error', 'nonInvasive', 3000)
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
            await showAlert(`复制日志失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [logSnapshot, showAlert])

    const handleOpenOfficialUrl = useCallback((url: string) => {
        void openUrl(url).catch(error => {
            logger.error('[MobileSettings] 打开官方链接失败', error)
            void showAlert(`打开链接失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
        })
    }, [showAlert])

    const handleCopyOfficialEmail = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(OFFICIAL_EMAIL)
            await showAlert('邮箱已复制', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('[MobileSettings] 复制官方邮箱失败', error)
            await showAlert(`复制邮箱失败：${formatUnknownError(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

    const openSettingsPage = useCallback((type: MobileSettingsPageType) => {
        push?.({type})
    }, [push])

    const updateSettingsDraft = useCallback((patch: Partial<AppSettings>) => {
        setSettings(current => current ? {...current, ...patch} : current)
    }, [])

    const loadUsageStats = useCallback(async () => {
        setUsageLoading(true)
        setUsageError('')
        try {
            const [summary, byModel] = await Promise.all([
                ai_get_usage_summary(),
                ai_get_usage_by_model(),
            ])
            setUsageSummary(summary)
            setUsageByModel(byModel)
        } catch (error) {
            const message = formatUnknownError(error)
            logger.error('[MobileSettings] 加载用量统计失败', error)
            setUsageError(message)
        } finally {
            setUsageLoading(false)
        }
    }, [])

    const section = getSettingsSection(page)

    useEffect(() => {
        if (section !== 'usage') return
        void loadUsageStats()
    }, [loadUsageStats, section])

    if (loading) return <div className="mobile-page__loading">加载中…</div>

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
    const languageOptions = [
        {value: 'zh-CN', label: '简体中文'},
        {value: 'en-US', label: 'English'},
    ]
    const topBar = (
        <MobilePageTopBar
            sticky
            edgeToEdge
            ariaLabel="设置页顶栏"
            left={section === 'menu'
                ? <span className="mobile-settings-topbar-spacer" aria-hidden="true"/>
                : <MobileTopIconButton aria-label="返回设置" icon={<BackIcon/>} onClick={pop}/>}
            center={<h1 className="mobile-settings-topbar-title">{getSettingsSectionTitle(section)}</h1>}
            right={<span className="mobile-settings-topbar-spacer" aria-hidden="true"/>}
        />
    )

    if (section === 'menu') {
        const themeLabel = themeOptions.find(option => option.value === theme)?.label ?? '跟随系统'
        const marketSummary = loadingMarketPlugins ? '插件库加载中' : `插件库 ${marketPlugins.length} 个`
        return (
            <div className="mobile-page mobile-settings-page">
                {topBar}
                <MobileSettingsMenuSection
                    themeLabel={themeLabel}
                    marketSummary={marketSummary}
                    localPluginCount={localPlugins.length}
                    currentPluginName={currentPlugin?.name}
                    apiKeyStatusLabel={apiKeyStatusLabel}
                    version={version}
                    onOpenPage={openSettingsPage}
                />
            </div>
        )
    }

    return (
        <div className="mobile-page mobile-settings-page">
            {topBar}
            {section === 'ai' && (
                <MobileSettingsAiSection
                    selectedPlugin={selectedPlugin}
                    selectedModel={selectedModel}
                    pluginOptions={pluginOptions}
                    modelOptions={modelOptions}
                    apiKeyStatus={apiKeyStatus}
                    apiKeyStatusLabel={apiKeyStatusLabel}
                    apiKeyDraft={apiKeyDraft}
                    apiKeyBusy={apiKeyBusy}
                    apiKeyPlaceholder={apiKeyPlaceholder}
                    onSelectedPluginChange={setSelectedPlugin}
                    onSelectedModelChange={setSelectedModel}
                    onApiKeyDraftChange={setApiKeyDraft}
                    onSaveSettings={handleSave}
                    onSaveApiKey={handleSaveApiKey}
                    onDeleteApiKey={handleDeleteApiKey}
                />
            )}

            {section === 'plugins' && (
                <MobileSettingsPluginsSection
                    localPluginCount={localPlugins.length}
                    pluginSourcesRefreshing={pluginSourcesRefreshing}
                    installingLocalFile={installingLocalFile}
                    pluginSearch={pluginSearch}
                    pluginKindFilter={pluginKindFilter}
                    localPluginError={localPluginError}
                    marketPluginError={marketPluginError}
                    loadingMarketPlugins={loadingMarketPlugins}
                    localPlugins={sortedLocalPlugins}
                    marketPlugins={filteredMarketPlugins}
                    installingPluginIds={installingPluginIds}
                    onPluginSearchChange={setPluginSearch}
                    onPluginKindFilterChange={setPluginKindFilter}
                    getInstalledPlugin={getInstalledPlugin}
                    onRefreshPluginSources={refreshPluginInstallSources}
                    onInstallFromFile={handleInstallFromFile}
                    onInstallMarketPlugin={handleInstallMarketPlugin}
                />
            )}

            {section === 'appearance' && (
                <MobileSettingsAppearanceSection
                    theme={theme}
                    themeOptions={themeOptions}
                    language={settings?.language ?? 'zh-CN'}
                    languageOptions={languageOptions}
                    editorFontSize={settings?.editor_font_size ?? 14}
                    onThemeChange={setTheme}
                    onLanguageChange={language => updateSettingsDraft({language})}
                    onEditorFontSizeChange={fontSize => updateSettingsDraft({editor_font_size: clampEditorFontSize(fontSize)})}
                    onSaveSettings={handleSave}
                />
            )}

            {section === 'usage' && (
                <MobileSettingsUsageSection
                    summary={usageSummary}
                    byModel={usageByModel}
                    loading={usageLoading}
                    error={usageError}
                    onRefresh={loadUsageStats}
                />
            )}

            {section === 'about' && (
                <MobileSettingsAboutSection
                    version={version}
                    logViewerOpen={logViewerOpen}
                    logSnapshot={logSnapshot}
                    logLoading={logLoading}
                    logError={logError}
                    onOpenLogViewer={handleOpenLogViewer}
                    onLoadAppLog={loadAppLog}
                    onCopyLog={handleCopyLog}
                    officialSiteUrl={OFFICIAL_SITE_URL}
                    officialGithubUrl={OFFICIAL_GITHUB_URL}
                    officialEmail={OFFICIAL_EMAIL}
                    onOpenOfficialUrl={handleOpenOfficialUrl}
                    onCopyOfficialEmail={handleCopyOfficialEmail}
                    onExit={handleExit}
                />
            )}
        </div>
    )
}
