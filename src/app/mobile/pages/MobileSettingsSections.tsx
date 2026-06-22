import {Button, Input, Select} from 'flowcloudai-ui'
import {
    type AppLogSnapshot,
    type LocalPluginInfo,
    type RemotePluginInfo,
} from '../../../api'
import {type MobileSettingsPageType} from '../usePageStack'

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'

interface SelectOption {
    value: string
    label: string
}

interface MenuSectionProps {
    themeLabel: string
    marketSummary: string
    localPluginCount: number
    currentPluginName?: string
    apiKeyStatusLabel: string
    version: string
    onOpenPage: (type: MobileSettingsPageType) => void
}

interface AiSectionProps {
    selectedPlugin: string
    selectedModel: string
    pluginOptions: SelectOption[]
    modelOptions: SelectOption[]
    apiKeyStatus: ApiKeyStatus
    apiKeyStatusLabel: string
    apiKeyDraft: string
    apiKeyBusy: boolean
    apiKeyPlaceholder: string
    onSelectedPluginChange: (value: string) => void
    onSelectedModelChange: (value: string) => void
    onApiKeyDraftChange: (value: string) => void
    onSaveSettings: () => void | Promise<void>
    onSaveApiKey: () => void | Promise<void>
    onDeleteApiKey: () => void | Promise<void>
}

interface PluginsSectionProps {
    localPluginCount: number
    pluginSourcesRefreshing: boolean
    installingLocalFile: boolean
    localPluginError: string | null
    marketPluginError: string | null
    loadingMarketPlugins: boolean
    marketPlugins: RemotePluginInfo[]
    installingPluginIds: Set<string>
    getInstalledPlugin: (pluginId: string) => LocalPluginInfo | undefined
    onRefreshPluginSources: () => void | Promise<void>
    onInstallFromFile: () => void | Promise<void>
    onInstallMarketPlugin: (pluginId: string) => void | Promise<void>
}

interface AppearanceSectionProps {
    theme: string
    themeOptions: SelectOption[]
    onThemeChange: (value: 'system' | 'light' | 'dark') => void
    onSaveSettings: () => void | Promise<void>
}

interface AboutSectionProps {
    version: string
    logViewerOpen: boolean
    logSnapshot: AppLogSnapshot | null
    logLoading: boolean
    logError: string
    onOpenLogViewer: () => void
    onLoadAppLog: () => void | Promise<void>
    onCopyLog: () => void | Promise<void>
    onExit: () => void | Promise<void>
}

