import {
    argbFromHex,
    Hct,
    hexFromArgb,
    themeFromSourceColor,
    type Scheme,
    type TonalPalette,
} from '@material/material-color-utilities'

export type MaterialThemeMode = 'light' | 'dark'

export interface MaterialToneSwatch {
    tone: number
    hex: string
}

export interface MaterialPalettePreview {
    key: string
    label: string
    hue: number
    chroma: number
    tones: MaterialToneSwatch[]
}

export interface MaterialRolePreview {
    key: string
    label: string
    hex: string
}

export interface MaterialSchemePreview {
    mode: MaterialThemeMode
    label: string
    roles: MaterialRolePreview[]
}

export interface MaterialThemePreview {
    source: {
        hex: string
        hue: number
        chroma: number
        tone: number
    }
    palettes: MaterialPalettePreview[]
    schemes: Record<MaterialThemeMode, MaterialSchemePreview>
}

export interface FcSemanticTokenSuggestion {
    token: string
    label: string
    lightTone: number
    darkTone: number
    lightAlpha?: number
    darkAlpha?: number
}

export interface FcSemanticTokenValue {
    label: string
    value: string
    swatch: string
}

export interface FcSemanticTokenPreview {
    token: string
    label: string
    light: FcSemanticTokenValue
    dark: FcSemanticTokenValue
}

export const DEFAULT_MATERIAL_SEED_COLOR = '#378ADD'

export const MATERIAL_THEME_PRESETS = [
    {label: '流云蓝', value: '#378ADD'},
    {label: '紫藤', value: '#7C5CE8'},
    {label: '青松', value: '#2E7D63'},
    {label: '晚霞', value: '#D86B47'},
    {label: '琥珀', value: '#B7791F'},
]

const MATERIAL_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]

