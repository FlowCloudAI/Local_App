import {Button, Input, Select, Slider} from 'flowcloudai-ui'
import {
    type ApiUsageByModel,
    type ApiUsageSummary,
    type LocalPluginInfo,
    type RemotePluginInfo,
} from '../../../api'
import {convertFileSrc} from '../../../api/assets'
import {type MobileSettingsPageType} from '../usePageStack'

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type PluginKindFilter = 'all' | 'llm' | 'image' | 'tts'

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
    pluginSearch: string
    pluginKindFilter: PluginKindFilter
    localPluginError: string | null
    marketPluginError: string | null
    loadingMarketPlugins: boolean
    localPlugins: LocalPluginInfo[]
    marketPlugins: RemotePluginInfo[]
    installingPluginIds: Set<string>
    onPluginSearchChange: (value: string) => void
    onPluginKindFilterChange: (value: PluginKindFilter) => void
    getInstalledPlugin: (pluginId: string) => LocalPluginInfo | undefined
    onRefreshPluginSources: () => void | Promise<void>
    onInstallFromFile: () => void | Promise<void>
    onInstallMarketPlugin: (pluginId: string) => void | Promise<void>
}

interface AppearanceSectionProps {
    theme: string
    themeOptions: SelectOption[]
    language: string
    languageOptions: SelectOption[]
    editorFontSize: number
    onThemeChange: (value: 'system' | 'light' | 'dark') => void
    onLanguageChange: (value: string) => void
    onEditorFontSizeChange: (value: number) => void
    onSaveSettings: () => void | Promise<void>
}

interface UsageSectionProps {
    summary: ApiUsageSummary | null
    byModel: ApiUsageByModel[]
    loading: boolean
    error: string
    onRefresh: () => void | Promise<void>
}

function getPluginKindLabel(kind: string): string {
    if (kind.includes('image')) return 'IMAGE'
    if (kind.includes('tts')) return 'TTS'
    return 'LLM'
}

function PluginKindIcon({kind}: {kind: string}) {
    if (kind.includes('image')) {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
            </svg>
        )
    }
    if (kind.includes('tts')) {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
        )
    }
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
    )
}

function PluginIcon({kind, iconUrl, local}: {kind: string; iconUrl?: string; local?: boolean}) {
    const src = iconUrl ? (local ? convertFileSrc(iconUrl, 'fcimg') : iconUrl) : ''
    return (
        <div className="mobile-settings-plugin-icon">
            {src ? (
                <img
                    src={src}
                    alt=""
                    className="mobile-settings-plugin-icon__image"
                    onError={event => {
                        event.currentTarget.style.display = 'none'
                    }}
                />
            ) : (
                <PluginKindIcon kind={kind}/>
            )}
        </div>
    )
}

function getUsageModalityLabel(modality: string): string {
    if (modality === 'image') return '图片'
    if (modality === 'tts') return '语音'
    return '对话'
}

function formatUsageNumber(value: number): string {
    return value.toLocaleString('zh-CN')
}