function getPluginKindLabel(kind: string): string {
    if (kind.includes('image')) return 'IMAGE'
    if (kind.includes('tts')) return 'TTS'
    return 'LLM'
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

export function MobileSettingsMenuSection({
    themeLabel,
    marketSummary,
    localPluginCount,
    currentPluginName,
    apiKeyStatusLabel,
    version,
    onOpenPage,
}: MenuSectionProps) {
    return (
        <div className="mobile-settings-menu">
            <button
                type="button"
                className="mobile-settings-menu-item"
                onClick={() => onOpenPage('settingsAi')}
            >
                <span className="mobile-settings-menu-item__content">
                    <span className="mobile-settings-menu-item__label">AI 设置</span>
                    <span className="mobile-settings-menu-item__summary">
                        {currentPluginName ?? '未选择插件'} · {apiKeyStatusLabel}
                    </span>
                </span>
                <ChevronRightIcon/>
            </button>
            <button
                type="button"
                className="mobile-settings-menu-item"
                onClick={() => onOpenPage('settingsPlugins')}
            >
                <span className="mobile-settings-menu-item__content">
                    <span className="mobile-settings-menu-item__label">插件安装</span>
                    <span className="mobile-settings-menu-item__summary">
                        已安装 {localPluginCount} 个 · {marketSummary}
                    </span>
                </span>
                <ChevronRightIcon/>
            </button>
            <button
                type="button"
                className="mobile-settings-menu-item"
                onClick={() => onOpenPage('settingsAppearance')}
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
                onClick={() => onOpenPage('settingsAbout')}
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
    )
}

export function MobileSettingsAiSection({
    selectedPlugin,
    selectedModel,
    pluginOptions,
    modelOptions,
    apiKeyStatus,
    apiKeyStatusLabel,
    apiKeyDraft,
    apiKeyBusy,
    apiKeyPlaceholder,
    onSelectedPluginChange,
    onSelectedModelChange,
    onApiKeyDraftChange,
    onSaveSettings,
    onSaveApiKey,
    onDeleteApiKey,
}: AiSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-form-stack">
                <div>
                    <div className="mobile-settings-field-label">插件</div>
                    <Select
                        value={selectedPlugin}
                        onChange={v => onSelectedPluginChange(String(v ?? ''))}
                        options={pluginOptions}
                        placeholder="选择插件"
                    />
                </div>
                <div>
                    <div className="mobile-settings-field-label">模型</div>
                    <Select
                        value={selectedModel}
                        onChange={v => onSelectedModelChange(String(v ?? ''))}
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
                        onValueChange={onApiKeyDraftChange}
                        placeholder={apiKeyPlaceholder}
                        disabled={!selectedPlugin || apiKeyBusy}
                        autoComplete="off"
                        className="mobile-settings-api-key__input"
                    />
                    <div className="mobile-settings-api-key__actions">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void onSaveApiKey()}
                            disabled={!selectedPlugin || apiKeyBusy || !apiKeyDraft.trim()}
                        >
                            {apiKeyBusy ? '处理中…' : '保存 API Key'}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void onDeleteApiKey()}
                            disabled={!selectedPlugin || apiKeyBusy || apiKeyStatus !== 'configured'}
                        >
                            删除
                        </Button>
                    </div>
                </div>
                <Button type="button" onClick={onSaveSettings} className="mobile-settings-full-button">
                    保存设置
                </Button>
            </div>
        </div>
    )
}

export function MobileSettingsPluginsSection({
    localPluginCount,
    pluginSourcesRefreshing,
    installingLocalFile,
    localPluginError,
    marketPluginError,
    loadingMarketPlugins,
    marketPlugins,
    installingPluginIds,
    getInstalledPlugin,
    onRefreshPluginSources,
    onInstallFromFile,
    onInstallMarketPlugin,
}: PluginsSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-section__header">
                <div className="mobile-settings-plugin-count">已安装 {localPluginCount} 个</div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onRefreshPluginSources()}
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
                    onClick={() => void onInstallFromFile()}
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
                ) : marketPlugins.length === 0 ? (
                    <div className="mobile-settings-plugin-empty">暂无可安装插件</div>
                ) : (
                    marketPlugins.map(plugin => {
                        const installedPlugin = getInstalledPlugin(plugin.id)
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
                                    onClick={() => void onInstallMarketPlugin(plugin.id)}
                                >
                                    {actionLabel}
                                </Button>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

export function MobileSettingsAppearanceSection({
    theme,
    themeOptions,
    onThemeChange,
    onSaveSettings,
}: AppearanceSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-form-stack">
                <div>
                    <div className="mobile-settings-field-label">主题</div>
                    <Select
                        value={theme}
                        onChange={v => onThemeChange(String(v ?? 'system') as 'system' | 'light' | 'dark')}
                        options={themeOptions}
                        placeholder="选择主题"
                    />
                </div>
                <Button type="button" onClick={onSaveSettings} className="mobile-settings-full-button">
                    保存设置
                </Button>
            </div>
        </div>
    )
}

export function MobileSettingsAboutSection({
    version,
    logViewerOpen,
    logSnapshot,
    logLoading,
    logError,
    onOpenLogViewer,
    onLoadAppLog,
    onCopyLog,
    onExit,
}: AboutSectionProps) {
    return (
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
                        onClick={onOpenLogViewer}
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
                                onClick={() => void onLoadAppLog()}
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
                                onClick={() => void onCopyLog()}
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
                onClick={onExit}
                className="mobile-settings-exit-button"
            >
                退出应用
            </Button>
        </div>
    )
}
