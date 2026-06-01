import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {Button, Select, useAlert, useTheme} from 'flowcloudai-ui'
import {
    ai_list_plugins,
    exit_app,
    setting_get_settings,
    setting_update_settings,
    type AppSettings,
    type PluginInfo,
} from '../../../api'
import {getVersion} from '@tauri-apps/api/app'
import {type MobilePage} from '../usePageStack'

interface Props {
    push?: (page: MobilePage) => void
}

export default function MobileSettings(_props: Props) {
    void _props
    const {showAlert} = useAlert()
    const {theme, setTheme} = useTheme()
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
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
