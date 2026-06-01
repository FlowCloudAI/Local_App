import {logger} from '../shared/logger'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    Button,
    type CategoryTreeNode,
    flatToTree,
    Input,
    RollingBox,
    Select,
    Slider,
    TeraEditor,
    type TeraEditorDiagnostic,
    type Theme,
    Tree,
    useAlert,
    useTheme
} from 'flowcloudai-ui'
import {open} from '@tauri-apps/plugin-dialog'
import {appConfigDir} from '@tauri-apps/api/path'
import {listen} from '@tauri-apps/api/event'
import AboutSection from '../features/about/AboutSection'
import ThemeColorPreview from './settings/ThemeColorPreview'
import {
    ai_close_all_sessions,
    ai_get_usage_by_model,
    ai_get_usage_summary,
    type ApiUsageByModel,
    type ApiUsageSummary,
    type AppSettings,
    type DefaultPaths,
    type LlmCompactDetail,
    type LocalPluginInfo,
    open_in_file_manager,
    plugin_install_from_file,
    plugin_list_local,
    plugin_market_install,
    plugin_market_list,
    plugin_uninstall,
    type PluginInfo,
    type RemotePluginInfo,
    setting_delete_api_key,
    setting_get_media_dir,
    setting_get_settings,
    setting_get_settings_bootstrap,
    setting_open_backup_dir,
    setting_set_api_key,
    setting_update_settings,
    template_get,
    template_get_default,
    template_get_effective_path,
    template_get_local_root_dir,
    template_list,
    template_save,
    type TemplateDocument,
    type TemplateMeta,
    type TemplateSaveResult,
    type TemplateValidationError,
} from '../api'
import {LocalPluginCard, MarketPluginCard} from '../features/plugins/PluginCard'
import {buildTtsVoiceOptions, normalizeVoiceIdWithPlugin} from '../features/plugins/ttsVoice'
import UploadPlugin from '../features/plugins/UploadPlugin'
import {CONVERSATION_TEMPERATURE_MAX} from '../features/ai-chat/model/AiControllerTypes'
import '../shared/ui/layout/WorkspaceScaffold.css'
import './Settings.css'

type SettingsTab = 'system' | 'ai' | 'templates' | 'usage' | 'about'
export type SettingsFocusTarget = 'writer-mode'
type PluginKindFilter = 'all' | 'llm' | 'image' | 'tts'
type AiSettingsSection = 'models' | 'permissions' | 'keys' | 'plugins'

type TemplateView = 'list' | 'detail'
type SelectValue = string | number | (string | number)[]

const AI_SETTINGS_SECTIONS: Array<{ value: AiSettingsSection; label: string }> = [
    {value: 'models', label: '模型'},
    {value: 'permissions', label: '权限与工具'},
    {value: 'keys', label: '密钥'},
    {value: 'plugins', label: '插件'},
]

const LLM_COMPACT_DETAIL_OPTIONS: Array<{ value: LlmCompactDetail; label: string }> = [
    {value: 'brief', label: '简略'},
    {value: 'balanced', label: '适中'},
    {value: 'detailed', label: '详细'},
]
const DEFAULT_ENABLED_FREQUENCY_PENALTY = 1.1
const DEFAULT_ENABLED_PRESENCE_PENALTY = 0.5

function normalizeThemeSelectValue(value: SelectValue): Theme {
    const theme = String(Array.isArray(value) ? value[0] ?? 'system' : value)
    if (theme === 'light' || theme === 'dark' || theme === 'system') return theme
    return 'system'
}

function clampNumberValue(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

interface ParsedPluginVersion {
    core: [number, number, number]
    prerelease: string[]
}

interface TemplateTreeRow {
    id: string
    parent_id: string | null
    name: string
    sort_order: number
    template_id?: string
    relative_path?: string

    [key: string]: unknown   // flatToTree(FlatCategory) 要求索引签名
}

const TEMPLATE_GROUP_LABELS: Record<string, string> = {
    sense: '场景',
    contradiction: '矛盾检查',
    context: '上下文',
    formats: '输出格式',
}

const TEMPLATE_GROUP_ORDER = ['sense', 'contradiction', 'context', 'formats']

function normalizePluginKey(value: string): string {
    return value.trim().toLowerCase()
}

function parsePluginVersion(version: string): ParsedPluginVersion | null {
    const trimmed = version.trim().replace(/^[vV]/, '')
    if (!trimmed) return null

    const [withoutBuild] = trimmed.split('+', 1)
    const [corePart, prereleasePart = ''] = withoutBuild.split('-', 2)
    const parts = corePart.split('.')
    if (parts.length === 0 || parts.length > 3) return null
    if (parts.some(part => !/^\d+$/.test(part))) return null

    while (parts.length < 3) {
        parts.push('0')
    }

    return {
        core: [Number(parts[0]), Number(parts[1]), Number(parts[2])],
        prerelease: prereleasePart ? prereleasePart.split('.') : [],
    }
}

function comparePrerelease(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 0
    if (a.length === 0) return 1
    if (b.length === 0) return -1

    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i += 1) {
        const left = a[i]
        const right = b[i]
        if (left == null) return -1
        if (right == null) return 1

        const leftIsNumber = /^\d+$/.test(left)
        const rightIsNumber = /^\d+$/.test(right)
        if (leftIsNumber && rightIsNumber) {
            const diff = Number(left) - Number(right)
            if (diff !== 0) return diff
            continue
        }
        if (leftIsNumber !== rightIsNumber) {
            return leftIsNumber ? -1 : 1
        }
        const diff = left.localeCompare(right)
        if (diff !== 0) return diff
    }
    return 0
}

function isRemoteVersionNewer(current: string, latest: string): boolean {
    const currentVersion = parsePluginVersion(current)
    const latestVersion = parsePluginVersion(latest)
    if (!currentVersion || !latestVersion) return false

    for (let i = 0; i < 3; i += 1) {
        const diff = latestVersion.core[i] - currentVersion.core[i]
        if (diff !== 0) return diff > 0
    }

    return comparePrerelease(latestVersion.prerelease, currentVersion.prerelease) > 0
}

interface SettingsProps {
    onBack?: () => void
    initialTab?: SettingsTab
    initialPluginKind?: PluginKindFilter
    initialFocus?: SettingsFocusTarget | null
    focusRequestId?: number
}

