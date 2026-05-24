import {useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from './fcThemeTokenOverride'
import {
    createCustomFcThemeRecipe,
    createFcThemePreview,
    createFcThemeTokenColorValues,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    generateFcThemeCustomValues,
    getFcThemeCustomValues,
    getFcThemeRecipe,
    type FcThemeCustomValues,
    type FcThemePreview,
    type FcThemeRecipe,
    type FcThemeTokenColorPair,
    type FcThemeTokenColorValue,
    type FcThemeTokenColorValues,
} from './fcThemeRecipe'
import {isValidHexColor, normalizeHexColor} from './materialThemePreview'
import ThemeTokenColorEditor, {type TokenColorMode} from './ThemeTokenColorEditor'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface ParsedThemeConfig {
    recipeId: string
    customValues?: FcThemeCustomValues
    primarySeed?: string
    tokenColors?: FcThemeTokenColorValues
}

interface ThemeConfigFile {
    app: 'flowcloudai'
    type: 'theme'
    version: 3
    recipeId: string
    customValues: FcThemeCustomValues
    tokenColors: FcThemeTokenColorValues
    exportedAt: string
}

const THEME_CONFIG_VERSION = 3

export default function ThemeColorPreview() {
    const defaultRecipe = getFcThemeRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    const defaultValues = getFcThemeCustomValues(defaultRecipe)
    const [recipeId, setRecipeId] = useState(defaultRecipe.id)
    const [themeValues, setThemeValues] = useState<FcThemeCustomValues>(() => defaultValues)
    const [tokenColors, setTokenColors] = useState<FcThemeTokenColorValues>(() => (
        createTokenColors(defaultRecipe, defaultValues)
    ))
    const [customOpen, setCustomOpen] = useState(false)
    const [configMessage, setConfigMessage] = useState<string | null>(null)
    const importInputRef = useRef<HTMLInputElement>(null)
    const selectedRecipe = getFcThemeRecipe(recipeId)
    const customRecipe = useMemo(() => (
        createCustomFcThemeRecipe(selectedRecipe, themeValues)
    ), [selectedRecipe, themeValues])
    const fcPreview = useMemo(() => createFcThemePreview(customRecipe), [customRecipe])
    const normalizedPrimary = normalizeHexColor(themeValues.primarySeed)
    const normalizedNeutral = normalizeHexColor(themeValues.neutralSeed)
    const primaryValid = isValidHexColor(themeValues.primarySeed)
    const neutralValid = isValidHexColor(themeValues.neutralSeed)
    const defaultTokenColors = createTokenColors(defaultRecipe, defaultValues)
    const isDefaultTheme = recipeId === DEFAULT_FC_THEME_RECIPE_ID
        && sameThemeValues(themeValues, defaultValues)
        && sameTokenColors(tokenColors, defaultTokenColors)

    useEffect(() => {
        if (isDefaultTheme || !fcPreview) {
            clearFcThemeTokenOverride()
            return
        }
        applyFcThemeTokenOverride(fcPreview, tokenColors)
    }, [fcPreview, isDefaultTheme, tokenColors])

    const selectRecipe = (nextRecipeId: string) => {
        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        const nextValues = getFcThemeCustomValues(nextRecipe)
        setRecipeId(nextRecipe.id)
        setThemeValues(nextValues)
        setTokenColors(createTokenColors(nextRecipe, nextValues))
        setConfigMessage(null)
    }

    const resetDefault = () => {
        setCustomOpen(false)
        selectRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    }

    const updateThemeValue = <Key extends keyof FcThemeCustomValues>(
        key: Key,
        value: FcThemeCustomValues[Key],
    ) => {
        setThemeValues((current) => ({...current, [key]: value}))
        setConfigMessage(null)
    }

    const updateTokenColor = (token: string, mode: TokenColorMode, color: string) => {
        const normalized = normalizeHexColor(color)
        if (!normalized) return
        setTokenColors((current) => ({
            ...current,
            [token]: {
                ...current[token],
                ...(mode === 'both'
                    ? {
                        light: {hex: normalized, css: normalized},
                        dark: {hex: normalized, css: normalized},
                    }
                    : {[mode]: {hex: normalized, css: normalized}}),
            },
        }))
        setConfigMessage(null)
    }

    const generateFromPrimary = () => {
        const generated = generateFcThemeCustomValues(themeValues.primarySeed, selectedRecipe)
        if (!generated) {
            setConfigMessage('请先输入有效的主题色。')
            return
        }
        setThemeValues(generated)
        setTokenColors(createTokenColors(selectedRecipe, generated))
        setConfigMessage('已根据主题色生成全部令牌颜色，可继续逐项微调。')
    }

    const exportThemeConfig = () => {
        const customValues = normalizeThemeValues(themeValues)
        if (!customValues || !fcPreview) {
            setConfigMessage('请先修正颜色后再导出。')
            return
        }
        const normalizedTokenColors = normalizeTokenColorsForPreview(tokenColors, fcPreview)
        const config: ThemeConfigFile = {
            app: 'flowcloudai',
            type: 'theme',
            version: THEME_CONFIG_VERSION,
            recipeId: selectedRecipe.id,
            customValues,
            tokenColors: normalizedTokenColors,
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
            const importedValues = config.customValues ?? {
                ...getFcThemeCustomValues(importedRecipe),
                primarySeed: config.primarySeed ?? importedRecipe.primarySeed,
            }
            const importedTokenColors = config.tokenColors ?? createTokenColors(importedRecipe, importedValues)
            setRecipeId(importedRecipe.id)
            setThemeValues(importedValues)
            setTokenColors(normalizeTokenColorsForPreview(
                importedTokenColors,
                createPreviewForValues(importedRecipe, importedValues),
            ))
            setCustomOpen(true)
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
                        <strong>自定义颜色与配置</strong>
                        <small>{selectedRecipe.label} / {normalizedPrimary ?? themeValues.primarySeed}</small>
                    </span>
                    <span aria-hidden="true">{customOpen ? '收起' : '展开'}</span>
                </button>
                {customOpen && (
                    <div className="theme-color-preview__drawer-panel">
                        <input
                            ref={importInputRef}
                            className="theme-color-preview__file-input"
                            type="file"
                            accept="application/json,.json"
                            onChange={importThemeConfig}
                        />
                        <div className="theme-color-preview__drawer-actions">
                            <Button type="button" size="sm" onClick={generateFromPrimary}>
                                一键生成
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => importInputRef.current?.click()}>
                                导入配置
                            </Button>
                            <Button type="button" size="sm" variant="outline" disabled={!fcPreview} onClick={exportThemeConfig}>
                                导出配置
                            </Button>
                        </div>
                        <div className="theme-color-preview__custom-grid">
                            <ThemeColorField
                                label="主题色"
                                value={themeValues.primarySeed}
                                inputValue={normalizedPrimary ?? selectedRecipe.primarySeed}
                                valid={primaryValid}
                                onChange={(value) => updateThemeValue('primarySeed', value)}
                            />
                            <ThemeColorField
                                label="背景基准色"
                                value={themeValues.neutralSeed}
                                inputValue={normalizedNeutral ?? selectedRecipe.neutralSeed}
                                valid={neutralValid}
                                onChange={(value) => updateThemeValue('neutralSeed', value)}
                            />
                            <ThemeNumberField
                                label="色面浓度"
                                value={themeValues.primarySurfaceChroma}
                                min={0}
                                max={24}
                                onChange={(value) => updateThemeValue('primarySurfaceChroma', value)}
                            />
                            <ThemeNumberField
                                label="背景浓度"
                                value={themeValues.neutralChroma}
                                min={0}
                                max={16}
                                onChange={(value) => updateThemeValue('neutralChroma', value)}
                            />
                            <ThemeNumberField
                                label="边框浓度"
                                value={themeValues.neutralVariantChroma}
                                min={0}
                                max={24}
                                onChange={(value) => updateThemeValue('neutralVariantChroma', value)}
                            />
                        </div>
                        {(!primaryValid || !neutralValid) && (
                            <div className="theme-color-preview__invalid">请输入 3 位或 6 位十六进制颜色。</div>
                        )}
                        {fcPreview && (
                            <ThemeTokenColorEditor
                                tokens={fcPreview.tokens}
                                values={tokenColors}
                                onChange={updateTokenColor}
                            />
                        )}
                        {configMessage && <div className="theme-color-preview__config-message">{configMessage}</div>}
                    </div>
                )}
            </div>
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

function ThemeColorField({
    label,
    value,
    inputValue,
    valid,
    onChange,
}: {
    label: string
    value: string
    inputValue: string
    valid: boolean
    onChange: (value: string) => void
}) {
    return (
        <label className="theme-color-preview__field">
            <span>{label}</span>
            <span className="theme-color-preview__color-control">
                <input
                    className="theme-color-preview__color-input"
                    type="color"
                    value={inputValue}
                    onChange={(event) => onChange(event.target.value)}
                />
                <input
                    className={`theme-color-preview__hex-input ${valid ? '' : 'theme-color-preview__hex-input--invalid'}`}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    spellCheck={false}
                    aria-invalid={!valid}
                />
            </span>
        </label>
    )
}

function ThemeNumberField({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string
    value: number
    min: number
    max: number
    onChange: (value: number) => void
}) {
    return (
        <label className="theme-color-preview__field">
            <span>{label}</span>
            <input
                className="theme-color-preview__number-input"
                type="number"
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
            />
        </label>
    )
}

function parseThemeConfig(value: unknown): ParsedThemeConfig | null {
    if (!isRecord(value) || typeof value.recipeId !== 'string') return null

    if (value.version === 1 && typeof value.seedColor === 'string') {
        const primarySeed = normalizeHexColor(value.seedColor)
        return primarySeed ? {recipeId: value.recipeId, primarySeed} : null
    }

    if (value.version === 2) {
        const customValues = parseThemeValues(value.customValues)
        return customValues ? {recipeId: value.recipeId, customValues} : null
    }

    if (value.version !== THEME_CONFIG_VERSION) return null
    const customValues = parseThemeValues(value.customValues)
    const tokenColors = parseTokenColors(value.tokenColors)
    return customValues && tokenColors ? {recipeId: value.recipeId, customValues, tokenColors} : null
}

function parseThemeValues(value: unknown): FcThemeCustomValues | null {
    if (!isRecord(value)) return null
    const primarySeed = typeof value.primarySeed === 'string' ? normalizeHexColor(value.primarySeed) : null
    const neutralSeed = typeof value.neutralSeed === 'string' ? normalizeHexColor(value.neutralSeed) : null
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(value.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(value.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(value.neutralVariantChroma, 10, 0, 24),
    }
}

function parseTokenColors(value: unknown): FcThemeTokenColorValues | null {
    if (!isRecord(value)) return null
    const entries = Object.entries(value).flatMap(([token, pair]) => {
        const parsedPair = parseTokenColorPair(pair)
        return parsedPair ? [[token, parsedPair] as const] : []
    })
    return entries.length > 0 ? Object.fromEntries(entries) : null
}

function parseTokenColorPair(value: unknown): FcThemeTokenColorPair | null {
    if (!isRecord(value)) return null
    const light = parseTokenColorValue(value.light)
    const dark = parseTokenColorValue(value.dark)
    return light && dark ? {light, dark} : null
}

function parseTokenColorValue(value: unknown): FcThemeTokenColorValue | null {
    if (typeof value === 'string') {
        const hex = normalizeHexColor(value)
        return hex ? {hex, css: hex} : null
    }
    if (!isRecord(value) || typeof value.hex !== 'string') return null
    const hex = normalizeHexColor(value.hex)
    if (!hex) return null
    const css = typeof value.css === 'string' && isSafeTokenCss(value.css, hex)
        ? value.css
        : hex
    return {hex, css}
}

function normalizeThemeValues(values: FcThemeCustomValues): FcThemeCustomValues | null {
    const primarySeed = normalizeHexColor(values.primarySeed)
    const neutralSeed = normalizeHexColor(values.neutralSeed)
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(values.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(values.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(values.neutralVariantChroma, 10, 0, 24),
    }
}

function sameThemeValues(first: FcThemeCustomValues, second: FcThemeCustomValues): boolean {
    return normalizeHexColor(first.primarySeed) === normalizeHexColor(second.primarySeed)
        && normalizeHexColor(first.neutralSeed) === normalizeHexColor(second.neutralSeed)
        && first.primarySurfaceChroma === second.primarySurfaceChroma
        && first.neutralChroma === second.neutralChroma
        && first.neutralVariantChroma === second.neutralVariantChroma
}

function sameTokenColors(first: FcThemeTokenColorValues, second: FcThemeTokenColorValues): boolean {
    const keys = new Set([...Object.keys(first), ...Object.keys(second)])
    return [...keys].every((key) => (
        first[key]?.light.hex === second[key]?.light.hex
        && first[key]?.light.css === second[key]?.light.css
        && first[key]?.dark.hex === second[key]?.dark.hex
        && first[key]?.dark.css === second[key]?.dark.css
    ))
}

function normalizeTokenColorsForPreview(
    tokenColors: FcThemeTokenColorValues,
    preview: FcThemePreview | null,
): FcThemeTokenColorValues {
    if (!preview) return tokenColors
    return Object.fromEntries(Object.entries(tokenColors).map(([token, pair]) => {
        const tokenPreview = preview.tokens.find((item) => item.token === token)
        return [token, tokenPreview?.modeInvariant ? {...pair, dark: pair.light} : pair]
    }))
}

function createTokenColors(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemeTokenColorValues {
    const preview = createPreviewForValues(recipe, values)
    return preview ? createFcThemeTokenColorValues(preview) : {}
}

function createPreviewForValues(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemePreview | null {
    return createFcThemePreview(createCustomFcThemeRecipe(recipe, values))
}

function normalizeChroma(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? clampNumber(Math.round(numeric), min, max) : fallback
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeTokenCss(value: string, hex: string): boolean {
    return value === hex || /^color-mix\(in srgb, #[0-9A-F]{6} \d{1,3}%, transparent\)$/u.test(value)
}

function themePresetStyle(preset: FcThemeRecipe): ColorVariableStyle {
    return {
        '--theme-color-preview-primary': preset.primarySeed,
        '--theme-color-preview-surface': preset.neutralSeed,
    }
}