function readSliderNumber(value: number | [number, number]): number {
    return Array.isArray(value) ? value[0] : value
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

function SearchIcon() {
    return (
        <svg className="mobile-settings-plugin-search__icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="5.8"/>
            <path d="m15 15 4.5 4.5"/>
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
                onClick={() => onOpenPage('settingsUsage')}
            >
                <span className="mobile-settings-menu-item__content">
                    <span className="mobile-settings-menu-item__label">用量统计</span>
                    <span className="mobile-settings-menu-item__summary">API 调用与 Token 消耗</span>
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
                        流云AI 移动端{version ? ` · ${version}` : ''}
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
    pluginSearch,
    pluginKindFilter,
    localPluginError,
    marketPluginError,
    loadingMarketPlugins,
    localPlugins,
    marketPlugins,
    installingPluginIds,
    onPluginSearchChange,
    onPluginKindFilterChange,
    getInstalledPlugin,
    onRefreshPluginSources,
    onInstallFromFile,
    onInstallMarketPlugin,
}: PluginsSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-plugin-search-row">
                <Input
                    value={pluginSearch}
                    onValueChange={onPluginSearchChange}
                    placeholder="搜索插件…"
                    prefix={<SearchIcon/>}
                    radius="full"
                    size="lg"
                    allowClear
                    className="mobile-settings-plugin-search"
                />
                <Button
                    type="button"
                    size="md"
                    variant="outline"
                    onClick={() => void onRefreshPluginSources()}
                    disabled={pluginSourcesRefreshing}
                >
                    {pluginSourcesRefreshing ? '刷新中…' : '刷新'}
                </Button>
            </div>
            <div className="mobile-settings-plugin-filter">
                <div className="mobile-settings-plugin-filter__segments" role="group" aria-label="插件类型筛选">
                    {[
                        ['all', '全部'],
                        ['llm', '对话'],
                        ['image', '图片'],
                        ['tts', '语音'],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={`mobile-settings-plugin-filter__segment${pluginKindFilter === value ? ' is-active' : ''}`}
                            onClick={() => onPluginKindFilterChange(value as PluginKindFilter)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {localPluginError && (
                <div className="mobile-settings-plugin-error">本地插件加载失败：{localPluginError}</div>
            )}
            {marketPluginError && (
                <div className="mobile-settings-plugin-error">插件库加载失败：{marketPluginError}</div>
            )}
            <div className="mobile-settings-installed-plugin-list">
                <div className="mobile-settings-installed-plugin-list__header">
                    <div>
                        <div className="mobile-settings-installed-plugin-list__title">已安装插件</div>
                        <div className="mobile-settings-plugin-count">已安装 {localPluginCount} 个</div>
                    </div>
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
                {localPlugins.length === 0 ? (
                    <div className="mobile-settings-plugin-empty">暂无已安装插件</div>
                ) : (
                    localPlugins.map(plugin => (
                        <div className="mobile-settings-installed-plugin-item" key={plugin.id}>
                            <PluginIcon kind={plugin.kind} iconUrl={plugin.icon_url} local/>
                            <div className="mobile-settings-plugin-item__body">
                                <div className="mobile-settings-plugin-item__title">{plugin.name}</div>
                                <div className="mobile-settings-plugin-item__meta">
                                    <span>{getPluginKindLabel(plugin.kind)}</span>
                                    <span>v{plugin.version}</span>
                                    <span>{plugin.author}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
            <div className="mobile-settings-subtitle">插件库</div>
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
                                <PluginIcon kind={plugin.kind} iconUrl={plugin.icon_url}/>
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
    language,
    languageOptions,
    editorFontSize,
    onThemeChange,
    onLanguageChange,
    onEditorFontSizeChange,
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
                <div>
                    <div className="mobile-settings-field-label">语言</div>
                    <Select
                        value={language}
                        onChange={v => onLanguageChange(String(v ?? 'zh-CN'))}
                        options={languageOptions}
                        placeholder="选择语言"
                    />
                </div>
                <div>
                    <div className="mobile-settings-field-label">编辑器字号</div>
                    <div className="mobile-settings-font-size-control">
                        <Slider
                            min={10}
                            max={24}
                            step={1}
                            value={editorFontSize}
                            tooltip
                            onChange={value => onEditorFontSizeChange(readSliderNumber(value))}
                        />
                        <span>{editorFontSize}px</span>
                        {editorFontSize !== 14 && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => onEditorFontSizeChange(14)}
                            >
                                默认
                            </Button>
                        )}
                    </div>
                </div>
                <Button type="button" onClick={onSaveSettings} className="mobile-settings-full-button">
                    保存设置
                </Button>
            </div>
        </div>
    )
}

export function MobileSettingsUsageSection({
    summary,
    byModel,
    loading,
    error,
    onRefresh,
}: UsageSectionProps) {
    if (loading && !summary) {
        return <div className="mobile-settings-plugin-empty">正在加载用量统计…</div>
    }

    if (error) {
        return (
            <div className="mobile-settings-section">
                <div className="mobile-settings-plugin-error">加载失败：{error}</div>
                <Button type="button" size="sm" variant="outline" onClick={() => void onRefresh()}>
                    重试
                </Button>
            </div>
        )
    }

    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-section__header">
                <div className="mobile-settings-plugin-count">查看 API 调用次数与 Token 消耗</div>
                <Button type="button" size="sm" variant="outline" onClick={() => void onRefresh()} disabled={loading}>
                    {loading ? '刷新中…' : '刷新'}
                </Button>
            </div>
            {summary && (
                <div className="mobile-settings-usage-grid">
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.call_count)}</div>
                        <div className="mobile-settings-usage-card__label">API 调用</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">总 Token</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_prompt_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">Prompt</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_completion_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">Completion</div>
                    </div>
                </div>
            )}
            <div className="mobile-settings-subtitle">按模型统计</div>
            <div className="mobile-settings-usage-model-list">
                {byModel.length === 0 ? (
                    <div className="mobile-settings-plugin-empty">暂无记录。使用 AI 对话后将自动统计。</div>
                ) : byModel.map((row, index) => (
                    <div className="mobile-settings-usage-model-item" key={`${row.provider}-${row.model}-${index}`}>
                        <div className="mobile-settings-usage-model-item__header">
                            <div className="mobile-settings-plugin-item__title">{row.model}</div>
                            <span className="mobile-settings-usage-badge">{getUsageModalityLabel(row.modality)}</span>
                        </div>
                        <div className="mobile-settings-plugin-item__meta">
                            <span>{row.provider}</span>
                            <span>{formatUsageNumber(row.call_count)} 次</span>
                            <span>{formatUsageNumber(row.total_tokens)} tokens</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
