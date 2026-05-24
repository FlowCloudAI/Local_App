import {
    type FcThemeTokenColorValues,
    type FcThemeTokenPreview,
} from './fcThemeRecipe'
import {normalizeHexColor} from './materialThemePreview'

type TokenColorMode = 'light' | 'dark'

interface ThemeTokenColorEditorProps {
    tokens: FcThemeTokenPreview[]
    values: FcThemeTokenColorValues
    onChange: (token: string, mode: TokenColorMode, color: string) => void
}

const TOKEN_GROUPS: Array<FcThemeTokenPreview['group']> = ['主色', '背景', '边框', '文字']

export default function ThemeTokenColorEditor({
    tokens,
    values,
    onChange,
}: ThemeTokenColorEditorProps) {
    return (
        <div className="theme-color-preview__token-editor">
            <div className="theme-color-preview__token-editor-header">
                <strong>FC 主题令牌颜色</strong>
                <span>浅色与深色模式会分别覆盖。</span>
            </div>
            {TOKEN_GROUPS.map((group) => {
                const groupTokens = tokens.filter((item) => item.group === group)
                if (groupTokens.length === 0) return null
                return (
                    <section className="theme-color-preview__token-group" key={group}>
                        <h3>{group}</h3>
                        <div className="theme-color-preview__token-list">
                            {groupTokens.map((item) => (
                                <div className="theme-color-preview__token-row" key={item.token}>
                                    <div className="theme-color-preview__token-meta">
                                        <strong>{item.label}</strong>
                                        <code>{item.token}</code>
                                    </div>
                                    <TokenColorInput
                                        label="浅色"
                                        color={values[item.token]?.light.hex ?? item.light.hex}
                                        onChange={(color) => onChange(item.token, 'light', color)}
                                    />
                                    <TokenColorInput
                                        label="深色"
                                        color={values[item.token]?.dark.hex ?? item.dark.hex}
                                        onChange={(color) => onChange(item.token, 'dark', color)}
                                    />
                                </div>
                            ))}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}

function TokenColorInput({
    label,
    color,
    onChange,
}: {
    label: string
    color: string
    onChange: (color: string) => void
}) {
    const normalizedColor = normalizeHexColor(color) ?? '#000000'

    const updateByText = (value: string) => {
        const normalized = normalizeHexColor(value)
        if (normalized) onChange(normalized)
    }

    return (
        <label className="theme-color-preview__token-color">
            <span>{label}</span>
            <span className="theme-color-preview__token-color-control">
                <input
                    className="theme-color-preview__token-color-input"
                    type="color"
                    value={normalizedColor}
                    onChange={(event) => onChange(event.target.value)}
                />
                <input
                    className="theme-color-preview__token-hex-input"
                    value={normalizedColor}
                    onChange={(event) => updateByText(event.target.value)}
                    spellCheck={false}
                />
            </span>
        </label>
    )
}
