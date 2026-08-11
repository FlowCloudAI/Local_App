import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useAlert, useTheme} from 'flowcloudai-ui'
import {
    ai_get_usage_by_model,
    ai_get_usage_daily,
    ai_get_usage_summary,
    exit_app,
    formatApiError,
    get_app_version,
    read_app_log,
    type AppLogSnapshot,
    type AppSettings,
    type ApiUsageByModel,
    type ApiUsageDaily,
    type ApiUsageSummary,
    toApiError,
} from '../../../api'
import {openFileDialog} from '../../../api/dialog'
import {openUrl} from '../../../api/opener'
import {
    deleteAppApiKey,
    saveAppApiKey,
    saveAppSettings,
    useAppSettingsStore,
} from '../../../features/settings/appSettingsStore'
import {resolveApiKeyPluginId} from '../../../features/settings/aiSettingsSelection'
import {
    currentMonthUsageAmount,
    getUsageBudgetWarning,
} from '../../../features/settings/usageCost'
import {
    installLocalPlugin,
    installMarketPlugin,
    refreshLocalPlugins,
    refreshMarketPlugins,
    uninstallPlugin,
    usePluginCatalogStore,
} from '../../../features/settings/pluginCatalogStore'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobilePage, type MobileSettingsPageType} from '../usePageStack'
import MobileSettingsAboutSection from './MobileSettingsAboutSection'
import {
    MobileSettingsAppearanceSection,
    MobileSettingsMenuSection,
    MobileSettingsPluginsSection,
    MobileSettingsUsageSection,
} from './MobileSettingsSections'
import MobileSettingsModelsSection from './MobileSettingsModelsSection'
import {
    MobileSettingsFeedbackSection,
    MobileSettingsPermissionsSection,
    MobileSettingsStorageSection,
    MobileSettingsTemplatesSection,
} from './MobileSettingsAdditionalSections'
import './MobileSettings.css'

interface Props {
    push?: (page: MobilePage) => void
    pop?: () => void
    page?: MobilePage | null
}

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type SettingsSection =
    | 'menu'
    | 'storage'
    | 'plugins'
    | 'models'
    | 'permissions'
    | 'templates'
    | 'appearance'
    | 'usage'
    | 'feedback'
    | 'about'
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

function getSettingsSection(page?: MobilePage | null): SettingsSection {
    switch (page?.type) {
        case 'settingsStorage': return 'storage'
        // 兼容图片等入口的旧深链：访问密钥现归属插件管理。
        case 'settingsAi': return 'plugins'
        case 'settingsPlugins': return 'plugins'
        case 'settingsModels': return 'models'
        case 'settingsPermissions': return 'permissions'
        case 'settingsTemplates': return 'templates'
        case 'settingsAppearance': return 'appearance'
        case 'settingsUsage': return 'usage'
        case 'settingsFeedback': return 'feedback'
        case 'settingsAbout': return 'about'
        default: return 'menu'
    }
}

function getSettingsSectionTitle(section: SettingsSection): string {
    if (section === 'storage') return '存储与备份'
    if (section === 'plugins') return '插件管理'
    if (section === 'models') return '模型管理'
    if (section === 'permissions') return '权限与工具'
    if (section === 'templates') return '指令模板'
    if (section === 'appearance') return '外观'
    if (section === 'usage') return '用量与预算'
    if (section === 'feedback') return '提交反馈'
    if (section === 'about') return '关于'
    return '设置'
}

