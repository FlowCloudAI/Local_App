import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {Button, Input, Select, useAlert, useTheme} from 'flowcloudai-ui'
import {
    ai_list_plugins,
    exit_app,
    setting_delete_api_key,
    setting_get_settings,
    setting_has_api_key,
    setting_set_api_key,
    setting_update_settings,
    type AppSettings,
    type PluginInfo,
} from '../../../api'
import {getVersion} from '@tauri-apps/api/app'
import {type MobilePage} from '../usePageStack'
import './MobileSettings.css'

interface Props {
    push?: (page: MobilePage) => void
}

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'

function getApiKeyStatusLabel(status: ApiKeyStatus): string {
    if (status === 'checking') return '检查中'
    if (status === 'configured') return '已配置'
    if (status === 'missing') return '未配置'
    if (status === 'error') return '检查失败'
    return '未选择'
}

export default function MobileSettings(_props: Props) {
    void _props
    const {showAlert} = useAlert()
    const {theme, setTheme} = useTheme()
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('unknown')
    const [apiKeyBusy, setApiKeyBusy] = useState(false)
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [version, setVersion] = useState('')
    const [loading, setLoading] = useState(true)

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

    useEffect(() => {
        const plugin = plugins.find(p => p.id === selectedPlugin)
        if (plugin && (!selectedModel || !plugin.models.includes(selectedModel))) {
            setSelectedModel(plugin.default_model ?? plugin.models[0] ?? '')
        }
    }, [selectedPlugin, selectedModel, plugins])

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
            await showAlert('设置已保存', 'success', 'toast', 1500)
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
            await showAlert('API Key 已保存', 'success', 'toast', 1500)
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
            await showAlert('API Key 已删除', 'success', 'toast', 1500)
        } catch (error) {
            await showAlert(`API Key 删除失败：${String(error)}`, 'error', 'toast', 3000)
        } finally {
            setApiKeyBusy(false)
        }
    }, [selectedPlugin, showAlert])

    const handleExit = useCallback(async () => {
        const result = await showAlert('确定要退出应用吗？', 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await exit_app()
        } catch (e) {
            logger.error('退出失败', e)
        }
    }, [showAlert])

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

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            {/* AI 设置 */}
            <div style={{marginBottom: 20}}>
                <h3 style={{fontSize: 'var(--fc-font-size-sm)', fontWeight: 600, margin: '0 0 10px'}}>AI 设置</h3>
                <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                    <div>
                        <div style={{
                            fontSize: 'var(--fc-font-size-xs)',
                            color: 'var(--fc-color-text-secondary)',
                            marginBottom: 4
                        }}>
                            插件
                        </div>
                        <Select
                            value={selectedPlugin}
                            onChange={v => setSelectedPlugin(String(v ?? ''))}
                            options={pluginOptions}
                            placeholder="选择插件"
                        />
                    </div>
                    <div>
                        <div style={{
                            fontSize: 'var(--fc-font-size-xs)',
                            color: 'var(--fc-color-text-secondary)',
                            marginBottom: 4
                        }}>
                            模型
                        </div>
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
                </div>
            </div>

            {/* 外观设置 */}
            <div style={{marginBottom: 20}}>
                <h3 style={{fontSize: 'var(--fc-font-size-sm)', fontWeight: 600, margin: '0 0 10px'}}>外观</h3>
                <div>
                    <div style={{
                        fontSize: 'var(--fc-font-size-xs)',
                        color: 'var(--fc-color-text-secondary)',
                        marginBottom: 4
                    }}>
                        主题
                    </div>
                    <Select
                        value={theme}
                        onChange={v => setTheme(String(v ?? "system") as "system" | "light" | "dark")}
                        options={themeOptions}
                        placeholder="选择主题"
                    />
                </div>
            </div>

            <Button type="button" onClick={handleSave} style={{width: '100%', marginBottom: 12}}>保存设置</Button>

            {/* 关于 */}
            <div style={{
                padding: '12px', background: 'var(--fc-color-bg-secondary)',
                borderRadius: 'var(--fc-radius-sm)', marginBottom: 12,
                fontSize: 'var(--fc-font-size-xs)', color: 'var(--fc-color-text-secondary)',
            }}>
                <div style={{marginBottom: 4}}>FlowCloudAI 移动端</div>
                {version && <div>版本 {version}</div>}
            </div>

            {/* 退出 */}
            <Button type="button" variant="ghost" onClick={handleExit}
                    style={{width: '100%', color: 'var(--fc-color-error)'}}>
                退出应用
            </Button>
        </div>
    )
}