export const FC_SEMANTIC_TOKEN_SUGGESTIONS: FcSemanticTokenSuggestion[] = [
    {token: '--fc-color-primary', label: '主色', lightTone: 50, darkTone: 70},
    {token: '--fc-color-primary-hover', label: '悬停', lightTone: 40, darkTone: 80},
    {token: '--fc-color-primary-active', label: '按下', lightTone: 30, darkTone: 90},
    {token: '--fc-color-primary-subtle', label: '弱背景', lightTone: 95, darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-border-focus', label: '焦点边框', lightTone: 50, darkTone: 60},
    {token: '--fc-color-text-link', label: '链接', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-link-hover', label: '链接悬停', lightTone: 30, darkTone: 80},
    {token: '--fc-color-info', label: '信息色', lightTone: 50, darkTone: 70},
    {token: '--fc-color-info-bg', label: '信息背景', lightTone: 95, darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-info-border', label: '信息边框', lightTone: 90, darkTone: 70, darkAlpha: 25},
]

const PALETTE_CONFIG = [
    {key: 'primary', label: 'Primary'},
    {key: 'secondary', label: 'Secondary'},
    {key: 'tertiary', label: 'Tertiary'},
    {key: 'neutral', label: 'Neutral'},
    {key: 'neutralVariant', label: 'Neutral Variant'},
    {key: 'error', label: 'Error'},
] as const

const ROLE_CONFIG = [
    {key: 'primary', label: 'Primary'},
    {key: 'onPrimary', label: 'On Primary'},
    {key: 'primaryContainer', label: 'Primary Container'},
    {key: 'onPrimaryContainer', label: 'On Primary Container'},
    {key: 'secondary', label: 'Secondary'},
    {key: 'secondaryContainer', label: 'Secondary Container'},
    {key: 'tertiary', label: 'Tertiary'},
    {key: 'tertiaryContainer', label: 'Tertiary Container'},
    {key: 'surface', label: 'Surface'},
    {key: 'surfaceVariant', label: 'Surface Variant'},
    {key: 'onSurface', label: 'On Surface'},
    {key: 'onSurfaceVariant', label: 'On Surface Variant'},
    {key: 'outline', label: 'Outline'},
    {key: 'outlineVariant', label: 'Outline Variant'},
    {key: 'error', label: 'Error'},
    {key: 'errorContainer', label: 'Error Container'},
] as const

type PaletteKey = typeof PALETTE_CONFIG[number]['key']
type RoleKey = typeof ROLE_CONFIG[number]['key']

export function normalizeHexColor(input: string): string | null {
    const value = input.trim()
    const shortMatch = /^#?([0-9a-fA-F]{3})$/.exec(value)
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].split('')
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
    }

    const fullMatch = /^#?([0-9a-fA-F]{6})$/.exec(value)
    if (!fullMatch) return null
    return `#${fullMatch[1]}`.toUpperCase()
}

export function isValidHexColor(input: string): boolean {
    return normalizeHexColor(input) !== null
}

export function generateMaterialThemePreview(seedColor: string): MaterialThemePreview | null {
    const sourceHex = normalizeHexColor(seedColor)
    if (!sourceHex) return null

    const sourceArgb = argbFromHex(sourceHex)
    const theme = themeFromSourceColor(sourceArgb)
    const sourceHct = Hct.fromInt(sourceArgb)

    return {
        source: {
            hex: sourceHex,
            hue: roundColorMetric(sourceHct.hue),
            chroma: roundColorMetric(sourceHct.chroma),
            tone: roundColorMetric(sourceHct.tone),
        },
        palettes: PALETTE_CONFIG.map(({key, label}) =>
            createPalettePreview(key, label, theme.palettes[key]),
        ),
        schemes: {
            light: createSchemePreview('light', '浅色角色', theme.schemes.light),
            dark: createSchemePreview('dark', '深色角色', theme.schemes.dark),
        },
    }
}

export function getPrimaryToneSwatches(preview: MaterialThemePreview): MaterialToneSwatch[] {
    return preview.palettes.find((palette) => palette.key === 'primary')?.tones ?? []
}

export function createFcSemanticTokenPreviews(
    tones: MaterialToneSwatch[],
): FcSemanticTokenPreview[] {
    return FC_SEMANTIC_TOKEN_SUGGESTIONS.map((item) => {
        const lightHex = getToneHex(tones, item.lightTone)
        const darkHex = getToneHex(tones, item.darkTone)
        return {
            token: item.token,
            label: item.label,
            light: createTokenValue(`Light T${item.lightTone}`, lightHex, item.lightAlpha),
            dark: createTokenValue(`Dark T${item.darkTone}`, darkHex, item.darkAlpha),
        }
    })
}

export function createFcSemanticTokenOverrideCss(preview: MaterialThemePreview): string | null {
    const tones = getPrimaryToneSwatches(preview)
    if (tones.length === 0) return null

    const lightLines = FC_SEMANTIC_TOKEN_SUGGESTIONS.map((item) => {
        const hex = getToneHex(tones, item.lightTone)
        return `  ${item.token}: ${formatCssTokenValue(hex, item.lightAlpha)} !important;`
    })
    const darkLines = FC_SEMANTIC_TOKEN_SUGGESTIONS.map((item) => {
        const hex = getToneHex(tones, item.darkTone)
        return `  ${item.token}: ${formatCssTokenValue(hex, item.darkAlpha)} !important;`
    })

    return [
        ':root {',
        ...lightLines,
        '}',
        '',
        '[data-theme="dark"] {',
        ...darkLines,
        '}',
    ].join('\n')
}

function createPalettePreview(
    key: PaletteKey,
    label: string,
    palette: TonalPalette,
): MaterialPalettePreview {
    return {
        key,
        label,
        hue: roundColorMetric(palette.hue),
        chroma: roundColorMetric(palette.chroma),
        tones: MATERIAL_TONES.map((tone) => ({
            tone,
            hex: hexFromArgb(palette.tone(tone)).toUpperCase(),
        })),
    }
}

function createSchemePreview(
    mode: MaterialThemeMode,
    label: string,
    scheme: Scheme,
): MaterialSchemePreview {
    const schemeJson = scheme.toJSON()
    return {
        mode,
        label,
        roles: ROLE_CONFIG.map(({key, label: roleLabel}) => ({
            key,
            label: roleLabel,
            hex: hexFromArgb(schemeJson[key as RoleKey]).toUpperCase(),
        })),
    }
}

function createTokenValue(label: string, hex: string, alpha?: number): FcSemanticTokenValue {
    return {
        label,
        value: alpha ? `${hex} / ${alpha}%` : hex,
        swatch: formatCssTokenValue(hex, alpha),
    }
}

function formatCssTokenValue(hex: string, alpha?: number): string {
    if (!alpha) return hex
    return `color-mix(in srgb, ${hex} ${alpha}%, transparent)`
}

function getToneHex(tones: MaterialToneSwatch[], tone: number): string {
    return tones.find((item) => item.tone === tone)?.hex ?? '#000000'
}

function roundColorMetric(value: number): number {
    return Math.round(value * 10) / 10
}
