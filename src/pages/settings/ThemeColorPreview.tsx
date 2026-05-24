import {useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import FcPrimaryToneGuide from './FcPrimaryToneGuide'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from './fcThemeTokenOverride'
import {
    createFcThemePreview,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    getFcThemeRecipe,
    type FcThemeRecipe,
} from './fcThemeRecipe'
import {
    isValidHexColor,
    normalizeHexColor,
} from './materialThemePreview'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface ImportedThemeConfig {
    recipeId: string
    seedColor: string
}

interface ThemeConfigFile extends ImportedThemeConfig {
    app: 'flowcloudai'
    type: 'theme'
    version: 1
    exportedAt: string
}

const THEME_CONFIG_VERSION = 1

export default function ThemeColorPreview() {
    const defaultRecipe = getFcThemeRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    const [recipeId, setRecipeId] = useState(defaultRecipe.id)
    const [seedColor, setSeedColor] = useState(defaultRecipe.primarySeed)
    const [customOpen, setCustomOpen] = useState(false)
    const [configMessage, setConfigMessage] = useState<string | null>(null)
    const importInputRef = useRef<HTMLInputElement>(null)
    const selectedRecipe = getFcThemeRecipe(recipeId)
    const fcPreview = useMemo(() => createFcThemePreview(selectedRecipe, seedColor), [selectedRecipe, seedColor])
    const normalizedColor = fcPreview?.primarySeed ?? selectedRecipe.primarySeed
    const valid = isValidHexColor(seedColor)
    const isDefaultTheme = recipeId === DEFAULT_FC_THEME_RECIPE_ID
        && normalizedColor === normalizeHexColor(defaultRecipe.primarySeed)

    useEffect(() => {
        if (isDefaultTheme) {
            clearFcThemeTokenOverride()
            return
        }
        if (!fcPreview) return
        applyFcThemeTokenOverride(fcPreview)
    }, [fcPreview, isDefaultTheme])

    const selectRecipe = (nextRecipeId: string) => {
        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        setRecipeId(nextRecipe.id)
        setSeedColor(nextRecipe.primarySeed)
        setConfigMessage(null)
    }

    const resetDefault = () => {
        setCustomOpen(false)
        selectRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    }

    const updateSeedColor = (value: string) => {
        setSeedColor(value)
        setConfigMessage(null)
    }

    const exportThemeConfig = () => {
        if (!fcPreview) return
        const config: ThemeConfigFile = {
            app: 'flowcloudai',
            type: 'theme',
            version: THEME_CONFIG_VERSION,
            recipeId: selectedRecipe.id,
            seedColor: normalizedColor,
            exportedAt: new Date().toISOString(),
        }
        const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'})
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `flowcloudai-theme-${selectedRecipe.id}.json`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        setConfigMessage('主题配置已导出。')
    }

    const importThemeConfig = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        try {
            const config = parseThemeConfig(JSON.parse(await file.text()))
            if (!config) {
                setConfigMessage('主题配置无法识别。')
                return
            }
            const importedRecipe = FC_THEME_RECIPES.find((recipe) => recipe.id === config.recipeId)
            if (!importedRecipe) {
                setConfigMessage('主题配置引用了不存在的预设。')
                return
            }
            setRecipeId(importedRecipe.id)
            setSeedColor(config.seedColor)
            setCustomOpen(config.seedColor !== normalizeHexColor(importedRecipe.primarySeed))
            setConfigMessage('主题配置已导入。')
        } catch {
            setConfigMessage('主题配置无法读取。')
        }
    }

    return (
        <section className="settings-section fc-section-card theme-color-preview">
            <div className="theme-color-preview__header">
                <div>
                    <h2 className="settings-section-title fc-section-title">主题</h2>
                    <p className="theme-color-preview__subtitle">主色、背景、边框和文字层级；警告、危险、成功等功能色保持不变。</p>
                </div>
                <div className="theme-color-preview__header-actions">
                    <input
                        ref={importInputRef}
                        className="theme-color-preview__file-input"
                        type="file"
                        accept="application/json,.json"
                        onChange={importThemeConfig}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => importInputRef.current?.click()}>
                        导入配置
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={!fcPreview} onClick={exportThemeConfig}>
                        导出配置
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={resetDefault}>
                        恢复默认
                    </Button>
                </div>
            </div>

            <div className="theme-color-preview__preset-grid" aria-label="主题预设">
                {FC_THEME_RECIPES.map((preset) => (
                    <ThemePresetCard
                        key={preset.id}
                        preset={preset}
                        active={recipeId === preset.id}
                        onSelect={() => selectRecipe(preset.id)}
                    />
                ))}
            </div>

            <div className="theme-color-preview__drawer">
                <button
                    className="theme-color-preview__drawer-toggle"
                    type="button"
                    aria-expanded={customOpen}
                    onClick={() => setCustomOpen((open) => !open)}
                >
                    <span>
                        <strong>自定义颜色</strong>
                        <small>{normalizedColor}</small>
                    </span>
                    <span aria-hidden="true">{customOpen ? '收起' : '展开'}</span>
                </button>
                {customOpen && (
                    <div className="theme-color-preview__drawer-panel">
                        <label className="theme-color-preview__field">
                            <span>主题色</span>
                            <span className="theme-color-preview__color-control">
                                <input
                                    className="theme-color-preview__color-input"
                                    type="color"
                                    value={normalizedColor}
                                    onChange={(event) => updateSeedColor(event.target.value)}
                                />
                                <input
                                    className={`theme-color-preview__hex-input ${valid ? '' : 'theme-color-preview__hex-input--invalid'}`}
                                    value={seedColor}
                                    onChange={(event) => updateSeedColor(event.target.value)}
                                    spellCheck={false}
                                    aria-invalid={!valid}
                                />
                            </span>
                        </label>
                        {!valid && <div className="theme-color-preview__invalid">请输入 3 位或 6 位十六进制颜色。</div>}
                    </div>
                )}
            </div>

            {configMessage && <div className="theme-color-preview__config-message">{configMessage}</div>}

            {fcPreview && (
                <details className="theme-color-preview__debug">
                    <summary>开发调试</summary>
                    <FcPrimaryToneGuide tokens={fcPreview.tokens}/>
                </details>
            )}
        </section>
    )
}

