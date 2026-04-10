import {useState, useEffect, useCallback, type CSSProperties} from 'react'
import {
    Button,
    Input, RollingBox,
    Select,
    Slider, type Theme,
    useAlert
} from 'flowcloudai-ui'
import {open} from '@tauri-apps/plugin-dialog'
import {useTheme} from "flowcloudai-ui";
import {
    ai_list_plugins,
    setting_get_settings,
    setting_update_settings,
    setting_get_media_dir,
    setting_get_default_paths,
    setting_set_api_key,
    setting_has_api_key,
    setting_delete_api_key,
    type PluginInfo,
    type AppSettings
} from '../api'
import './Settings.css'

// 内置词条类型（来自 worldflow_core::models::entry_type::BUILTIN_ENTRY_TYPES）
const BUILTIN_ENTRY_TYPES = ['note', 'task', 'event', 'contact']

export default function Settings() {
    const {showAlert} = useAlert()
    const [loading, setLoading] = useState(true)
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [llmPlugins, setLlmPlugins] = useState<PluginInfo[]>([])
    const [imagePlugins, setImagePlugins] = useState<PluginInfo[]>([])
    const [ttsPlugins, setTtsPlugins] = useState<PluginInfo[]>([])
    const [mediaDir, setMediaDir] = useState<string>('')
    const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})
    const [expandedApiKeyPluginId, setExpandedApiKeyPluginId] = useState<string | null>(null)
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [savingApiKeyPluginId, setSavingApiKeyPluginId] = useState<string | null>(null)
    const [defaultPaths, setDefaultPaths] = useState<{ db_path: string; plugins_path: string } | null>(null)

    const {setTheme} = useTheme();

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
            const [settingsData, llmData, imageData, ttsData, mediaDirData, defaultPathsData] = await Promise.all([
                setting_get_settings(),
                ai_list_plugins('llm'),
                ai_list_plugins('image'),
                ai_list_plugins('tts'),
                setting_get_media_dir(),
                setting_get_default_paths()
            ])

            setSettings(settingsData)
            setLlmPlugins(llmData)
            setImagePlugins(imageData)
            setTtsPlugins(ttsData)
            setMediaDir(mediaDirData)
            setDefaultPaths(defaultPathsData)

            // 检查每个插件的 API Key 状态
            const allPlugins = [...llmData, ...imageData, ...ttsData]
            const status: Record<string, boolean> = {}
            for (const plugin of allPlugins) {
                status[plugin.id] = await setting_has_api_key(plugin.id)
            }
            setApiKeyStatus(status)
        } catch (error) {
            await showAlert('加载设置失败: ' + error, 'error')
        } finally {
            setLoading(false)
        }
    }, [showAlert])

    useEffect(() => {
        loadData().catch(console.error)
    }, [loadData])

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
            const nextTts = normalizeAiConfig('tts')
            const changed = nextLlm !== prev.llm || nextImage !== prev.image || nextTts !== prev.tts

            return changed ? {
                ...prev,
                llm: nextLlm,
                image: nextImage,
                tts: nextTts
            } : prev
        })
    }, [getPluginById, loading, resolveDefaultModel, settings])

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
            }
        }
        setSettings(defaultSettings)
        void showAlert('已重置为默认设置', 'info')
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

    // 自动保存间隔处理（分钟 ↔ 秒）
    const handleAutoSaveChange = (value: string) => {
        const minutes = Number(value)
        if (!isNaN(minutes) && minutes >= 0) {
            setSettings(prev => prev ? {
                ...prev,
                auto_save_secs: Math.round(minutes * 60)
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
            void showAlert('API Key 已保存', 'success')
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
            void showAlert('API Key 已删除', 'success')
        } catch (error) {
            void showAlert('删除失败: ' + error, 'error')
        }
    }

    if (loading || !settings) {
        return <div style={{padding: '20px'}}>加载中...</div>
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

    const entryTypeOptions = [
        {value: '', label: '无默认'},
        ...BUILTIN_ENTRY_TYPES.map(type => ({value: type, label: type}))
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

    return (
        <RollingBox style={{padding: '1rem'} as CSSProperties} thumbSize="thin">
            <div className="settings-container">
                <h1 className="settings-title">设置</h1>

                {/* 存储 */}
                <section className="settings-section">
                    <h2 className="settings-section-title">存储</h2>
                    <div className="settings-field">
                        <label className="settings-label-wide">媒体目录</label>
                        <Input
                            value={settings.media_dir || mediaDir}
                            readOnly
                            placeholder="使用默认目录"
                            style={{flex: 1}}
                        />
                        <Button size={"sm"} onClick={handleSelectMediaDir}>浏览</Button>
                    </div>
                    <div className="settings-field">
                        <label className="settings-label-wide">数据库目录</label>
                        <Input
                            value={settings.db_path || ''}
                            readOnly
                            placeholder="Windows: 程序目录  其他: 系统数据目录"
                            style={{flex: 1}}
                        />
                        <Button size={"sm"} onClick={handleSelectDbPath}>浏览</Button>
                        {settings.db_path && defaultPaths && settings.db_path !== defaultPaths.db_path && (
                            <Button size={"sm"} variant="outline" onClick={() =>
                                setSettings(prev => prev ? {...prev, db_path: null} : null)
                            }>重置</Button>
                        )}
                    </div>
                    <div className="settings-field">
                        <label className="settings-label-wide">插件目录</label>
                        <Input
                            value={settings.plugins_path || ''}
                            readOnly
                            placeholder="Windows: 程序目录/plugins  其他: 系统数据目录/plugins"
                            style={{flex: 1}}
                        />
                        <Button size={"sm"} onClick={handleSelectPluginsPath}>浏览</Button>
                        {settings.plugins_path && defaultPaths && settings.plugins_path !== defaultPaths.plugins_path && (
                            <Button size={"sm"} variant="outline" onClick={() =>
                                setSettings(prev => prev ? {...prev, plugins_path: null} : null)
                            }>重置</Button>
                        )}
                    </div>
                </section>

                {/* 外观 */}
                <section className="settings-section">
                    <h2 className="settings-section-title">外观</h2>
                    <div className="settings-row">
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
                        </div>
                    </div>
                </section>

                {/* 编辑器行为 */}
                <section className="settings-section">
                    <h2 className="settings-section-title">编辑器行为</h2>
                    <div className="settings-row">
                        <div className="settings-field">
                            <label className="settings-label-wide">自动保存间隔(分)</label>
                            <Input
                                type="number"
                                min="0"
                                value={Math.round(settings.auto_save_secs / 60).toString()}
                                onChange={handleAutoSaveChange}
                                className="settings-input-small"
                            />
                        </div>
                        <div className="settings-field">
                            <label className="settings-label-wide">默认词条类型</label>
                            <Select
                                options={entryTypeOptions}
                                value={settings.default_entry_type || ''}
                                onChange={(value) => setSettings(prev => prev ? {
                                    ...prev,
                                    default_entry_type: value ? String(value) : null
                                } : null)}
                                style={{flex: 1}}
                            />
                        </div>
                    </div>
                </section>

                {/* LLM 默认配置 */}
                <section className="settings-section">
                    <h2 className="settings-section-title">LLM 默认配置</h2>
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
                <section className="settings-section">
                    <h2 className="settings-section-title">图片生成默认配置</h2>
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
                <section className="settings-section">
                    <h2 className="settings-section-title">TTS 默认配置</h2>
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
                    </div>
                </section>

                {/* API Key 管理 */}
                <section className="settings-section">
                    <h2 className="settings-section-title">API Key 管理</h2>
                    <div className="settings-row">
                        {allPlugins.length === 0 ? (
                            <div style={{padding: '20px', textAlign: 'center', color: 'var(--fc-color-tertiary)'}}>
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
                                                <span className="settings-api-key-plugin-id">{plugin.id}</span>
                                            </div>
                                            <div className="settings-api-key-actions">
                                                {apiKeyStatus[plugin.id] ? (
                                                    <>
                                                        <span className="settings-api-key-status">已配置</span>
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

                                        <div className={`settings-api-key-drawer${isExpanded ? ' is-open' : ''}`}>
                                            <div className="settings-api-key-drawer-inner">
                                                <form
                                                    className="settings-api-key-form"
                                                    onSubmit={(event) => {
                                                        event.preventDefault()
                                                        void handleSaveApiKey(plugin.id)
                                                    }}
                                                >
                                                    <label className="settings-api-key-form-label">API Key</label>
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

                {/* 操作按钮 */}
                <div className="settings-footer">
                    <Button variant="outline" onClick={handleReset}>重置为默认</Button>
                </div>
            </div>
        </RollingBox>
    )
}
