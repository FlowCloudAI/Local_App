import {
    createFcSemanticTokenOverrideCss,
    type MaterialThemePreview,
} from './materialThemePreview'

const FC_THEME_TOKEN_OVERRIDE_STYLE_ID = 'fc-theme-token-overrides'

export function applyFcThemeTokenOverride(preview: MaterialThemePreview): boolean {
    const css = createFcSemanticTokenOverrideCss(preview)
    if (!css) return false

    let style = document.getElementById(FC_THEME_TOKEN_OVERRIDE_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
        style = document.createElement('style')
        style.id = FC_THEME_TOKEN_OVERRIDE_STYLE_ID
        document.head.appendChild(style)
    }
    style.textContent = css
    return true
}

export function clearFcThemeTokenOverride() {
    document.getElementById(FC_THEME_TOKEN_OVERRIDE_STYLE_ID)?.remove()
}
