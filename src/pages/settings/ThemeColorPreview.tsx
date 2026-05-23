import {useEffect, useMemo, useState, type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import FcPrimaryToneGuide from './FcPrimaryToneGuide'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from './fcThemeTokenOverride'
import {
    DEFAULT_MATERIAL_SEED_COLOR,
    generateMaterialThemePreview,
    getPrimaryToneSwatches,
    isValidHexColor,
    MATERIAL_THEME_PRESETS,
    type MaterialRolePreview,
    type MaterialThemeMode,
    type MaterialToneSwatch,
} from './materialThemePreview'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

export default function ThemeColorPreview() {
    const [seedColor, setSeedColor] = useState(DEFAULT_MATERIAL_SEED_COLOR)
    const [mode, setMode] = useState<MaterialThemeMode>('light')
    const [overrideApplied, setOverrideApplied] = useState(false)
    const preview = useMemo(() => generateMaterialThemePreview(seedColor), [seedColor])
    const normalizedColor = preview?.source.hex ?? DEFAULT_MATERIAL_SEED_COLOR
    const valid = isValidHexColor(seedColor)
    const primaryTones = preview ? getPrimaryToneSwatches(preview) : []

    useEffect(() => {
        if (!overrideApplied || !preview) return
        applyFcThemeTokenOverride(preview)
    }, [overrideApplied, preview])

    const applyOverride = () => {
        if (!preview) return
        setOverrideApplied(applyFcThemeTokenOverride(preview))
    }

    const clearOverride = () => {
        clearFcThemeTokenOverride()
        setOverrideApplied(false)
    }

    return (
        <section className="settings-section fc-section-card theme-color-preview">
            <div className="theme-color-preview__header">
                <div>
                    <h2 className="settings-section-title fc-section-title">Material 主题色阶</h2>
                    <p className="theme-color-preview__subtitle">可临时覆盖当前界面的 FC 主色语义令牌，不会保存。</p>
                </div>
                <div className="theme-color-preview__header-actions">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSeedColor(DEFAULT_MATERIAL_SEED_COLOR)}>
                        恢复默认
                    </Button>
                    <Button type="button" size="sm" disabled={!preview} onClick={applyOverride}>
                        {overrideApplied ? '更新覆盖' : '应用覆盖'}
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
                    <span>源颜色</span>
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

                <div className="theme-color-preview__preset-list" aria-label="色彩预设">
                    {MATERIAL_THEME_PRESETS.map((preset) => (
                        <button
                            className="theme-color-preview__preset"
                            type="button"
                            key={preset.value}
                            onClick={() => setSeedColor(preset.value)}
                        >
                            <span
                                className="theme-color-preview__preset-dot"
                                style={colorStyle(preset.value)}
                                aria-hidden="true"
                            />
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {!preview ? (
                <div className="theme-color-preview__invalid">请输入 3 位或 6 位十六进制颜色。</div>
            ) : (
                <>
                    {overrideApplied && (
                        <div className="theme-color-preview__applied-notice">
                            已用运行时样式覆盖主色相关语义令牌。切换颜色后会自动更新覆盖。
                        </div>
                    )}

                    {primaryTones.length > 0 && <FcPrimaryToneGuide tones={primaryTones}/>}

                    <div className="theme-color-preview__summary">
                        <span>HEX {preview.source.hex}</span>
                        <span>Hue {preview.source.hue}</span>
                        <span>Chroma {preview.source.chroma}</span>
                        <span>Tone {preview.source.tone}</span>
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
                        {preview.schemes[mode].roles.map((role) => (
                            <RoleCard key={`${mode}-${role.key}`} role={role}/>
                        ))}
                    </div>

                    <div className="theme-color-preview__palette-list">
                        {preview.palettes.map((palette) => (
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
