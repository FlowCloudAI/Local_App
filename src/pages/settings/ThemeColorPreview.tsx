import {useEffect, useMemo, useState, type CSSProperties} from 'react'
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
} from './fcThemeRecipe'
import {
    generateMaterialThemePreview,
    isValidHexColor,
    normalizeHexColor,
    type MaterialRolePreview,
    type MaterialThemeMode,
    type MaterialToneSwatch,
} from './materialThemePreview'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

export default function ThemeColorPreview() {
    const defaultRecipe = getFcThemeRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    const [recipeId, setRecipeId] = useState(defaultRecipe.id)
    const [seedColor, setSeedColor] = useState(defaultRecipe.primarySeed)
    const [mode, setMode] = useState<MaterialThemeMode>('light')
    const [overrideApplied, setOverrideApplied] = useState(false)
    const selectedRecipe = getFcThemeRecipe(recipeId)
    const materialPreview = useMemo(() => generateMaterialThemePreview(seedColor), [seedColor])
    const fcPreview = useMemo(() => createFcThemePreview(selectedRecipe, seedColor), [selectedRecipe, seedColor])
    const normalizedColor = fcPreview?.primarySeed ?? selectedRecipe.primarySeed
    const valid = isValidHexColor(seedColor)
    const isDefaultTheme = recipeId === DEFAULT_FC_THEME_RECIPE_ID
        && normalizedColor === normalizeHexColor(defaultRecipe.primarySeed)
    const canApplyOverride = Boolean(fcPreview) && !isDefaultTheme

    useEffect(() => {
        if (isDefaultTheme) {
            if (overrideApplied) {
                clearFcThemeTokenOverride()
                setOverrideApplied(false)
            }
            return
        }
        if (!overrideApplied || !fcPreview) return
        applyFcThemeTokenOverride(fcPreview)
    }, [fcPreview, isDefaultTheme, overrideApplied])

    const selectRecipe = (nextRecipeId: string) => {
        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        if (nextRecipe.id === DEFAULT_FC_THEME_RECIPE_ID) {
            clearFcThemeTokenOverride()
            setOverrideApplied(false)
        }
        setRecipeId(nextRecipe.id)
        setSeedColor(nextRecipe.primarySeed)
    }

    const resetDefault = () => {
        clearFcThemeTokenOverride()
        setOverrideApplied(false)
        selectRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    }

    const applyOverride = () => {
        if (isDefaultTheme) {
            clearOverride()
            return
        }
        if (!fcPreview) return
        setOverrideApplied(applyFcThemeTokenOverride(fcPreview))
    }

    const clearOverride = () => {
        clearFcThemeTokenOverride()
        setOverrideApplied(false)
    }

    return (
        <section className="settings-section fc-section-card theme-color-preview">
            <div className="theme-color-preview__header">
                <div>
                    <h2 className="settings-section-title fc-section-title">FC 主题配方</h2>
                    <p className="theme-color-preview__subtitle">临时覆盖主色、背景、边框和文字层级；警告、危险、成功等功能色保持不变。</p>
                </div>
                <div className="theme-color-preview__header-actions">
                    <Button type="button" size="sm" variant="outline" onClick={resetDefault}>
                        恢复默认
                    </Button>
                    <Button type="button" size="sm" disabled={!canApplyOverride} onClick={applyOverride}>
                        {isDefaultTheme ? '默认主题' : overrideApplied ? '更新覆盖' : '应用覆盖'}
                    </Button>
                    {overrideApplied && (
                        <Button type="button" size="sm" variant="ghost" onClick={clearOverride}>
                            清除覆盖
                        </Button>
                    )}
                </div>
            </div>

            <div className="theme-color-preview__controls">
                <label className="theme-color-preview__field">
                    <span>主题色微调</span>
                    <span className="theme-color-preview__color-control">
                        <input
                            className="theme-color-preview__color-input"
                            type="color"
                            value={normalizedColor}
                            onChange={(event) => setSeedColor(event.target.value)}
                        />
                        <input
                            className={`theme-color-preview__hex-input ${valid ? '' : 'theme-color-preview__hex-input--invalid'}`}
                            value={seedColor}
                            onChange={(event) => setSeedColor(event.target.value)}
                            spellCheck={false}
                            aria-invalid={!valid}
                        />
                    </span>
                </label>

                <div className="theme-color-preview__preset-list" aria-label="主题配方预设">
                    {FC_THEME_RECIPES.map((preset) => (
                        <button
                            className={`theme-color-preview__preset ${recipeId === preset.id ? 'theme-color-preview__preset--active' : ''}`}
                            type="button"
                            key={preset.id}
                            title={preset.description}
                            onClick={() => selectRecipe(preset.id)}
                        >
                            <span
                                className="theme-color-preview__preset-dot"
                                style={colorStyle(preset.primarySeed)}
                                aria-hidden="true"
                            />
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {!materialPreview || !fcPreview ? (
                <div className="theme-color-preview__invalid">请输入 3 位或 6 位十六进制颜色。</div>
            ) : (
                <>
                    {overrideApplied && (
                        <div className="theme-color-preview__applied-notice">
                            已用运行时样式覆盖 FC 主题令牌。切换配方或颜色后会自动更新覆盖。
                        </div>
                    )}

                    <div className="theme-color-preview__recipe-summary">
                        <strong>{fcPreview.recipe.label}</strong>
                        <span>{fcPreview.recipe.description}</span>
                        {isDefaultTheme && <span>当前为内置默认主题，不注入覆盖。</span>}
                    </div>

                    <FcPrimaryToneGuide tokens={fcPreview.tokens}/>

                    <div className="theme-color-preview__summary">
                        <span>HEX {materialPreview.source.hex}</span>
                        <span>Hue {materialPreview.source.hue}</span>
                        <span>Chroma {materialPreview.source.chroma}</span>
                        <span>Tone {materialPreview.source.tone}</span>
                    </div>

                    <div className="theme-color-preview__mode-switch" role="group" aria-label="Material 角色模式">
                        {(['light', 'dark'] as const).map((item) => (
                            <button
                                className={`theme-color-preview__mode ${mode === item ? 'theme-color-preview__mode--active' : ''}`}
                                type="button"
                                key={item}
                                onClick={() => setMode(item)}
                            >
                                {item === 'light' ? '浅色角色' : '深色角色'}
                            </button>
                        ))}
                    </div>

                    <div className="theme-color-preview__role-grid">
                        {materialPreview.schemes[mode].roles.map((role) => (
                            <RoleCard key={`${mode}-${role.key}`} role={role}/>
                        ))}
                    </div>

                    <div className="theme-color-preview__palette-list">
                        {materialPreview.palettes.map((palette) => (
                            <div className="theme-color-preview__palette" key={palette.key}>
                                <div className="theme-color-preview__palette-meta">
                                    <strong>{palette.label}</strong>
                                    <span>H {palette.hue} / C {palette.chroma}</span>
                                </div>
                                <div className="theme-color-preview__tone-row">
                                    {palette.tones.map((tone) => (
                                        <ToneSwatch key={`${palette.key}-${tone.tone}`} tone={tone}/>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </section>
    )
}

function RoleCard({role}: { role: MaterialRolePreview }) {
    return (
        <div className="theme-color-preview__role-card">
            <span className="theme-color-preview__role-swatch" style={colorStyle(role.hex)} aria-hidden="true"/>
            <span className="theme-color-preview__role-name">{role.label}</span>
            <code>{role.hex}</code>
        </div>
    )
}

function ToneSwatch({tone}: { tone: MaterialToneSwatch }) {
    return (
        <div className="theme-color-preview__tone">
            <span className="theme-color-preview__tone-swatch" style={colorStyle(tone.hex)} aria-hidden="true"/>
            <span>{tone.tone}</span>
        </div>
    )
}

function colorStyle(color: string): ColorVariableStyle {
    return {'--theme-color-preview-swatch': color}
}