export default function MobileSettings({push, pop, page}: Props) {
    const {showAlert} = useAlert()
    const {theme, setTheme} = useTheme()
    const appSettingsStore = useAppSettingsStore()
    const pluginCatalog = usePluginCatalogStore()
    const apiKeyPlugins = useMemo(() => [
        ...appSettingsStore.llmPlugins,
        ...appSettingsStore.imagePlugins,
        ...appSettingsStore.ttsPlugins,
    ], [appSettingsStore.imagePlugins, appSettingsStore.llmPlugins, appSettingsStore.ttsPlugins])
    const [selectedApiKeyPlugin, setSelectedApiKeyPlugin] = useState('')
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('unknown')
    const [apiKeyBusy, setApiKeyBusy] = useState(false)
    const localPlugins = pluginCatalog.localPlugins
    const marketPlugins = pluginCatalog.marketPlugins
    const [pluginSearch, setPluginSearch] = useState('')
    const [pluginKindFilter, setPluginKindFilter] = useState<PluginKindFilter>('all')
    const localPluginError = pluginCatalog.localError
    const marketPluginError = pluginCatalog.marketError
    const loadingLocalPlugins = pluginCatalog.loadingLocal
    const loadingMarketPlugins = pluginCatalog.loadingMarket
    const installingLocalFile = pluginCatalog.installingLocalFile
    const installingPluginIds = pluginCatalog.installingIds
    const uninstallingPluginId = pluginCatalog.uninstallingId
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [version, setVersion] = useState('')
    const loading = appSettingsStore.loading && !settings
    const [logViewerOpen, setLogViewerOpen] = useState(false)
    const [logSnapshot, setLogSnapshot] = useState<AppLogSnapshot | null>(null)
    const [logLoading, setLogLoading] = useState(false)
    const [logError, setLogError] = useState('')
    const [usageSummary, setUsageSummary] = useState<ApiUsageSummary | null>(null)
    const [usageByModel, setUsageByModel] = useState<ApiUsageByModel[]>([])
    const [usageDaily, setUsageDaily] = useState<ApiUsageDaily[]>([])
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState('')

    useEffect(() => {
        get_app_version().then(setVersion).catch(() => {
        })
    }, [])

    const refreshPluginInstallSources = useCallback(async () => {
        await Promise.all([refreshLocalPlugins(), refreshMarketPlugins()])
    }, [])

    useEffect(() => {
        void refreshPluginInstallSources()
    }, [refreshPluginInstallSources])

    useEffect(() => {
        const nextSettings = appSettingsStore.settings
        if (!nextSettings) return
        setSettings(nextSettings)
        const requestedPluginId = page?.type === 'settingsAi' ? page.params.pluginId : undefined
        setSelectedApiKeyPlugin(current => resolveApiKeyPluginId(
            requestedPluginId,
            current,
            apiKeyPlugins,
            nextSettings.llm.plugin_id || '',
        ))
    }, [apiKeyPlugins, appSettingsStore.settings, page])

    useEffect(() => {
        if (!selectedApiKeyPlugin) {
            setApiKeyDraft('')
            setApiKeyStatus('unknown')
            return
        }

        setApiKeyDraft('')
        setApiKeyStatus(appSettingsStore.loading
            ? 'checking'
            : appSettingsStore.apiKeyStatus[selectedApiKeyPlugin] ? 'configured' : 'missing')
    }, [appSettingsStore.apiKeyStatus, appSettingsStore.loading, selectedApiKeyPlugin])

    const handleSave = useCallback(async () => {
        if (!settings) return
        const merged: AppSettings = {
            ...settings,
            theme,
        }
        try {
            const saved = await saveAppSettings(merged)
            setSettings(saved.settings)
            await showAlert('设置已保存', 'success', 'nonInvasive', 1500)
        } catch (e) {
            await showAlert(`保存失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3000)
        }
    }, [theme, settings, showAlert])

    const handleSaveApiKey = useCallback(async () => {
        if (!selectedApiKeyPlugin) {
            await showAlert('请先选择插件', 'warning', 'nonInvasive', 1800)
            return
        }
        const nextApiKey = apiKeyDraft.trim()
        if (!nextApiKey) {
            await showAlert('请输入访问密钥', 'warning', 'nonInvasive', 1800)
            return
        }

        try {
            setApiKeyBusy(true)
            await saveAppApiKey(selectedApiKeyPlugin, nextApiKey)
            setApiKeyDraft('')
            setApiKeyStatus('configured')
            await showAlert('访问密钥已保存', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`访问密钥保存失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [apiKeyDraft, selectedApiKeyPlugin, showAlert])

    const handleDeleteApiKey = useCallback(async () => {
        if (!selectedApiKeyPlugin) return
        const result = await showAlert('确认删除当前插件的访问密钥？', 'warning', 'confirm')
        if (result !== 'yes') return

        try {
            setApiKeyBusy(true)
            await deleteAppApiKey(selectedApiKeyPlugin)
            setApiKeyDraft('')
            setApiKeyStatus('missing')
            await showAlert('访问密钥已删除', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`访问密钥删除失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [selectedApiKeyPlugin, showAlert])

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
            void showAlert(`打开文件选择器失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
            return null
        })
        if (!selected || Array.isArray(selected)) return

        try {
            const info = await installLocalPlugin(selected)
            await showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 1800)
        } catch (error) {
            logger.error('[MobileSettings] 本地插件安装失败', error)
            await showAlert(`本地插件安装失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

    const handleInstallMarketPlugin = useCallback(async (pluginId: string) => {
        try {
            const info = await installMarketPlugin(pluginId)
            await showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 1800)
        } catch (error) {
            logger.error('[MobileSettings] 插件安装失败', error)
            await showAlert(`插件安装失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

    const handleUninstallPlugin = useCallback(async (pluginId: string) => {
        const confirmed = await showAlert('确认卸载这个插件吗？', 'warning', 'confirm')
        if (confirmed !== 'yes') return
        try {
            await uninstallPlugin(pluginId)
            await showAlert('插件已卸载', 'success', 'nonInvasive', 1600)
        } catch (error) {
            logger.error('[MobileSettings] 插件卸载失败', error)
            await showAlert(`插件卸载失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

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
            const message = formatApiError(toApiError(error))
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
            await showAlert(`复制日志失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        }
    }, [logSnapshot, showAlert])

    const handleOpenOfficialUrl = useCallback((url: string) => {
        void openUrl(url).catch(error => {
            logger.error('[MobileSettings] 打开官方链接失败', error)
            void showAlert(`打开链接失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        })
    }, [showAlert])

    const handleCopyOfficialEmail = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(OFFICIAL_EMAIL)
            await showAlert('邮箱已复制', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('[MobileSettings] 复制官方邮箱失败', error)
            await showAlert(`复制邮箱失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

    const openSettingsPage = useCallback((type: MobileSettingsPageType) => {
        if (type === 'settingsAi') {
            push?.({type, params: {}})
            return
        }
        push?.({type})
    }, [push])

    const updateSettingsDraft = useCallback((patch: Partial<AppSettings>) => {
        setSettings(current => current ? {...current, ...patch} : current)
    }, [])

    const loadUsageStats = useCallback(async () => {
        setUsageLoading(true)
        setUsageError('')
        try {
            const [summary, byModel, daily] = await Promise.all([
                ai_get_usage_summary(),
                ai_get_usage_by_model(),
                ai_get_usage_daily(),
            ])
            setUsageSummary(summary)
            setUsageByModel(byModel)
            setUsageDaily(daily)
        } catch (error) {
            const message = formatApiError(toApiError(error))
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

    if (loading || !settings) return <div className="mobile-page__loading">加载中…</div>

    const apiKeyPluginOptions = apiKeyPlugins.map(plugin => {
        const kind = getPluginKindFilterValue(plugin.kind)
        const kindLabel = kind === 'image' ? '图片' : kind === 'tts' ? '语音' : '对话'
        return {value: plugin.id, label: `${plugin.name} · ${kindLabel}`}
    })
    const currentPlugin = appSettingsStore.llmPlugins.find(plugin => plugin.id === settings.llm.plugin_id)
    const updateLlmDraft = (patch: Partial<AppSettings['llm']>) => {
        setSettings(current => current ? {...current, llm: {...current.llm, ...patch}} : current)
    }
    const monthlyUsageAmount = currentMonthUsageAmount(usageDaily, settings.llm.monthly_budget_currency)
    const budgetWarning = getUsageBudgetWarning(
        usageDaily,
        settings.llm.monthly_budget_amount,
        settings.llm.monthly_budget_currency,
        settings.llm.budget_warn_ratio,
    )
    const apiKeyStatusLabel = getApiKeyStatusLabel(apiKeyStatus)
    const defaultPluginApiKeyStatusLabel = getApiKeyStatusLabel(!settings.llm.plugin_id
        ? 'unknown'
        : appSettingsStore.loading
            ? 'checking'
            : appSettingsStore.apiKeyStatus[settings.llm.plugin_id] ? 'configured' : 'missing')
    const apiKeyPlaceholder = apiKeyStatus === 'configured'
        ? '已配置，输入新密钥可覆盖'
        : '输入当前插件的访问密钥'
    const searchEngineLabel = settings.search_engine === 'baidu'
        ? '百度'
        : settings.search_engine === 'duckduckgo' ? 'DuckDuckGo' : '必应'
    const budgetSummary = settings.llm.monthly_budget_amount
        ? `月度预算 ${settings.llm.monthly_budget_amount} ${settings.llm.monthly_budget_currency}`
        : 'AI 使用、费用与预算告警'

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
            left={section === 'menu' ? undefined : <MobileTopActionPill actions={[{
                key: 'back',
                label: '返回设置',
                icon: <MobileBackIcon/>,
                onClick: () => pop?.(),
            }]}/>}
            center={<h1 className="mobile-settings-topbar-title">{getSettingsSectionTitle(section)}</h1>}
        />
    )

    if (section === 'menu') {
        const themeLabel = themeOptions.find(option => option.value === theme)?.label ?? '跟随系统'
        return (
            <div key={section} className="mobile-page mobile-settings-page">
                {topBar}
                <MobileSettingsMenuSection
                    themeLabel={themeLabel}
                    localPluginCount={localPlugins.length}
                    currentPluginName={currentPlugin?.name}
                    apiKeyStatusLabel={defaultPluginApiKeyStatusLabel}
                    writerModeEnabled={settings.llm.writer_mode_enabled}
                    searchEngineLabel={searchEngineLabel}
                    budgetSummary={budgetSummary}
                    version={version}
                    onOpenPage={openSettingsPage}
                />
            </div>
        )
    }

    return (
        <div
            key={section}
            className={`mobile-page mobile-settings-page${section === 'plugins' ? ' mobile-settings-page--plugins' : ''}`}
        >
            {topBar}
            {section === 'storage' && (
                <MobileSettingsStorageSection
                    autoBackupSecs={settings.auto_backup_secs}
                    maxBackupCount={settings.max_backup_count}
                    onAutoBackupSecsChange={value => updateSettingsDraft({auto_backup_secs: value})}
                    onMaxBackupCountChange={value => updateSettingsDraft({max_backup_count: value})}
                    onSave={handleSave}
                />
            )}

            {section === 'models' && (
                <MobileSettingsModelsSection
                    settings={settings}
                    llmPlugins={appSettingsStore.llmPlugins}
                    imagePlugins={appSettingsStore.imagePlugins}
                    ttsPlugins={appSettingsStore.ttsPlugins}
                    onChange={setSettings}
                    onSave={handleSave}
                />
            )}

            {section === 'permissions' && (
                <MobileSettingsPermissionsSection
                    writerModeEnabled={settings.llm.writer_mode_enabled}
                    searchEngine={settings.search_engine}
                    searchSources={settings.search_sources}
                    onWriterModeChange={enabled => updateLlmDraft({writer_mode_enabled: enabled})}
                    onSearchEngineChange={search_engine => updateSettingsDraft({search_engine})}
                    onSearchSourceChange={(key, enabled) => updateSettingsDraft({
                        search_sources: {...settings.search_sources, [key]: enabled},
                    })}
                    onSave={handleSave}
                />
            )}

            {section === 'templates' && (
                <MobileSettingsTemplatesSection
                    defaultPrompt={settings.llm.app_sense_custom_prompt}
                    editorFontSize={settings.editor_font_size}
                    onDefaultPromptChange={value => updateLlmDraft({app_sense_custom_prompt: value})}
                    onSaveSettings={handleSave}
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
                    uninstallingPluginId={uninstallingPluginId}
                    selectedApiKeyPlugin={selectedApiKeyPlugin}
                    apiKeyPluginOptions={apiKeyPluginOptions}
                    apiKeyStatus={apiKeyStatus}
                    apiKeyStatusLabel={apiKeyStatusLabel}
                    apiKeyDraft={apiKeyDraft}
                    apiKeyBusy={apiKeyBusy}
                    apiKeyPlaceholder={apiKeyPlaceholder}
                    onPluginSearchChange={setPluginSearch}
                    onPluginKindFilterChange={setPluginKindFilter}
                    getInstalledPlugin={getInstalledPlugin}
                    onRefreshPluginSources={refreshPluginInstallSources}
                    onInstallFromFile={handleInstallFromFile}
                    onInstallMarketPlugin={handleInstallMarketPlugin}
                    onUninstallPlugin={handleUninstallPlugin}
                    onSelectedApiKeyPluginChange={setSelectedApiKeyPlugin}
                    onApiKeyDraftChange={setApiKeyDraft}
                    onSaveApiKey={handleSaveApiKey}
                    onDeleteApiKey={handleDeleteApiKey}
                />
            )}

            {section === 'appearance' && (
                <MobileSettingsAppearanceSection
                    theme={theme}
                    themeOptions={themeOptions}
                    language={settings?.language ?? 'zh-CN'}
                    languageOptions={languageOptions}
                    editorFontSize={settings?.editor_font_size ?? 14}
                    glassEffectEnabled={settings?.shell_acrylic_enabled ?? true}
                    onThemeChange={setTheme}
                    onLanguageChange={language => updateSettingsDraft({language})}
                    onEditorFontSizeChange={fontSize => updateSettingsDraft({editor_font_size: clampEditorFontSize(fontSize)})}
                    onGlassEffectChange={enabled => updateSettingsDraft({shell_acrylic_enabled: enabled})}
                    onSaveSettings={handleSave}
                />
            )}

            {section === 'usage' && (
                <MobileSettingsUsageSection
                    summary={usageSummary}
                    byModel={usageByModel}
                    loading={usageLoading}
                    error={usageError}
                    monthlyUsageAmount={monthlyUsageAmount}
                    budgetCurrency={settings.llm.monthly_budget_currency}
                    budgetWarning={budgetWarning}
                    monthlyBudgetAmount={settings.llm.monthly_budget_amount}
                    budgetWarnRatio={settings.llm.budget_warn_ratio}
                    onMonthlyBudgetAmountChange={value => updateLlmDraft({monthly_budget_amount: value})}
                    onBudgetCurrencyChange={value => updateLlmDraft({monthly_budget_currency: value})}
                    onBudgetWarnRatioChange={value => updateLlmDraft({budget_warn_ratio: value})}
                    onSaveSettings={handleSave}
                    onRefresh={loadUsageStats}
                />
            )}

            {section === 'feedback' && <MobileSettingsFeedbackSection/>}

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