export default function Settings({
                                     onBack,
                                     initialTab = 'system',
                                     initialPluginKind = 'all',
                                     initialFocus = null,
                                     focusRequestId = 0,
                                 }: SettingsProps) {
    const {showAlert} = useAlert()
    const showAlertRef = useRef(showAlert)
    const writerModeFieldRef = useRef<HTMLDivElement>(null)
    const handledFocusRequestIdRef = useRef<number | null>(null)
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
    const [focusedSetting, setFocusedSetting] = useState<SettingsFocusTarget | null>(null)

    useEffect(() => {
        showAlertRef.current = showAlert
    }, [showAlert])

    // ── 系统配置状态 ──
    const [loading, setLoading] = useState(true)
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [mediaDir, setMediaDir] = useState<string>('')
    const [defaultPaths, setDefaultPaths] = useState<DefaultPaths | null>(null)
    const [configDir, setConfigDir] = useState<string>('')
    const settingsSaveSuccessNoticeEnabledRef = useRef(false)

    // ── 模板配置状态 ──
    const [templateMetas, setTemplateMetas] = useState<TemplateMeta[]>([])
    const [templateListLoading, setTemplateListLoading] = useState(false)
    const [templateListError, setTemplateListError] = useState<string | null>(null)
    const [templateView, setTemplateView] = useState<TemplateView>('list')
    const [templateSelectedKey, setTemplateSelectedKey] = useState<string>('')
    const [templateExpandedKeys, setTemplateExpandedKeys] = useState<string[]>([])
    const [templateDocument, setTemplateDocument] = useState<TemplateDocument | null>(null)
    const [templateDocumentLoading, setTemplateDocumentLoading] = useState(false)
    const [templateDraft, setTemplateDraft] = useState('')
    const [templateSaving, setTemplateSaving] = useState(false)
    const [templateRestoring, setTemplateRestoring] = useState(false)
    const [templatePageError, setTemplatePageError] = useState<TemplateValidationError | null>(null)

    // ── AI 配置状态 ──
    const [llmPlugins, setLlmPlugins] = useState<PluginInfo[]>([])
    const [imagePlugins, setImagePlugins] = useState<PluginInfo[]>([])
    const [ttsPlugins, setTtsPlugins] = useState<PluginInfo[]>([])
    const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})
    const [expandedApiKeyPluginId, setExpandedApiKeyPluginId] = useState<string | null>(null)
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [savingApiKeyPluginId, setSavingApiKeyPluginId] = useState<string | null>(null)

    // ── 插件管理状态 ──
    const [localPlugins, setLocalPlugins] = useState<LocalPluginInfo[]>([])
    const [marketPlugins, setMarketPlugins] = useState<RemotePluginInfo[]>([])
    const [loadingLocal, setLoadingLocal] = useState(false)
    const [loadingMarket, setLoadingMarket] = useState(false)
    const [installingLocalFile, setInstallingLocalFile] = useState(false)
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const [marketError, setMarketError] = useState<string | null>(null)
    const [installingIds, setInstallingIds] = useState<Set<string>>(new Set())
    const [uninstallingId, setUninstallingId] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [kindFilter, setKindFilter] = useState<PluginKindFilter>(initialPluginKind)
    const [pluginDirectoryLoaded, setPluginDirectoryLoaded] = useState(false)
    const [aiSettingsSection, setAiSettingsSection] = useState<AiSettingsSection>('models')

    const {setTheme} = useTheme();

    // ── 用量统计状态 ──
    const [usageSummary, setUsageSummary] = useState<ApiUsageSummary | null>(null)
    const [usageByModel, setUsageByModel] = useState<ApiUsageByModel[]>([])
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState<string | null>(null)

    const loadUsageStats = useCallback(async () => {
        setUsageLoading(true)
        setUsageError(null)
        try {
            const [summary, byModel] = await Promise.all([
                ai_get_usage_summary(),
                ai_get_usage_by_model(),
            ])
            setUsageSummary(summary)
            setUsageByModel(byModel)
        } catch (e) {
            setUsageError(String(e))
        } finally {
            setUsageLoading(false)
        }
    }, [])

    useEffect(() => {
        setActiveTab(initialTab)
        if (initialTab === 'ai') {
            setKindFilter(initialPluginKind)
            if (initialPluginKind !== 'all') {
                setAiSettingsSection('plugins')
            }
        }
    }, [initialPluginKind, initialTab])

    useEffect(() => {
        if (loading || !settings || activeTab !== 'ai' || initialFocus !== 'writer-mode') return
        if (handledFocusRequestIdRef.current === focusRequestId) return
        handledFocusRequestIdRef.current = focusRequestId
        setAiSettingsSection('permissions')
        const frameId = window.requestAnimationFrame(() => {
            writerModeFieldRef.current?.scrollIntoView({behavior: 'smooth', block: 'center'})
            setFocusedSetting('writer-mode')
        })
        const timeoutId = window.setTimeout(() => setFocusedSetting(null), 1800)
        return () => {
            window.cancelAnimationFrame(frameId)
            window.clearTimeout(timeoutId)
        }
    }, [activeTab, focusRequestId, initialFocus, loading, settings])

    // 切换到用量统计 tab 时自动加载
    useEffect(() => {
        if (activeTab === 'usage') {
            void loadUsageStats()
        }
    }, [activeTab, loadUsageStats])

    const closeIdleAiSessions = useCallback(async () => {
        try {
            await ai_close_all_sessions()
        } catch (error) {
            logger.error('关闭 AI 会话失败:', error)
        }
    }, [])

    const getPluginsForType = useCallback((type: 'llm' | 'image' | 'tts') => {
        if (type === 'llm') return llmPlugins
        if (type === 'image') return imagePlugins
        return ttsPlugins
    }, [imagePlugins, llmPlugins, ttsPlugins])

    const getPluginById = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        if (!pluginId) return null
        const targetKey = normalizePluginKey(pluginId)
        return getPluginsForType(type).find(plugin => normalizePluginKey(plugin.id) === targetKey) ?? null
    }, [getPluginsForType])

    const resolveDefaultModel = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        const plugin = getPluginById(type, pluginId)
        if (!plugin) return null
        return plugin.default_model ?? plugin.models[0] ?? null
    }, [getPluginById])

    // 初始化加载
    const loadData = useCallback(async (source = 'manual') => {
        try {
            setLoading(true)
            settingsSaveSuccessNoticeEnabledRef.current = false
            const [
                bootstrap,
                configDirData,
            ] = await Promise.all([
                setting_get_settings_bootstrap(),
                appConfigDir(),
            ])

            logger.info('[Settings] 加载设置完成', {
                source,
                theme: bootstrap.settings.theme,
                themeColorRecipeId: bootstrap.settings.theme_color_config?.recipeId ?? null,
                mediaDir: bootstrap.mediaDir,
            })
            setSettings(bootstrap.settings)
            setLlmPlugins(bootstrap.llmPlugins)
            setImagePlugins(bootstrap.imagePlugins)
            setTtsPlugins(bootstrap.ttsPlugins)
            setMediaDir(current => current === bootstrap.mediaDir ? current : bootstrap.mediaDir)
            setDefaultPaths(bootstrap.defaultPaths)
            setConfigDir(configDirData)
            setApiKeyStatus(bootstrap.apiKeyStatus)
        } catch (error) {
            const errStr = String(error)
            logger.error('[Settings] 加载设置失败', {source, error})
            if (!errStr.includes('state not managed')) {
                await showAlertRef.current('加载设置失败: ' + error, 'error')
            }
        } finally {
            setLoading(false)
        }
    }, [])

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

    const refreshPluginConfigState = useCallback(async () => {
        const bootstrap = await setting_get_settings_bootstrap()
        setLlmPlugins(bootstrap.llmPlugins)
        setImagePlugins(bootstrap.imagePlugins)
        setTtsPlugins(bootstrap.ttsPlugins)
        setApiKeyStatus(bootstrap.apiKeyStatus)
    }, [])

    useEffect(() => {
        loadData('mount').catch(logger.error)
    }, [loadData])

    useEffect(() => {
        closeIdleAiSessions().catch(logger.error)
    }, [closeIdleAiSessions])

    // 后端异步初始化完成后重新加载（AiState 在 DB 就绪后才 manage）
    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            logger.info('[Settings] 收到 backend-ready，重新加载设置')
            loadData('backend-ready').catch(logger.error)
        })
        return () => {
            unlisten.then(f => f())
        }
    }, [loadData])

    useEffect(() => {
        if (activeTab !== 'ai' || pluginDirectoryLoaded) return
        setPluginDirectoryLoaded(true)
        loadLocal().catch(logger.error)
        loadMarket().catch(logger.error)
    }, [activeTab, loadLocal, loadMarket, pluginDirectoryLoaded])

    useEffect(() => {
        if (!settings || loading) return

        setSettings(prev => {
            if (!prev) return null

            const normalizeAiConfig = <T extends 'llm' | 'image' | 'tts'>(type: T) => {
                const plugin = getPluginById(type, prev[type].plugin_id)
                if (!plugin) {
                    return prev[type].plugin_id || prev[type].default_model
                        ? {...prev[type], plugin_id: null, default_model: null}
                        : prev[type]
                }

                const currentModel = prev[type].default_model
                const hasCurrentModel = currentModel ? plugin.models.includes(currentModel) : false
                if (hasCurrentModel) return prev[type]

                const nextDefaultModel = resolveDefaultModel(type, prev[type].plugin_id)
                if (currentModel === nextDefaultModel) return prev[type]

                return {
                    ...prev[type],
                    default_model: nextDefaultModel
                }
            }

            const nextLlm = normalizeAiConfig('llm')
            const nextImage = normalizeAiConfig('image')
            const normalizedTts = normalizeAiConfig('tts')
            const ttsPlugin = getPluginById('tts', normalizedTts.plugin_id)
            const nextTtsVoiceId = normalizeVoiceIdWithPlugin(ttsPlugin, normalizedTts.voice_id)
            const nextTts = nextTtsVoiceId === normalizedTts.voice_id
                ? normalizedTts
                : {
                    ...normalizedTts,
                    voice_id: nextTtsVoiceId,
                }
            const changed = nextLlm !== prev.llm || nextImage !== prev.image || nextTts !== prev.tts

            return changed ? {
                ...prev,
                llm: nextLlm,
                image: nextImage,
                tts: nextTts
            } : prev
        })
    }, [getPluginById, loading, resolveDefaultModel, settings])

    // 字体大小变化时实时通知其他组件
    useEffect(() => {
        if (!settings || loading) return
        window.dispatchEvent(new CustomEvent('fc:editor-font-size-change', {
            detail: {fontSize: settings.editor_font_size}
        }))
    }, [settings?.editor_font_size, loading]) // eslint-disable-line react-hooks/exhaustive-deps

    const persistSettings = useCallback(async (nextSettings: AppSettings, showSuccessNotice = true) => {
        try {
            logger.info('[Settings] 准备保存设置', {
                theme: nextSettings.theme,
                themeColorRecipeId: nextSettings.theme_color_config?.recipeId ?? null,
                showSuccessNotice,
            })
            // 新 API 返回迁移摘要字符串（路径变更时自动复制文件），非空则弹窗提示
            const migrationMsg = await setting_update_settings(nextSettings)
            const newMediaDir = await setting_get_media_dir()
            const savedSettings = await setting_get_settings()
            logger.info('[Settings] 设置保存完成', {
                requestTheme: nextSettings.theme,
                savedTheme: savedSettings.theme,
                requestThemeColorRecipeId: nextSettings.theme_color_config?.recipeId ?? null,
                savedThemeColorRecipeId: savedSettings.theme_color_config?.recipeId ?? null,
                migrationMsg,
                newMediaDir,
            })
            window.dispatchEvent(new CustomEvent('fc:settings-updated', {
                detail: savedSettings,
            }))
            setMediaDir(current => current === newMediaDir ? current : newMediaDir)
            const shouldShowSuccessNotice = showSuccessNotice && settingsSaveSuccessNoticeEnabledRef.current
            settingsSaveSuccessNoticeEnabledRef.current = true
            if (migrationMsg) {
                await showAlertRef.current(migrationMsg, 'info', 'toast', 3500)
            } else if (shouldShowSuccessNotice) {
                void showAlertRef.current('设置已保存', 'success', 'nonInvasive', 1200)
            }
        } catch (error) {
            const message = String(error)
            logger.error('设置保存失败:', error)
            void showAlertRef.current(`设置保存失败：${message}`, 'error')
        }
    }, [])

    const handleThemeChange = useCallback((value: SelectValue) => {
        if (!settings) return

        const nextTheme = normalizeThemeSelectValue(value)
        const nextSettings = {...settings, theme: nextTheme}
        logger.info('[Settings] 主题切换', {
            previousTheme: settings.theme,
            nextTheme,
            rawValue: value,
        })
        setSettings(nextSettings)
        setTheme(nextTheme)
        void persistSettings(nextSettings, false)
    }, [persistSettings, setTheme, settings])

    const handleThemeColorConfigChange = useCallback((themeColorConfig: AppSettings['theme_color_config']) => {
        if (!settings) return

        const nextSettings = {...settings, theme_color_config: themeColorConfig}
        logger.info('[Settings] 颜色主题配置变更，立即保存', {
            recipeId: themeColorConfig?.recipeId ?? null,
            tokenCount: themeColorConfig ? Object.keys(themeColorConfig.tokenColors).length : 0,
        })
        setSettings(nextSettings)
        void persistSettings(nextSettings, false)
    }, [persistSettings, settings])

    // 自动保存设置
    useEffect(() => {
        if (!settings || loading) return

        const timer = setTimeout(() => {
            void persistSettings(settings)
        }, 500) // 防抖 500ms

        return () => clearTimeout(timer)
    }, [settings, loading, persistSettings])

    // 重置为默认值
    const handleReset = () => {
        const defaultSettings: AppSettings = {
            media_dir: null,
            db_path: null,
            plugins_path: null,
            theme: 'system',
            language: 'zh-CN',
            editor_font_size: 14,
            theme_color_config: null,
            auto_save_secs: 0,
            auto_backup_secs: 300,
            backup_dir: null,
            max_backup_count: 20,
            default_entry_type: null,
            llm: {
                plugin_id: null,
                default_model: null,
                temperature: 0.7,
                top_p: 0.9,
                frequency_penalty: 0,
                presence_penalty: 0,
                max_tokens: 8192,
                stream: true,
                show_reasoning: false,
                app_sense_custom_prompt: '',
                writer_mode_enabled: false,
                auto_compact_enabled: false,
                auto_compact_threshold_ratio: 0.75,
                auto_compact_recent_messages: 8,
                auto_compact_detail: 'balanced'
            },
            image: {
                plugin_id: null,
                default_model: null
            },
            tts: {
                plugin_id: null,
                default_model: null,
                voice_id: null,
                auto_play: true
            },
            search_engine: 'bing'
        }
        setSettings(defaultSettings)
        void showAlert('已重置为默认设置', 'info')
    }

    // 在系统文件管理器中打开目录
    const handleOpenDir = useCallback((path: string) => {
        if (!path) return
        open_in_file_manager(path).catch((err) => {
            logger.error('打开目录失败', err)
            void showAlert(`打开目录失败：${String(err)}`, 'error', 'toast', 2200)
        })
    }, [showAlert])

    // 选择媒体目录
    const handleSelectMediaDir = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: '选择媒体文件根目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                media_dir: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择数据库目录
    const handleSelectDbPath = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: '选择数据库存储目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                db_path: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择插件目录
    const handleSelectPluginsPath = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: '选择插件存储目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                plugins_path: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择 CSV 自动备份目录
    const handleSelectBackupDir = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: '选择 CSV 自动备份目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                backup_dir: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    const handleOpenBackupDir = useCallback((path: string) => {
        if (!path) return
        setting_open_backup_dir(path).catch((err) => {
            logger.error('打开备份目录失败', err)
            void showAlert(`打开备份目录失败：${String(err)}`, 'error', 'toast', 2200)
        })
    }, [showAlert])

    const handleNumberSettingChange = (
        field: 'auto_backup_secs' | 'max_backup_count',
        value: string,
        fallback: number,
        min: number,
        max: number,
    ) => {
        const parsed = Number(value)
        const nextValue = Number.isFinite(parsed)
            ? Math.min(max, Math.max(min, Math.trunc(parsed)))
            : fallback
        setSettings(prev => prev ? {...prev, [field]: nextValue} : null)
    }

    // AI 配置处理
    const handleAiConfigChange = (
        type: 'llm' | 'image' | 'tts',
        field: 'plugin_id' | 'default_model',
        value: string | null
    ) => {
        setSettings(prev => {
            if (!prev) return null
            const aiConfig = {...prev[type], [field]: value}
            // 如果改变了插件，优先回填插件自身默认模型，再回退到首个模型
            if (field === 'plugin_id') {
                aiConfig.default_model = resolveDefaultModel(type, value)
            }
            return {...prev, [type]: aiConfig}
        })
    }

    const updateLlmDefaults = useCallback((patch: Partial<AppSettings['llm']>) => {
        setSettings(prev => prev ? {
            ...prev,
            llm: {
                ...prev.llm,
                ...patch,
            },
        } : null)
    }, [])

    const handleLlmCompactThresholdChange = useCallback((value: number | number[]) => {
        const rawValue = Array.isArray(value) ? value[0] : value
        const nextValue = Number.isFinite(rawValue) ? rawValue : 75
        updateLlmDefaults({
            auto_compact_threshold_ratio: Math.min(0.95, Math.max(0.5, nextValue / 100)),
        })
    }, [updateLlmDefaults])

    const handleLlmCompactRecentMessagesChange = useCallback((value: string) => {
        const parsed = Number(value)
        updateLlmDefaults({
            auto_compact_recent_messages: Number.isFinite(parsed)
                ? Math.min(30, Math.max(2, Math.trunc(parsed)))
                : 8,
        })
    }, [updateLlmDefaults])

    // API Key 管理
    const handleConfigureApiKey = (pluginId: string) => {
        setExpandedApiKeyPluginId(current => current === pluginId ? null : pluginId)
        setApiKeyDraft('')
    }

    const handleSaveApiKey = async (pluginId: string) => {
        const nextApiKey = apiKeyDraft.trim()
        if (!nextApiKey) {
            void showAlert('请输入 API Key', 'error')
            return
        }

        try {
            setSavingApiKeyPluginId(pluginId)
            await setting_set_api_key(pluginId, nextApiKey)
            setApiKeyStatus(prev => ({...prev, [pluginId]: true}))
            window.dispatchEvent(new CustomEvent('fc:api-key-changed', {detail: {pluginId, hasApiKey: true}}))
            setExpandedApiKeyPluginId(null)
            setApiKeyDraft('')
            void showAlert('API Key 已保存', 'success', 'nonInvasive', 2000)
        } catch (error) {
            void showAlert('保存失败: ' + error, 'error')
        } finally {
            setSavingApiKeyPluginId(null)
        }
    }

    const handleDeleteApiKey = async (pluginId: string) => {
        try {
            await setting_delete_api_key(pluginId)
            setApiKeyStatus(prev => ({...prev, [pluginId]: false}))
            window.dispatchEvent(new CustomEvent('fc:api-key-changed', {detail: {pluginId, hasApiKey: false}}))
            if (expandedApiKeyPluginId === pluginId) {
                setExpandedApiKeyPluginId(null)
                setApiKeyDraft('')
            }
            void showAlert('API Key 已删除', 'success', 'nonInvasive', 2000)
        } catch (error) {
            void showAlert('删除失败: ' + error, 'error')
        }
    }

    // 插件管理操作
    const handleInstall = async (pluginId: string) => {
        setInstallingIds(prev => new Set([...prev, pluginId]))
        try {
            await closeIdleAiSessions()
            const info = await plugin_market_install(pluginId)
            setLocalPlugins(prev => {
                const nextKey = normalizePluginKey(info.id)
                const exists = prev.some(p => normalizePluginKey(p.id) === nextKey)
                return exists
                    ? prev.map(p => (normalizePluginKey(p.id) === nextKey ? info : p))
                    : [...prev, info]
            })
            await refreshPluginConfigState()
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
            void showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 2000)
        } catch (e) {
            void showAlert('安装失败: ' + e, 'error')
        } finally {
            setInstallingIds(prev => {
                const next = new Set(prev)
                next.delete(pluginId)
                return next
            })
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
            await closeIdleAiSessions()
            const info = await plugin_install_from_file(selected)
            setLocalPlugins(prev => {
                const nextKey = normalizePluginKey(info.id)
                const exists = prev.some(p => normalizePluginKey(p.id) === nextKey)
                return exists
                    ? prev.map(p => (normalizePluginKey(p.id) === nextKey ? info : p))
                    : [...prev, info]
            })
            await refreshPluginConfigState()
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
            void showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 2000)
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
            await closeIdleAiSessions()
            await plugin_uninstall(pluginId)
            const removedKey = normalizePluginKey(pluginId)
            setLocalPlugins(prev => prev.filter(p => normalizePluginKey(p.id) !== removedKey))
            await refreshPluginConfigState()
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
        } catch (e) {
            void showAlert('卸载失败: ' + e, 'error')
        } finally {
            setUninstallingId(null)
        }
    }

    const selectedTtsPlugin = useMemo(
        () => getPluginById('tts', settings?.tts.plugin_id ?? null),
        [getPluginById, settings?.tts.plugin_id],
    )

    const loadTemplateList = useCallback(async () => {
        setTemplateListLoading(true)
        setTemplateListError(null)
        try {
            const metas = await template_list()
            setTemplateMetas(metas)
            setTemplateExpandedKeys(prev => {
                if (prev.length > 0) return prev
                return Array.from(new Set(metas.map(meta => `group:${meta.group}`)))
            })
        } catch (error) {
            const message = String(error)
            logger.error('提示词模板目录加载失败:', error)
            setTemplateListError(message)
            void showAlert(`提示词模板目录加载失败：${message}`, 'error', 'toast', 3000)
        } finally {
            setTemplateListLoading(false)
        }
    }, [showAlert])

    useEffect(() => {
        if (
            activeTab === 'templates' &&
            templateMetas.length === 0 &&
            !templateListLoading &&
            !templateListError
        ) {
            loadTemplateList().catch(logger.error)
        }
    }, [activeTab, loadTemplateList, templateListError, templateListLoading, templateMetas.length])

    const templateMetaMap = useMemo(
        () => new Map(templateMetas.map(meta => [meta.id, meta])),
        [templateMetas],
    )

    const templateTreeRows = useMemo<TemplateTreeRow[]>(() => {
        const groupRows = Array.from(new Set(templateMetas.map(meta => meta.group)))
            .sort((a, b) => {
                const indexA = TEMPLATE_GROUP_ORDER.indexOf(a)
                const indexB = TEMPLATE_GROUP_ORDER.indexOf(b)
                const orderA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA
                const orderB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB
                return orderA - orderB || a.localeCompare(b)
            })
            .map((group, index) => ({
                id: `group:${group}`,
                parent_id: null,
                name: TEMPLATE_GROUP_LABELS[group] ?? group,
                sort_order: index,
            }))

        const templateRows = templateMetas.map((meta, index) => ({
            id: meta.id,
            parent_id: `group:${meta.group}`,
            name: meta.title,
            sort_order: index,
            template_id: meta.id,
            relative_path: meta.relative_path,
        }))

        return [...groupRows, ...templateRows]
    }, [templateMetas])

    const templateTreeData = useMemo(
        () => flatToTree(templateTreeRows).roots,
        [templateTreeRows],
    )

    const activeTemplateMeta = useMemo(() => {
        if (templateDocument) return templateDocument.meta
        if (!templateSelectedKey) return null
        return templateMetaMap.get(templateSelectedKey) ?? null
    }, [templateDocument, templateMetaMap, templateSelectedKey])

    const templateIsDirty = templateDocument ? templateDraft !== templateDocument.content : false

    const templateDiagnostics = useMemo<TeraEditorDiagnostic[]>(() => {
        if (!templatePageError?.line || !templatePageError.column) return []
        return [{
            message: templatePageError.raw_message,
            severity: 'error',
            startLineNumber: templatePageError.line,
            startColumn: templatePageError.column,
            endLineNumber: templatePageError.line,
            endColumn: templatePageError.column + 1,
            source: 'tera',
        }]
    }, [templatePageError])

    const openTemplateDetail = useCallback(async (templateId: string) => {
        if (!templateMetaMap.has(templateId)) return
        setTemplateSelectedKey(templateId)
        setTemplateView('detail')
        setTemplateDocumentLoading(true)
        setTemplatePageError(null)

        try {
            const document = await template_get(templateId)
            setTemplateDocument(document)
            setTemplateDraft(document.content)
        } catch (error) {
            setTemplateDocument(null)
            setTemplateDraft('')
            void showAlert('加载提示词模板失败: ' + error, 'error')
        } finally {
            setTemplateDocumentLoading(false)
        }
    }, [showAlert, templateMetaMap])

    const handleTemplateTreeSelect = useCallback((key: string) => {
        if (!templateMetaMap.has(key)) return
        void openTemplateDetail(key)
    }, [openTemplateDetail, templateMetaMap])

    const handleTemplateBack = useCallback(async () => {
        if (templateIsDirty) {
            const result = await showAlert('未保存的更改将丢失，是否继续？', 'warning', 'confirm')
            if (result !== 'yes') return
        }

        setTemplateView('list')
        setTemplateDocument(null)
        setTemplateDraft('')
        setTemplatePageError(null)
        setTemplateDocumentLoading(false)
        setTemplateSelectedKey('')
    }, [showAlert, templateIsDirty])

    const handleTemplateRestore = useCallback(async () => {
        if (!templateDocument) return
        const result = await showAlert(
            '恢复默认内容后，当前所有更改都会丢失，是否继续？',
            'warning',
            'confirm'
        )
        if (result !== 'yes') return

        try {
            setTemplateRestoring(true)
            const defaultContent = await template_get_default(templateDocument.meta.id)
            setTemplateDraft(defaultContent)
            setTemplatePageError(null)
        } catch (error) {
            void showAlert('恢复默认内容失败: ' + error, 'error')
        } finally {
            setTemplateRestoring(false)
        }
    }, [showAlert, templateDocument])

    const handleOpenTemplateRootDir = useCallback(async () => {
        try {
            const path = await template_get_local_root_dir()
            handleOpenDir(path)
        } catch (error) {
            void showAlert('打开提示词模板目录失败: ' + error, 'error')
        }
    }, [handleOpenDir, showAlert])

    const handleOpenTemplateFilePath = useCallback(async () => {
        if (!activeTemplateMeta) return
        try {
            const path = await template_get_effective_path(activeTemplateMeta.id)
            handleOpenDir(path)
        } catch (error) {
            void showAlert('打开提示词模板文件失败: ' + error, 'error')
        }
    }, [activeTemplateMeta, handleOpenDir, showAlert])

    const handleTemplateSave = useCallback(async () => {
        if (!templateDocument) return

        try {
            setTemplateSaving(true)
            setTemplatePageError(null)
            const result: TemplateSaveResult = await template_save(templateDocument.meta.id, templateDraft)

            if (result.status === 'success') {
                setTemplateDocument(result.document)
                setTemplateDraft(result.document.content)
                void showAlert('提示词模板已保存', 'success', 'nonInvasive', 2000)
                return
            }

            if (result.status === 'validation_error') {
                setTemplatePageError(result.error)
                return
            }

            setTemplatePageError({
                message: '保存失败',
                raw_message: result.message,
                line: null,
                column: null,
            })
            void showAlert('保存提示词模板失败: ' + result.message, 'error')
        } catch (error) {
            const message = String(error)
            setTemplatePageError({
                message: '保存失败',
                raw_message: message,
                line: null,
                column: null,
            })
            void showAlert('保存提示词模板失败: ' + message, 'error')
        } finally {
            setTemplateSaving(false)
        }
    }, [showAlert, templateDocument, templateDraft])

    const ttsVoiceOptions = useMemo(
        () => buildTtsVoiceOptions(selectedTtsPlugin, '未选择'),
        [selectedTtsPlugin],
    )

    if (loading || !settings) {
        return (
            <div className="settings-outer">
                <div className="settings-page-layout">
                    <aside className="settings-sidebar">
                        <button
                            className={`settings-sidebar-item ${activeTab === 'system' ? 'active' : ''}`}
                            onClick={() => setActiveTab('system')}
                        >
                            系统配置
                        </button>
                        <button
                            className={`settings-sidebar-item ${activeTab === 'ai' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ai')}
                        >
                            AI配置
                        </button>
                        <button
                            className={`settings-sidebar-item ${activeTab === 'templates' ? 'active' : ''}`}
                            onClick={() => setActiveTab('templates')}
                        >
                            提示词模板
                        </button>
                        <button
                            className={`settings-sidebar-item ${activeTab === 'usage' ? 'active' : ''}`}
                            onClick={() => setActiveTab('usage')}
                        >
                            用量统计
                        </button>
                        <button
                            className={`settings-sidebar-item ${activeTab === 'about' ? 'active' : ''}`}
                            onClick={() => setActiveTab('about')}
                        >
                            关于
                        </button>
                    </aside>
                    <div className="settings-content" style={{padding: '20px'}}>加载中...</div>
                </div>
            </div>
        )
    }

    // 生成 Select 选项
    const themeOptions = [
        {value: 'system', label: '跟随系统'},
        {value: 'light', label: '浅色'},
        {value: 'dark', label: '深色'}
    ]

    const languageOptions = [
        {value: 'zh-CN', label: '简体中文'},
        {value: 'en-US', label: 'English'}
    ]

    const getPluginOptions = (type: 'llm' | 'image' | 'tts') => {
        const plugins = getPluginsForType(type)
        return [
            {value: '', label: '未选择'},
            ...plugins.map(p => ({value: p.id, label: p.name}))
        ]
    }

    const getModelOptions = (type: 'llm' | 'image' | 'tts') => {
        const plugin = getPluginById(type, settings[type].plugin_id)
        if (!plugin) return [{value: '', label: '请先选择插件'}]

        return [
            {value: '', label: '未选择'},
            ...plugin.models.map(m => ({value: m, label: m}))
        ]
    }

    const allPlugins = [...llmPlugins, ...imagePlugins, ...ttsPlugins]
    const installedPluginMap = new Map(localPlugins.map(p => [normalizePluginKey(p.id), p]))
    const installedIds = new Set(installedPluginMap.keys())
    const marketPluginMap = new Map(marketPlugins.map(p => [normalizePluginKey(p.id), p]))
    const effectiveDbDir = settings.db_path || defaultPaths?.db_path || ''
    const derivedBackupDir = effectiveDbDir
        ? `${effectiveDbDir.replace(/[\\/]+$/, '')}${effectiveDbDir.includes('\\') ? '\\' : '/'}backup`
        : defaultPaths?.backup_path || ''
    const effectiveBackupDir = settings.backup_dir || derivedBackupDir

    const filteredMarket = marketPlugins.filter(p => {
        const matchKind = kindFilter === 'all' || p.kind.includes(kindFilter)
        const q = searchText.trim().toLowerCase()
        const matchSearch = !q || p.name.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)
        return matchKind && matchSearch
    })

    return (
        <div className="settings-outer">
            <div className="settings-page-layout">
                <aside className="settings-sidebar">
                    {onBack && (
                        <button
                            type="button"
                            className="settings-back-button"
                            onClick={onBack}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7"/>
                            </svg>
                            <span>返回</span>
                        </button>
                    )}
                    <button
                        className={`settings-sidebar-item ${activeTab === 'system' ? 'active' : ''}`}
                        onClick={() => setActiveTab('system')}
                    >
                        系统配置
                    </button>
                    <button
                        className={`settings-sidebar-item ${activeTab === 'ai' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ai')}
                    >
                        AI配置
                    </button>
                    <button
                        className={`settings-sidebar-item ${activeTab === 'templates' ? 'active' : ''}`}
                        onClick={() => setActiveTab('templates')}
                    >
                        提示词模板
                    </button>
                    <button
                        className={`settings-sidebar-item ${activeTab === 'usage' ? 'active' : ''}`}
                        onClick={() => setActiveTab('usage')}
                    >
                        用量统计
                    </button>
                    <button
                        className={`settings-sidebar-item ${activeTab === 'about' ? 'active' : ''}`}
                        onClick={() => setActiveTab('about')}
                    >
                        关于
                    </button>
                </aside>
                <RollingBox axis="y" className="settings-scroll-area" thumbSize={'thin'}>
                    <div className="settings-content">
                    {activeTab === 'system' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">系统配置</h1>
                                    <p className="fc-page-subtitle">管理存储路径、外观主题和编辑器默认行为。</p>
                                </div>
                            </div>

                            {/* 存储 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">存储</h2>
                                <div className="settings-field">
                                    <label className="settings-label-wide">配置目录</label>
                                    <Input
                                        value={configDir}
                                        readOnly
                                        placeholder="加载中…"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} variant="outline"
                                                onClick={() => handleOpenDir(configDir)}>
                                            打开
                                        </Button>
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">媒体目录</label>
                                    <Input
                                        value={settings.media_dir || mediaDir}
                                        readOnly
                                        placeholder="使用默认目录"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectMediaDir}>浏览</Button>
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">数据库目录</label>
                                    <Input
                                        value={settings.db_path || ''}
                                        readOnly
                                        placeholder="Windows: 程序目录  其他: 系统数据目录"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectDbPath}>浏览</Button>
                                        {settings.db_path && defaultPaths && settings.db_path !== defaultPaths.db_path && (
                                            <Button type="button" size={"sm"} variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, db_path: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">插件目录</label>
                                    <Input
                                        value={settings.plugins_path || ''}
                                        readOnly
                                        placeholder="Windows: 程序目录/plugins  其他: 系统数据目录/plugins"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectPluginsPath}>浏览</Button>
                                        {settings.plugins_path && defaultPaths && settings.plugins_path !== defaultPaths.plugins_path && (
                                            <Button type="button" size={"sm"} variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, plugins_path: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                            </section>

                            {/* 备份 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">备份</h2>
                                <div className="settings-field">
                                    <label className="settings-label-wide">备份目录</label>
                                    <Input
                                        value={effectiveBackupDir}
                                        readOnly
                                        placeholder="数据库目录下的 backup"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size="sm" onClick={handleSelectBackupDir}>浏览</Button>
                                        <Button type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={!effectiveBackupDir}
                                            onClick={() => handleOpenBackupDir(effectiveBackupDir)}
                                        >
                                            打开
                                        </Button>
                                        {settings.backup_dir && (
                                            <Button type="button" size="sm" variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, backup_dir: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="settings-row settings-row--compact">
                                    <div className="settings-field">
                                        <label className="settings-label-wide">自动备份</label>
                                        <input
                                            className="settings-number-input"
                                            type="number"
                                            min={0}
                                            max={86400}
                                            step={30}
                                            value={settings.auto_backup_secs}
                                            onChange={(event) => handleNumberSettingChange(
                                                'auto_backup_secs',
                                                event.target.value,
                                                300,
                                                0,
                                                86400,
                                            )}
                                        />
                                        <span className="settings-span">秒</span>
                                        <span className="settings-field-hint">0 表示关闭</span>
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label-wide">最大备份数量</label>
                                        <input
                                            className="settings-number-input"
                                            type="number"
                                            min={1}
                                            max={999}
                                            step={1}
                                            value={settings.max_backup_count}
                                            onChange={(event) => handleNumberSettingChange(
                                                'max_backup_count',
                                                event.target.value,
                                                20,
                                                1,
                                                999,
                                            )}
                                        />
                                        <span className="settings-field-hint">按时间戳保留最近的备份组</span>
                                    </div>
                                </div>
                            </section>

                            {/* 外观 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">外观</h2>
                                <div className="settings-field">
                                    <label className="settings-label">语言</label>
                                    <Select
                                        options={languageOptions}
                                        value={settings.language}
                                        onChange={(value) => setSettings(prev => prev ? {
                                            ...prev,
                                            language: String(value)
                                        } : null)}
                                        style={{flex: 1}}
                                    />
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label">字体大小</label>
                                    <Slider
                                        min={10}
                                        max={24}
                                        step={1}
                                        value={settings.editor_font_size}
                                        onChange={(value) => setSettings(prev => prev ? {
                                            ...prev,
                                            editor_font_size: value as number
                                        } : null)}
                                        style={{flex: 1}}
                                    />
                                    <span className="settings-span">{settings.editor_font_size}px</span>
                                    {settings.editor_font_size !== 14 && (
                                        <Button type="button" size="sm" variant="outline" style={{marginLeft: 8}} onClick={() =>
                                            setSettings(prev => prev ? {...prev, editor_font_size: 14} : null)
                                        }>恢复默认</Button>
                                    )}
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label">显示模式</label>
                                    <Select
                                        options={themeOptions}
                                        value={settings.theme}
                                        onChange={handleThemeChange}
                                        style={{flex: 1}}
                                    />
                                </div>
                                <ThemeColorPreview
                                    value={settings.theme_color_config}
                                    onChange={handleThemeColorConfigChange}
                                />
                            </section>

                            {/* 操作按钮 */}
                            <div className="settings-footer">
                                <Button type="button" variant="outline" onClick={handleReset}>重置为默认</Button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'about' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">关于</h1>
                                    <p className="fc-page-subtitle">查看应用版本、官方渠道和许可信息。</p>
                                </div>
                            </div>

                            <AboutSection configDir={configDir} onOpenDir={handleOpenDir}/>
                        </div>
                    )}
                    {activeTab === 'ai' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">AI配置</h1>
                                    <p className="fc-page-subtitle">配置默认模型、API Key、插件管理和 AI 工具。</p>
                                </div>
                            </div>

                            <UploadPlugin
                                open={uploadDialogOpen}
                                onClose={() => setUploadDialogOpen(false)}
                                onUploaded={() => {
                                    void loadMarket()
                                }}
                            />

                            <div className="settings-ai-section-tabs" role="tablist" aria-label="AI 配置分区">
                                {AI_SETTINGS_SECTIONS.map((section) => (
                                    <button
                                        key={section.value}
                                        type="button"
                                        role="tab"
                                        aria-selected={aiSettingsSection === section.value}
                                        className={`settings-ai-section-tab ${aiSettingsSection === section.value ? 'active' : ''}`}
                                        onClick={() => setAiSettingsSection(section.value)}
                                    >
                                        {section.label}
                                    </button>
                                ))}
                            </div>

                            {aiSettingsSection === 'models' && (
                                <>
                            {/* 默认模型 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">默认模型</h2>
                                <div className="settings-ai-model-grid">
                                    <div className="settings-ai-model-kind">LLM</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('llm')}
                                                value={settings.llm.plugin_id || ''}
                                                onChange={(value) => handleAiConfigChange('llm', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('llm')}
                                                value={settings.llm.default_model || ''}
                                                onChange={(value) => handleAiConfigChange('llm', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.llm.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-ai-model-extra"/>

                                    <div className="settings-ai-model-kind">图片</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('image')}
                                                value={settings.image.plugin_id || ''}
                                                onChange={(value) => handleAiConfigChange('image', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('image')}
                                                value={settings.image.default_model || ''}
                                                onChange={(value) => handleAiConfigChange('image', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.image.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-ai-model-extra"/>

                                    <div className="settings-ai-model-kind">TTS</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('tts')}
                                                value={settings.tts.plugin_id || ''}
                                                onChange={(value) => handleAiConfigChange('tts', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('tts')}
                                                value={settings.tts.default_model || ''}
                                                onChange={(value) => handleAiConfigChange('tts', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.tts.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">默认音色</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={ttsVoiceOptions}
                                                value={settings.tts.voice_id || ''}
                                                onChange={(value) => setSettings(prev => prev ? {
                                                    ...prev,
                                                    tts: {
                                                        ...prev.tts,
                                                        voice_id: value ? String(value) : null,
                                                    }
                                                } : null)}
                                                disabled={!selectedTtsPlugin || selectedTtsPlugin.supported_voices.length === 0}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* 文本模型配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">文本模型配置</h2>
                                <div className="settings-text-model-grid">
                                    <label className="settings-text-model-field">
                                        <span>温度</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={CONVERSATION_TEMPERATURE_MAX}
                                            step={0.1}
                                            value={settings.llm.temperature}
                                            onChange={(event) => updateLlmDefaults({
                                                temperature: clampNumberValue(
                                                    event.currentTarget.value,
                                                    settings.llm.temperature,
                                                    0,
                                                    CONVERSATION_TEMPERATURE_MAX,
                                                ),
                                            })}
                                        />
                                    </label>
                                    <label className="settings-text-model-field">
                                        <span>top_p</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={settings.llm.top_p}
                                            onChange={(event) => updateLlmDefaults({
                                                top_p: clampNumberValue(event.currentTarget.value, settings.llm.top_p, 0, 1),
                                            })}
                                        />
                                    </label>
                                    <div className="settings-text-model-field settings-text-model-field--penalty">
                                        <label>
                                            <span>重复惩罚</span>
                                            <input
                                                type="checkbox"
                                                checked={settings.llm.frequency_penalty !== 0}
                                                onChange={(event) => updateLlmDefaults({
                                                    frequency_penalty: event.currentTarget.checked
                                                        ? (settings.llm.frequency_penalty || DEFAULT_ENABLED_FREQUENCY_PENALTY)
                                                        : 0,
                                                })}
                                            />
                                        </label>
                                        <input
                                            type="number"
                                            min={-2}
                                            max={2}
                                            step={0.1}
                                            disabled={settings.llm.frequency_penalty === 0}
                                            value={settings.llm.frequency_penalty}
                                            onChange={(event) => updateLlmDefaults({
                                                frequency_penalty: clampNumberValue(event.currentTarget.value, settings.llm.frequency_penalty, -2, 2),
                                            })}
                                        />
                                    </div>
                                    <div className="settings-text-model-field settings-text-model-field--penalty">
                                        <label>
                                            <span>存在惩罚</span>
                                            <input
                                                type="checkbox"
                                                checked={settings.llm.presence_penalty !== 0}
                                                onChange={(event) => updateLlmDefaults({
                                                    presence_penalty: event.currentTarget.checked
                                                        ? (settings.llm.presence_penalty || DEFAULT_ENABLED_PRESENCE_PENALTY)
                                                        : 0,
                                                })}
                                            />
                                        </label>
                                        <input
                                            type="number"
                                            min={-2}
                                            max={2}
                                            step={0.1}
                                            disabled={settings.llm.presence_penalty === 0}
                                            value={settings.llm.presence_penalty}
                                            onChange={(event) => updateLlmDefaults({
                                                presence_penalty: clampNumberValue(event.currentTarget.value, settings.llm.presence_penalty, -2, 2),
                                            })}
                                        />
                                    </div>
                                </div>
                                <div className="settings-field-stack settings-field-stack--full settings-llm-prompt-field">
                                    <label className="settings-label-wide">全局默认提示词</label>
                                    <textarea
                                        className="settings-textarea"
                                        value={settings.llm.app_sense_custom_prompt}
                                        onChange={(event) => updateLlmDefaults({
                                            app_sense_custom_prompt: event.currentTarget.value,
                                        })}
                                        placeholder="例如：保持回答简洁，优先延续当前世界观设定。"
                                    />
                                    <span className="settings-field-hint">
                                        这段提示词会作为通用 AI 对话的默认提示词；当前对话没有独有提示词时会自动填充。
                                    </span>
                                </div>
                            </section>
                                </>
                            )}

                            {/* API Key 管理 */}
                            {aiSettingsSection === 'keys' && (
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">API Key 管理</h2>
                                <div className="settings-row">
                                    {allPlugins.length === 0 ? (
                                        <div className="settings-empty-state">
                                            没有安装插件
                                        </div>
                                    ) : (
                                        allPlugins.map(plugin => {
                                            const isExpanded = expandedApiKeyPluginId === plugin.id
                                            const isSaving = savingApiKeyPluginId === plugin.id

                                            return (
                                                <div
                                                    key={plugin.id}
                                                    className={`settings-api-key-card${isExpanded ? ' is-expanded' : ''}`}
                                                >
                                                    <div className="settings-api-key-item">
                                                        <div className="settings-api-key-meta">
                                                            <span className="settings-api-key-name">{plugin.name}</span>
                                                            <span
                                                                className="settings-api-key-plugin-id">{plugin.id}</span>
                                                        </div>
                                                        <div className="settings-api-key-actions">
                                                            {apiKeyStatus[plugin.id] ? (
                                                                <>
                                                                    <span
                                                                        className="settings-api-key-status">已配置</span>
                                                                    <Button type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleConfigureApiKey(plugin.id)}
                                                                    >
                                                                        重新配置
                                                                    </Button>
                                                                    <Button type="button"
                                                                        variant="danger"
                                                                        size="sm"
                                                                        onClick={() => handleDeleteApiKey(plugin.id)}
                                                                    >
                                                                        删除
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleConfigureApiKey(plugin.id)}
                                                                >
                                                                    配置
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div
                                                        className={`settings-api-key-drawer${isExpanded ? ' is-open' : ''}`}>
                                                        <div className="settings-api-key-drawer-inner">
                                                            <form
                                                                className="settings-api-key-form"
                                                                onSubmit={(event) => {
                                                                    event.preventDefault()
                                                                    void handleSaveApiKey(plugin.id)
                                                                }}
                                                            >
                                                                <label className="settings-api-key-form-label">API
                                                                    Key</label>
                                                                <Input
                                                                    type="password"
                                                                    value={isExpanded ? apiKeyDraft : ''}
                                                                    onValueChange={(value) => setApiKeyDraft(String(value))}
                                                                    placeholder={`请输入 ${plugin.name} 的 API Key`}
                                                                    style={{flex: 1}}
                                                                />
                                                                <div className="settings-api-key-form-actions">
                                                                    <Button type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => {
                                                                            setExpandedApiKeyPluginId(null)
                                                                            setApiKeyDraft('')
                                                                        }}
                                                                        disabled={isSaving}
                                                                    >
                                                                        取消
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        type="submit"
                                                                        disabled={isSaving}
                                                                    >
                                                                        {isSaving ? '保存中...' : '保存'}
                                                                    </Button>
                                                                </div>
                                                            </form>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </section>
                            )}

                            {/* 已安装插件 */}
                            {aiSettingsSection === 'plugins' && (
                                <>
                            <section className="settings-section fc-section-card">
                                <div className="plugins-section-header">
                                    <h2 className="plugins-section-title fc-section-title">已安装插件</h2>
                                    <Button type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={loadingLocal}
                                        onClick={loadLocal}
                                    >
                                        {loadingLocal ? '刷新中…' : '刷新'}
                                    </Button>
                                </div>

                                {localError && <div
                                    className="plugins-error fc-status-banner fc-status-banner--error">{localError}</div>}

                                <div className="plugins-list">
                                    {localPlugins.length === 0 && !loadingLocal ? (
                                        <div className="plugins-empty">暂无已安装插件</div>
                                    ) : (
                                        localPlugins.map(plugin => {
                                            const marketPlugin = marketPluginMap.get(normalizePluginKey(plugin.id))
                                            const updateVersion = marketPlugin
                                            && isRemoteVersionNewer(plugin.version, marketPlugin.version)
                                                ? marketPlugin.version
                                                : undefined
                                            return (
                                                <LocalPluginCard
                                                    key={plugin.id}
                                                    plugin={plugin}
                                                    updateVersion={updateVersion}
                                                    onUninstall={handleUninstall}
                                                    uninstalling={uninstallingId === plugin.id}
                                                />
                                            )
                                        })
                                    )}
                                </div>
                            </section>

                            {/* 插件库 */}
                            <section className="settings-section fc-section-card">
                                <div className="plugins-section-header">
                                    <h2 className="plugins-section-title fc-section-title">插件库</h2>
                                    <div className="plugins-section-actions">
                                        <Button type="button"
                                            size="sm"
                                            disabled={installingLocalFile}
                                            onClick={handleInstallFromFile}
                                        >
                                            {installingLocalFile ? '安装中…' : '安装本地插件'}
                                        </Button>
                                        <Button type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleUploadLocalPlugin}
                                        >
                                            上传本地插件
                                        </Button>
                                        <Button type="button"
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
                                        onValueChange={setSearchText}
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

                                {marketError && <div
                                    className="plugins-error fc-status-banner fc-status-banner--error">{marketError}</div>}

                                <div className="plugins-list">
                                    {filteredMarket.length === 0 && !loadingMarket ? (
                                        <div className="plugins-empty">
                                            {marketPlugins.length === 0 ? '暂无可用插件' : '无匹配结果'}
                                        </div>
                                    ) : (
                                        filteredMarket.map(plugin => {
                                            const installedPlugin = installedPluginMap.get(normalizePluginKey(plugin.id))
                                            const hasUpdate = installedPlugin
                                                ? isRemoteVersionNewer(installedPlugin.version, plugin.version)
                                                : false
                                            return (
                                                <MarketPluginCard
                                                    key={plugin.id}
                                                    plugin={plugin}
                                                    installedIds={installedIds}
                                                    installedVersion={installedPlugin?.version}
                                                    hasUpdate={hasUpdate}
                                                    onInstall={handleInstall}
                                                    installing={installingIds.has(plugin.id)}
                                                />
                                            )
                                        })
                                    )}
                                </div>
                            </section>
                                </>
                            )}

                            {/* AI 工具配置 */}
                            {aiSettingsSection === 'permissions' && (
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">权限与工具</h2>
                                <div
                                    id="settings-ai-writer-mode"
                                    ref={writerModeFieldRef}
                                    className={`settings-field settings-field-stack settings-field-stack--full ${focusedSetting === 'writer-mode' ? 'settings-field--focus-target' : ''}`}
                                >
                                    <label className="settings-checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={settings.llm.writer_mode_enabled}
                                            onChange={(event) => updateLlmDefaults({
                                                writer_mode_enabled: event.target.checked,
                                            })}
                                        />
                                        <span>允许 AI 作家模式</span>
                                    </label>
                                    <span className="settings-field-hint">
                                        作家模式会跳过新建、改写、移动等常规操作确认；删除类操作仍会要求确认。
                                    </span>
                                </div>
                                <div className="settings-field settings-field-stack settings-field-stack--full">
                                    <label className="settings-checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={settings.llm.auto_compact_enabled}
                                            onChange={(event) => updateLlmDefaults({
                                                auto_compact_enabled: event.target.checked,
                                            })}
                                        />
                                        <span>自动压缩上下文</span>
                                    </label>
                                    <span className="settings-field-hint">
                                        本轮回复结束后检测上下文占用，超过阈值时使用当前模型生成会话摘要。
                                    </span>
                                </div>
                                {settings.llm.auto_compact_enabled && (
                                    <div className="settings-row settings-row--compact settings-llm-compact-options">
                                        <div className="settings-field">
                                            <label className="settings-label-wide">压缩阈值</label>
                                            <div className="settings-range-control">
                                                <Slider
                                                    min={50}
                                                    max={95}
                                                    step={5}
                                                    value={Math.round(settings.llm.auto_compact_threshold_ratio * 100)}
                                                    onChange={handleLlmCompactThresholdChange}
                                                />
                                            </div>
                                            <span className="settings-span">
                                                {Math.round(settings.llm.auto_compact_threshold_ratio * 100)}%
                                            </span>
                                        </div>
                                        <div className="settings-field">
                                            <label className="settings-label-wide">保留近期消息</label>
                                            <input
                                                className="settings-number-input"
                                                type="number"
                                                min={2}
                                                max={30}
                                                step={1}
                                                value={settings.llm.auto_compact_recent_messages}
                                                onChange={(event) => handleLlmCompactRecentMessagesChange(event.target.value)}
                                            />
                                            <span className="settings-span">条</span>
                                        </div>
                                        <div className="settings-field">
                                            <label className="settings-label-wide">摘要详细程度</label>
                                            <div className="settings-select-control">
                                                <Select
                                                    options={LLM_COMPACT_DETAIL_OPTIONS}
                                                    value={settings.llm.auto_compact_detail}
                                                    onChange={(value) => updateLlmDefaults({
                                                        auto_compact_detail: String(value) as LlmCompactDetail,
                                                    })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label">搜索引擎</label>
                                        <Select
                                            options={[
                                                {value: 'bing', label: '必应 (Bing)'},
                                                {value: 'baidu', label: '百度 (Baidu)'},
                                                {value: 'duckduckgo', label: 'DuckDuckGo'},
                                            ]}
                                            value={settings.search_engine}
                                            onChange={(value) => setSettings(prev => prev ? {
                                                ...prev,
                                                search_engine: String(value)
                                            } : null)}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                </div>
                            </section>
                            )}
                        </div>
                    )}
                    {activeTab === 'usage' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">用量统计</h1>
                                    <p className="fc-page-subtitle">查看各个模型的 API 调用次数与 Token 消耗。</p>
                                </div>
                            </div>

                            {usageLoading ? (
                                <div className="settings-empty-state">加载中...</div>
                            ) : usageError ? (
                                <div className="settings-empty-state" style={{color: 'var(--fc-color-danger)'}}>
                                    加载失败：{usageError}
                                    <div style={{marginTop: 8}}>
                                        <Button type="button" size="sm" variant="outline" onClick={loadUsageStats}>重试</Button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* 总览卡片 */}
                                    {usageSummary && (
                                        <section className="settings-section fc-section-card">
                                            <h2 className="settings-section-title fc-section-title">总览</h2>
                                            <div className="usage-stats-grid">
                                                <div className="usage-stat-card">
                                                    <div className="usage-stat-value">
                                                        {usageSummary.call_count.toLocaleString()}</div>
                                                    <div className="usage-stat-label">API 调用次数</div>
                                                </div>
                                                <div className="usage-stat-card">
                                                    <div className="usage-stat-value">
                                                        {usageSummary.total_tokens.toLocaleString()}</div>
                                                    <div className="usage-stat-label">总 Token 消耗</div>
                                                </div>
                                                <div className="usage-stat-card">
                                                    <div className="usage-stat-value">
                                                        {usageSummary.total_prompt_tokens.toLocaleString()}</div>
                                                    <div className="usage-stat-label">Prompt Tokens</div>
                                                </div>
                                                <div className="usage-stat-card">
                                                    <div className="usage-stat-value">
                                                        {usageSummary.total_completion_tokens.toLocaleString()}</div>
                                                    <div className="usage-stat-label">Completion Tokens</div>
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {/* 模型明细 */}
                                    <section className="settings-section fc-section-card">
                                        <h2 className="settings-section-title fc-section-title">按模型统计</h2>
                                        {usageByModel.length === 0 ? (
                                            <div className="settings-empty-state">
                                                暂无记录。使用 AI 对话后将自动统计。
                                            </div>
                                        ) : (
                                            <div className="usage-table-wrapper">
                                                <table className="usage-table">
                                                    <thead>
                                                    <tr>
                                                        <th>模型</th>
                                                        <th>供应商</th>
                                                        <th>类型</th>
                                                        <th>调用次数</th>
                                                        <th>Prompt Tokens</th>
                                                        <th>Completion Tokens</th>
                                                        <th>总 Tokens</th>
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                    {usageByModel.map((row, i) => (
                                                        <tr key={i}>
                                                            <td className="usage-model-name">{row.model}</td>
                                                            <td>{row.provider}</td>
                                                            <td>
                                                                <span className={`usage-badge usage-badge--${row.modality}`}>
                                                                    {row.modality === 'llm' ? '对话' :
                                                                        row.modality === 'image' ? '图片' : '语音'}
                                                                </span>
                                                            </td>
                                                            <td>{row.call_count.toLocaleString()}</td>
                                                            <td>{row.prompt_tokens.toLocaleString()}</td>
                                                            <td>{row.completion_tokens.toLocaleString()}</td>
                                                            <td className="usage-total-col">
                                                                {row.total_tokens.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </section>
                                </>
                            )}

                            {/* 刷新按钮 */}
                            {!usageLoading && !usageError && (
                                <div className="settings-row" style={{marginTop: 8}}>
                                    <Button type="button" size="sm" variant="outline" onClick={loadUsageStats}>
                                        刷新数据
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                        {activeTab === 'templates' && (
                            <div className="settings-container fc-page-shell settings-template-shell">
                                <div className="settings-title fc-page-header">
                                    <div className="fc-page-title-block">
                                        <h1 className="fc-page-title">提示词模板</h1>
                                        <p className="fc-page-subtitle">集中管理内置提示词模板，保存后会立即检查语法是否有效。</p>
                                    </div>
                                </div>

                                <div className="templates-workspace">
                                {templateView === 'list' && (
                                    <section className="settings-section fc-section-card templates-catalog-section">
                                        <div className="templates-catalog-header">
                                            <div>
                                                <h2 className="settings-section-title fc-section-title">模板目录</h2>
                                                <p className="templates-catalog-hint">
                                                    共 {templateMetas.length} 个提示词模板，按用途分组展示。
                                                </p>
                                            </div>
                                            <div className="templates-catalog-actions">
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        void handleOpenTemplateRootDir()
                                                    }}
                                                >
                                                    打开本地路径
                                                </Button>
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={templateListLoading}
                                                    onClick={() => {
                                                        loadTemplateList().catch(logger.error)
                                                    }}
                                                >
                                                    {templateListLoading ? '刷新中…' : '刷新'}
                                                </Button>
                                            </div>
                                        </div>

                                        {templateListError ? (
                                            <div className="settings-empty-state"
                                                 style={{color: 'var(--fc-color-danger)'}}>
                                                加载失败：{templateListError}
                                                <div style={{marginTop: 8}}>
                                                    <Button type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            loadTemplateList().catch(logger.error)
                                                        }}
                                                    >
                                                        重试
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : templateListLoading && templateTreeData.length === 0 ? (
                                            <div className="settings-empty-state">加载中...</div>
                                        ) : templateTreeData.length === 0 ? (
                                            <div className="settings-empty-state">暂无可编辑的提示词模板。</div>
                                        ) : (
                                            <div className="templates-tree-shell">
                                                <Tree
                                                    treeData={templateTreeData}
                                                    selectedKey={templateSelectedKey}
                                                    expandedKeys={templateExpandedKeys}
                                                    onExpandedKeysChange={setTemplateExpandedKeys}
                                                    onSelect={handleTemplateTreeSelect}
                                                    searchable
                                                    searchPlaceholder="搜索名称"
                                                    collapseDuration={0.13}
                                                    indentSize={7}
                                                    renderTitle={(node: CategoryTreeNode) => {
                                                        const row = node.raw as TemplateTreeRow
                                                        if (!row.template_id) {
                                                            return (
                                                                <div className="templates-tree-group-title">
                                                                    {row.name}
                                                                </div>
                                                            )
                                                        }
                                                        return (
                                                            <div className="templates-tree-item">
                                                                <div
                                                                    className="templates-tree-item-name">{row.name}</div>
                                                            </div>
                                                        )
                                                    }}
                                                    canDrag={() => false}
                                                    canDrop={() => false}
                                                    canRename={() => false}
                                                    canDelete={() => false}
                                                    canCreate={() => false}
                                                />
                                            </div>
                                        )}
                                    </section>
                                )}

                                {templateView === 'detail' && (
                                    <section className="settings-section fc-section-card templates-detail-section">
                                        <div className="templates-detail-toolbar">
                                            <Button type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    void handleTemplateBack()
                                                }}
                                            >
                                                返回
                                            </Button>
                                            <div className="templates-detail-toolbar-actions">
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!templateDocument}
                                                    onClick={() => {
                                                        void handleOpenTemplateFilePath()
                                                    }}
                                                >
                                                    打开本地路径
                                                </Button>
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!templateDocument || templateRestoring || templateSaving}
                                                    onClick={() => {
                                                        void handleTemplateRestore()
                                                    }}
                                                >
                                                    {templateRestoring ? '恢复中...' : '恢复默认'}
                                                </Button>
                                                <Button type="button"
                                                    size="sm"
                                                    disabled={!templateDocument || !templateIsDirty || templateSaving || templateDocumentLoading}
                                                    onClick={() => {
                                                        void handleTemplateSave()
                                                    }}
                                                >
                                                    {templateSaving ? '保存中...' : '保存'}
                                                </Button>
                                            </div>
                                        </div>

                                        {activeTemplateMeta ? (
                                            <>
                                                <div className="templates-detail-header">
                                                    <div className="templates-detail-heading">
                                                        <div className="templates-detail-topline">
                                                            <div className="templates-detail-caption">当前内容</div>
                                                            <span className="templates-detail-badge">
                                                            {TEMPLATE_GROUP_LABELS[activeTemplateMeta.group] ?? activeTemplateMeta.group}
                                                        </span>
                                                        </div>
                                                        <h2 className="templates-detail-title">{activeTemplateMeta.title}</h2>
                                                        <div className="templates-detail-path">
                                                            {activeTemplateMeta.relative_path}
                                                        </div>
                                                    </div>
                                                </div>

                                                <details className="templates-detail-disclosure">
                                                    <summary className="templates-detail-disclosure-summary">
                                                        <span>用途说明与参数</span>
                                                        <span className="templates-detail-disclosure-meta">
                                                        用于：{activeTemplateMeta.appear_in}
                                                    </span>
                                                        <span className="templates-detail-disclosure-meta">
                                                        参数：{activeTemplateMeta.params.length} 个
                                                    </span>
                                                    </summary>
                                                    <div className="templates-detail-grid">
                                                        <div className="templates-detail-card">
                                                            <div className="templates-detail-label">作用</div>
                                                            <p className="templates-detail-text">{activeTemplateMeta.purpose}</p>
                                                        </div>
                                                        <div className="templates-detail-card">
                                                            <div className="templates-detail-label">用于哪里</div>
                                                            <p className="templates-detail-text">{activeTemplateMeta.appear_in}</p>
                                                        </div>
                                                        <div
                                                            className="templates-detail-card templates-detail-card--params">
                                                            <div className="templates-detail-label">参数</div>
                                                            {activeTemplateMeta.params.length === 0 ? (
                                                                <p className="templates-detail-text">这段内容不依赖额外参数。</p>
                                                            ) : (
                                                                <div className="templates-param-list">
                                                                    {activeTemplateMeta.params.map(param => (
                                                                        <div key={param.name}
                                                                             className="templates-param-item">
                                                                            <div
                                                                                className="templates-param-name">{param.name}</div>
                                                                            <div
                                                                                className="templates-param-desc">{param.description}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>

                                                {templatePageError && (
                                                    <div className="templates-error-panel">
                                                        <div
                                                            className="templates-error-title">{templatePageError.message}</div>
                                                        {(templatePageError.line && templatePageError.column) ? (
                                                            <div className="templates-error-location">
                                                                第 {templatePageError.line} 行，第 {templatePageError.column} 列
                                                            </div>
                                                        ) : null}
                                                        <pre
                                                            className="templates-error-raw">{templatePageError.raw_message}</pre>
                                                    </div>
                                                )}

                                                <div className="templates-editor-shell">
                                                    {templateDocumentLoading && !templateDocument ? (
                                                        <div className="settings-empty-state">加载中...</div>
                                                    ) : !templateDocument ? (
                                                        <div
                                                            className="settings-empty-state">加载失败，请返回目录后重试。</div>
                                                    ) : (
                                                        <>
                                                            <div className="templates-editor-meta">
                                                            <span>
                                                                当前来源：{templateDocument.is_override ? '你的自定义版本' : '系统默认版本'}
                                                            </span>
                                                                <span>
                                                                {templateIsDirty ? '存在未保存更改' : '内容已保存'}
                                                            </span>
                                                            </div>
                                                            <TeraEditor
                                                                value={templateDraft}
                                                                onChange={(value) => {
                                                                    setTemplateDraft(value)
                                                                    if (templatePageError) {
                                                                        setTemplatePageError(null)
                                                                    }
                                                                }}
                                                                height="100%"
                                                                minHeight={0}
                                                                fontSize={settings.editor_font_size}
                                                                lineHeight={24}
                                                                wordWrap="on"
                                                                diagnostics={templateDiagnostics}
                                                                placeholder="请输入提示词模板内容"
                                                                className="templates-editor"
                                                                style={{minHeight: 0}}
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="settings-empty-state">
                                                未找到当前提示词模板信息。
                                            </div>
                                        )}
                                    </section>
                            )}
                                </div>
                        </div>
                    )}
                    </div>
                </RollingBox>
            </div>
        </div>
    )
}
