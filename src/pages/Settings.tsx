import {useCallback, useEffect, useMemo, useState} from 'react'
import {Button, Input, RollingBox, Select, Slider, type Theme, useAlert, useTheme} from 'flowcloudai-ui'
import {open} from '@tauri-apps/plugin-dialog'
import {openUrl} from '@tauri-apps/plugin-opener'
import {appConfigDir} from '@tauri-apps/api/path'
import {getVersion} from '@tauri-apps/api/app'
import {listen} from '@tauri-apps/api/event'
import LicenseModal from '../features/about/LicenseModal'
import {
    ai_close_all_sessions,
    ai_list_plugins,
    type AppSettings,
    type LocalPluginInfo,
    plugin_install_from_file,
    plugin_list_local,
    plugin_market_install,
    plugin_market_list,
    plugin_uninstall,
    type PluginInfo,
    type RemotePluginInfo,
    setting_delete_api_key,
    open_in_file_manager,
    setting_get_default_paths,
    setting_get_media_dir,
    setting_get_settings,
    setting_has_api_key,
    setting_set_api_key,
    setting_update_settings,
    ai_get_usage_summary,
    ai_get_usage_by_model,
    type ApiUsageSummary,
    type ApiUsageByModel,
} from '../api'
import {LocalPluginCard, MarketPluginCard} from '../features/plugins/PluginCard'
import {buildTtsVoiceOptions, normalizeVoiceIdWithPlugin} from '../features/plugins/ttsVoice'
import UploadPlugin from '../features/plugins/UploadPlugin'
import '../shared/ui/layout/WorkspaceScaffold.css'
import './Settings.css'

type SettingsTab = 'system' | 'ai' | 'usage'

interface SettingsProps {
    onBack?: () => void
}