function ThemePresetCard({
    preset,
    active,
    onSelect,
}: {
    preset: FcThemeRecipe
    active: boolean
    onSelect: () => void
}) {
    return (
        <button
            className={`theme-color-preview__preset-card ${active ? 'theme-color-preview__preset-card--active' : ''}`}
            type="button"
            style={themePresetStyle(preset)}
            aria-pressed={active}
            title={preset.description}
            onClick={onSelect}
        >
            <span className="theme-color-preview__preset-card-header">
                <span className="theme-color-preview__preset-dot" aria-hidden="true"/>
                <strong>{preset.label}</strong>
            </span>
            <span className="theme-color-preview__preset-card-swatches" aria-hidden="true">
                <span className="theme-color-preview__preset-swatch theme-color-preview__preset-swatch--surface"/>
                <span className="theme-color-preview__preset-swatch theme-color-preview__preset-swatch--primary"/>
            </span>
        </button>
    )
}

function parseThemeConfig(value: unknown): ImportedThemeConfig | null {
    if (!isRecord(value)) return null
    if (value.version !== THEME_CONFIG_VERSION) return null
    if (typeof value.recipeId !== 'string' || typeof value.seedColor !== 'string') return null
    const seedColor = normalizeHexColor(value.seedColor)
    if (!seedColor) return null
    return {
        recipeId: value.recipeId,
        seedColor,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function themePresetStyle(preset: FcThemeRecipe): ColorVariableStyle {
    return {
        '--theme-color-preview-primary': preset.primarySeed,
        '--theme-color-preview-surface': preset.neutralSeed,
    }
}