export default function Settings({onBack}: SettingsProps) {
    const {showAlert} = useAlert()
    const [activeTab, setActiveTab] = useState<SettingsTab>('system')

    // ── 系统配置状态 ──
    const [loading, setLoading] = useState(true)
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [mediaDir, setMediaDir] = useState<string>('')
    const [defaultPaths, setDefaultPaths] = useState<{ db_path: string; plugins_path: string } | null>(null)
    const [configDir, setConfigDir] = useState<string>('')
    const [appVersion, setAppVersion] = useState<string>('')
    const [licenseModalOpen, setLicenseModalOpen] = useState(false)

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
    const [kindFilter, setKindFilter] = useState<'all' | 'llm' | 'image' | 'tts'>('all')

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
            console.error('关闭 AI 会话失败:', error)
        }
    }, [])

    const getPluginsForType = useCallback((type: 'llm' | 'image' | 'tts') => {
        if (type === 'llm') return llmPlugins
        if (type === 'image') return imagePlugins
        return ttsPlugins
    }, [imagePlugins, llmPlugins, ttsPlugins])

    const getPluginById = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        if (!pluginId) return null
        return getPluginsForType(type).find(plugin => plugin.id === pluginId) ?? null
    }, [getPluginsForType])

    const resolveDefaultModel = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        const plugin = getPluginById(type, pluginId)
        if (!plugin) return null
        return plugin.default_model ?? plugin.models[0] ?? null
    }, [getPluginById])

    // 初始化加载
    const loadData = useCallback(async () => {
        try {
            setLoading(true)
            const [
                settingsData,
                llmData,
                imageData,
                ttsData,
                mediaDirData,
                defaultPathsData,
                configDirData,
            ] = await Promise.all([
                setting_get_settings(),
                ai_list_plugins('llm'),
                ai_list_plugins('image'),
                ai_list_plugins('tts'),
                setting_get_media_dir(),
                setting_get_default_paths(),
                appConfigDir(),
            ])

            setSettings(settingsData)
            setLlmPlugins(llmData)
            setImagePlugins(imageData)
            setTtsPlugins(ttsData)
            setMediaDir(mediaDirData)
            setDefaultPaths(defaultPathsData)
            setConfigDir(configDirData)

            // 检查每个插件的 API Key 状态
            const allPlugins = [...llmData, ...imageData, ...ttsData]
            const status: Record<string, boolean> = {}
            for (const plugin of allPlugins) {
                status[plugin.id] = await setting_has_api_key(plugin.id)
            }
            setApiKeyStatus(status)
        } catch (error) {
            const errStr = String(error)
            if (!errStr.includes('state not managed')) {
                await showAlert('加载设置失败: ' + error, 'error')
            }
        } finally {
            setLoading(false)
        }
    }, [showAlert])

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
        loadData().catch(console.error)
        loadLocal().catch(console.error)
        loadMarket().catch(console.error)
        getVersion().then(setAppVersion).catch(console.error)
    }, [loadData, loadLocal, loadMarket])

    useEffect(() => {
        closeIdleAiSessions().catch(console.error)
    }, [closeIdleAiSessions])

    // 后端异步初始化完成后重新加载（AiState 在 DB 就绪后才 manage）
    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            loadData().catch(console.error)
            loadLocal().catch(console.error)
            loadMarket().catch(console.error)
        })
        return () => {
            unlisten.then(f => f())
        }
    }, [loadData, loadLocal, loadMarket])

    useEffect(() => {
        if (!settings || loading) return

        setSettings(prev => {
            if (!prev) return null

            const normalizeAiConfig = <T extends 'llm' | 'image' | 'tts'>(type: T) => {
                const plugin = getPluginById(type, prev[type].plugin_id)
                if (!plugin) return prev[type]

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

    // 自动保存设置
    useEffect(() => {
        if (!settings || loading) return

        const timer = setTimeout(async () => {
            try {
                await setting_update_settings(settings)
                const newMediaDir = await setting_get_media_dir()
                setMediaDir(newMediaDir)
            } catch (error) {
                console.error('自动保存失败:', error)
            }
        }, 500) // 防抖 500ms

        return () => clearTimeout(timer)
    }, [settings, loading])

    // 重置为默认值
    const handleReset = () => {
        const defaultSettings: AppSettings = {
            media_dir: null,
            db_path: null,
            plugins_path: null,
            theme: 'system',
            language: 'zh-CN',
            editor_font_size: 14,
            auto_save_secs: 30,
            default_entry_type: null,
            llm: {
                plugin_id: null,
                default_model: null,
                temperature: 0.7,
                max_tokens: 2000,
                stream: true,
                show_reasoning: false
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
    const handleOpenDir = (path: string) => {
        if (!path) return
        open_in_file_manager(path).catch((err) => {
            console.error('打开目录失败', err)
            void showAlert(`打开目录失败：${String(err)}`, 'error', 'toast', 2200)
        })
    }

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
                const exists = prev.some(p => p.id === info.id)
                return exists
                    ? prev.map(p => (p.id === info.id ? info : p))
                    : [...prev, info]
            })
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
                const exists = prev.some(p => p.id === info.id)
                return exists
                    ? prev.map(p => (p.id === info.id ? info : p))
                    : [...prev, info]
            })
            window.dispatchEvent(new CustomEvent('fc:plugins-changed'))
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
            await closeIdleAiSessions()
            await plugin_uninstall(pluginId)
            setLocalPlugins(prev => prev.filter(p => p.id !== pluginId))
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
                            className={`settings-sidebar-item ${activeTab === 'usage' ? 'active' : ''}`}
                            onClick={() => setActiveTab('usage')}
                        >
                            用量统计
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
    const installedIds = new Set(localPlugins.map(p => p.id))

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
                        className={`settings-sidebar-item ${activeTab === 'usage' ? 'active' : ''}`}
                        onClick={() => setActiveTab('usage')}
                    >
                        用量统计
                    </button>
                </aside>
                <RollingBox className="settings-scroll-area" thumbSize={'thin'}>
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
                                        <Button size={"sm"} variant="outline"
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
                                        <Button size={"sm"} onClick={handleSelectMediaDir}>浏览</Button>
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
                                        <Button size={"sm"} onClick={handleSelectDbPath}>浏览</Button>
                                        {settings.db_path && defaultPaths && settings.db_path !== defaultPaths.db_path && (
                                            <Button size={"sm"} variant="outline" onClick={() =>
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
                                        <Button size={"sm"} onClick={handleSelectPluginsPath}>浏览</Button>
                                        {settings.plugins_path && defaultPaths && settings.plugins_path !== defaultPaths.plugins_path && (
                                            <Button size={"sm"} variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, plugins_path: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                            </section>

                            {/* 外观 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">外观</h2>
                                <div className="settings-field">
                                    <label className="settings-label">主题</label>
                                    <Select
                                        options={themeOptions}
                                        value={settings.theme}
                                        onChange={(value) => {
                                            setSettings(prev => prev ? {...prev, theme: String(value)} : null);
                                            setTheme(value as Theme)
                                        }}
                                        style={{flex: 1}}
                                    />
                                </div>
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
                                        <Button size="sm" variant="outline" style={{marginLeft: 8}} onClick={() =>
                                            setSettings(prev => prev ? {...prev, editor_font_size: 14} : null)
                                        }>恢复默认</Button>
                                    )}
                                </div>
                            </section>

                            {/* 关于 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">关于</h2>
                                <div className="settings-field">
                                    <label className="settings-label-wide">当前版本</label>
                                    <span className="settings-about-value">{appVersion || '加载中…'}</span>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">开源协议</label>
                                    <span className="settings-about-value">MIT License</span>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">官网</label>
                                    <button
                                        type="button"
                                        className="settings-about-link"
                                        onClick={() => {
                                            void openUrl('https://www.flowcloudai.cn').catch(console.error)
                                        }}
                                    >
                                        https://www.flowcloudai.cn
                                    </button>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">用户知情同意书</label>
                                    <Button variant="outline" size="sm" onClick={() => setLicenseModalOpen(true)}>
                                        查看
                                    </Button>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">日志目录</label>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!configDir}
                                        onClick={() => handleOpenDir(configDir)}
                                    >
                                        打开
                                    </Button>
                                    <span className="settings-field-hint" style={{marginLeft: '0.5rem'}}>
                                        日志文件 app.log 位于配置目录内（仅 release 构建写入）
                                    </span>
                                </div>
                            </section>

                            {/* 操作按钮 */}
                            <div className="settings-footer">
                                <Button variant="outline" onClick={handleReset}>重置为默认</Button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'ai' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">AI配置</h1>
                                    <p className="fc-page-subtitle">管理插件市场、默认模型、搜索引擎和各插件的 API
                                        Key。</p>
                                </div>
                            </div>

                            <UploadPlugin
                                open={uploadDialogOpen}
                                onClose={() => setUploadDialogOpen(false)}
                                onUploaded={() => {
                                    void loadMarket()
                                }}
                            />

                            {/* 已安装插件 */}
                            <section className="settings-section fc-section-card">
                                <div className="plugins-section-header">
                                    <h2 className="plugins-section-title fc-section-title">已安装</h2>
                                    <Button
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
                                        localPlugins.map(plugin => (
                                            <LocalPluginCard
                                                key={plugin.id}
                                                plugin={plugin}
                                                onUninstall={handleUninstall}
                                                uninstalling={uninstallingId === plugin.id}
                                            />
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* 插件市场 */}
                            <section className="settings-section fc-section-card">
                                <div className="plugins-section-header">
                                    <h2 className="plugins-section-title fc-section-title">插件库</h2>
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

                                {marketError && <div
                                    className="plugins-error fc-status-banner fc-status-banner--error">{marketError}</div>}

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
                                                onInstall={handleInstall}
                                                installing={installingIds.has(plugin.id)}
                                            />
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* LLM 默认配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">LLM 默认配置</h2>
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label">插件</label>
                                        <Select
                                            options={getPluginOptions('llm')}
                                            value={settings.llm.plugin_id || ''}
                                            onChange={(value) => handleAiConfigChange('llm', 'plugin_id', value ? String(value) : null)}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label">模型</label>
                                        <Select
                                            options={getModelOptions('llm')}
                                            value={settings.llm.default_model || ''}
                                            onChange={(value) => handleAiConfigChange('llm', 'default_model', value ? String(value) : null)}
                                            disabled={!settings.llm.plugin_id}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 图片生成默认配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">图片生成默认配置</h2>
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label">插件</label>
                                        <Select
                                            options={getPluginOptions('image')}
                                            value={settings.image.plugin_id || ''}
                                            onChange={(value) => handleAiConfigChange('image', 'plugin_id', value ? String(value) : null)}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label">模型</label>
                                        <Select
                                            options={getModelOptions('image')}
                                            value={settings.image.default_model || ''}
                                            onChange={(value) => handleAiConfigChange('image', 'default_model', value ? String(value) : null)}
                                            disabled={!settings.image.plugin_id}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* TTS 默认配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">TTS 默认配置</h2>
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label">插件</label>
                                        <Select
                                            options={getPluginOptions('tts')}
                                            value={settings.tts.plugin_id || ''}
                                            onChange={(value) => handleAiConfigChange('tts', 'plugin_id', value ? String(value) : null)}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label">模型</label>
                                        <Select
                                            options={getModelOptions('tts')}
                                            value={settings.tts.default_model || ''}
                                            onChange={(value) => handleAiConfigChange('tts', 'default_model', value ? String(value) : null)}
                                            disabled={!settings.tts.plugin_id}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label">默认音色 ID</label>
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
                            </section>

                            {/* AI 工具配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">AI 工具配置</h2>
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

                            {/* API Key 管理 */}
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
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleConfigureApiKey(plugin.id)}
                                                                    >
                                                                        重新配置
                                                                    </Button>
                                                                    <Button
                                                                        variant="danger"
                                                                        size="sm"
                                                                        onClick={() => handleDeleteApiKey(plugin.id)}
                                                                    >
                                                                        删除
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button
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
                                                                    onChange={(value) => setApiKeyDraft(String(value))}
                                                                    placeholder={`请输入 ${plugin.name} 的 API Key`}
                                                                    style={{flex: 1}}
                                                                />
                                                                <div className="settings-api-key-form-actions">
                                                                    <Button
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
                                        <Button size="sm" variant="outline" onClick={loadUsageStats}>重试</Button>
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
                                    <Button size="sm" variant="outline" onClick={loadUsageStats}>
                                        刷新数据
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                    </div>
                </RollingBox>
            </div>
            <LicenseModal open={licenseModalOpen} onClose={() => setLicenseModalOpen(false)}/>
        </div>
    )
}
