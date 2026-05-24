import {
    argbFromHex,
    Hct,
    hexFromArgb,
    themeFromSourceColor,
    TonalPalette,
} from '@material/material-color-utilities'
import {normalizeHexColor, type MaterialToneSwatch} from './materialThemePreview'

const MATERIAL_THEME_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 97, 99, 100] as const

type FcThemeLightProfile = 'default' | 'soft' | 'warm'
type FcThemePaletteKey = 'primary' | 'primarySurface' | 'neutral' | 'neutralVariant'
type MaterialThemeTone = typeof MATERIAL_THEME_TONES[number]

export interface FcThemeRecipe {
    id: string
    label: string
    description: string
    primarySeed: string
    primarySurfaceChroma: number
    neutralSeed: string
    neutralChroma: number
    neutralVariantChroma: number
    lightProfile: FcThemeLightProfile
}

export interface FcThemeTokenValue {
    label: string
    value: string
    swatch: string
}

export interface FcThemeTokenPreview {
    token: string
    label: string
    group: '主色' | '背景' | '边框' | '文字'
    light: FcThemeTokenValue
    dark: FcThemeTokenValue
}

export interface FcThemePreview {
    recipe: FcThemeRecipe
    primarySeed: string
    primaryTones: MaterialToneSwatch[]
    neutralTones: MaterialToneSwatch[]
    neutralVariantTones: MaterialToneSwatch[]
    tokens: FcThemeTokenPreview[]
}

interface FcThemeTokenRule {
    token: string
    label: string
    group: FcThemeTokenPreview['group']
    palette?: FcThemePaletteKey
    lightPalette?: FcThemePaletteKey
    darkPalette?: FcThemePaletteKey
    lightTone?: number
    lightToneKey?: keyof FcLightToneProfile
    darkTone?: number
    lightAlpha?: number
    darkAlpha?: number
    kind?: 'onPrimary'
}

interface FcLightToneProfile {
    primarySubtle: number
    bg: number
    bgSecondary: number
    bgTertiary: number
    bgElevated: number
    border: number
    borderLight: number
    borderHover: number
}

export const DEFAULT_FC_THEME_RECIPE_ID = 'liuyun'

const LIGHT_TONE_PROFILES: Record<FcThemeLightProfile, FcLightToneProfile> = {
    default: {
        primarySubtle: 95,
        bg: 99,
        bgSecondary: 97,
        bgTertiary: 95,
        bgElevated: 100,
        border: 90,
        borderLight: 95,
        borderHover: 60,
    },
    soft: {
        primarySubtle: 90,
        bg: 99,
        bgSecondary: 95,
        bgTertiary: 90,
        bgElevated: 100,
        border: 80,
        borderLight: 90,
        borderHover: 50,
    },
    warm: {
        primarySubtle: 90,
        bg: 97,
        bgSecondary: 95,
        bgTertiary: 90,
        bgElevated: 99,
        border: 80,
        borderLight: 90,
        borderHover: 50,
    },
}

export const FC_THEME_RECIPES: FcThemeRecipe[] = [
    {
        id: 'liuyun',
        label: '流云',
        description: '干净微暖的默认蓝调。',
        primarySeed: '#378ADD',
        primarySurfaceChroma: 10,
        neutralSeed: '#F7F4EE',
        neutralChroma: 3.5,
        neutralVariantChroma: 7,
        lightProfile: 'default',
    },
    {
        id: 'ziteng',
        label: '紫藤',
        description: '冷灰紫背景，适合夜间整理设定。',
        primarySeed: '#7C5CE8',
        primarySurfaceChroma: 10,
        neutralSeed: '#F1EDF7',
        neutralChroma: 5,
        neutralVariantChroma: 10,
        lightProfile: 'soft',
    },
    {
        id: 'qingsong',
        label: '青松',
        description: '低饱和青灰，稳定、安静。',
        primarySeed: '#2E7D63',
        primarySurfaceChroma: 8,
        neutralSeed: '#EEF5F1',
        neutralChroma: 5,
        neutralVariantChroma: 11,
        lightProfile: 'soft',
    },
    {
        id: 'wanxia',
        label: '晚霞',
        description: '温暖橙红，适合轻松构思。',
        primarySeed: '#D86B47',
        primarySurfaceChroma: 12,
        neutralSeed: '#F8EFE8',
        neutralChroma: 6,
        neutralVariantChroma: 12,
        lightProfile: 'warm',
    },
    {
        id: 'hupo',
        label: '琥珀',
        description: '纸张感更强的暖黄棕。',
        primarySeed: '#B7791F',
        primarySurfaceChroma: 11,
        neutralSeed: '#F5EBD6',
        neutralChroma: 7,
        neutralVariantChroma: 13,
        lightProfile: 'warm',
    },
    {
        id: 'monlan',
        label: '墨蓝',
        description: '更专注的深蓝灰底色。',
        primarySeed: '#35618F',
        primarySurfaceChroma: 9,
        neutralSeed: '#EEF2F6',
        neutralChroma: 4,
        neutralVariantChroma: 9,
        lightProfile: 'soft',
    },
]

const FC_THEME_TOKEN_RULES: FcThemeTokenRule[] = [
    {token: '--fc-color-primary', label: '主色', group: '主色', palette: 'primary', lightTone: 50, darkTone: 70},
    {token: '--fc-color-primary-hover', label: '悬停', group: '主色', palette: 'primary', lightTone: 40, darkTone: 80},
    {token: '--fc-color-primary-active', label: '按下', group: '主色', palette: 'primary', lightTone: 30, darkTone: 90},
    {token: '--fc-color-primary-subtle', label: '弱背景', group: '主色', palette: 'primary', lightPalette: 'primarySurface', lightToneKey: 'primarySubtle', darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-border-focus', label: '焦点边框', group: '主色', palette: 'primary', lightTone: 50, darkTone: 60},
    {token: '--fc-color-text-link', label: '链接', group: '主色', palette: 'primary', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-link-hover', label: '链接悬停', group: '主色', palette: 'primary', lightTone: 30, darkTone: 80},
    {token: '--fc-color-text-on-primary', label: '主色上文字', group: '主色', kind: 'onPrimary'},

    {token: '--fc-color-bg', label: '页面背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bg', darkTone: 10},
    {token: '--fc-color-bg-secondary', label: '工作台背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bgSecondary', darkTone: 20},
    {token: '--fc-color-bg-tertiary', label: '悬停背景', group: '背景', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'bgTertiary', darkTone: 20},
    {token: '--fc-color-bg-elevated', label: '浮层背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bgElevated', darkTone: 30},

    {token: '--fc-color-border', label: '边框', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'border', darkTone: 30},
    {token: '--fc-color-border-light', label: '浅边框', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'borderLight', darkTone: 20},
    {token: '--fc-color-border-hover', label: '边框悬停', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'borderHover', darkTone: 50},

    {token: '--fc-color-text', label: '正文', group: '文字', palette: 'neutral', lightTone: 10, darkTone: 90},
    {token: '--fc-color-text-secondary', label: '次级文字', group: '文字', palette: 'neutral', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-tertiary', label: '辅助文字', group: '文字', palette: 'neutral', lightTone: 60, darkTone: 50},
    {token: '--fc-color-text-disabled', label: '禁用文字', group: '文字', palette: 'neutral', lightTone: 70, darkTone: 40},
]

export function getFcThemeRecipe(id: string): FcThemeRecipe {
    return FC_THEME_RECIPES.find((recipe) => recipe.id === id) ?? FC_THEME_RECIPES[0]
}

export function createFcThemePreview(
    recipe: FcThemeRecipe,
    primarySeedOverride?: string,
): FcThemePreview | null {
    const primarySeed = normalizeHexColor(primarySeedOverride ?? recipe.primarySeed)
    const neutralSeed = normalizeHexColor(recipe.neutralSeed)
    if (!primarySeed || !neutralSeed) return null

    const primaryTheme = themeFromSourceColor(argbFromHex(primarySeed))
    const primaryHct = Hct.fromInt(argbFromHex(primarySeed))
    const neutralHct = Hct.fromInt(argbFromHex(neutralSeed))
    const primarySurfacePalette = TonalPalette.fromHueAndChroma(primaryHct.hue, recipe.primarySurfaceChroma)
    const neutralPalette = TonalPalette.fromHueAndChroma(neutralHct.hue, recipe.neutralChroma)
    const neutralVariantPalette = TonalPalette.fromHueAndChroma(neutralHct.hue, recipe.neutralVariantChroma)
    const primaryPalette = primaryTheme.palettes.primary
    const primaryTones = createToneSwatches(primaryTheme.palettes.primary)
    const neutralTones = createToneSwatches(neutralPalette)
    const neutralVariantTones = createToneSwatches(neutralVariantPalette)

    return {
        recipe,
        primarySeed,
        primaryTones,
        neutralTones,
        neutralVariantTones,
        tokens: FC_THEME_TOKEN_RULES.map((rule) => createTokenPreview(rule, recipe.lightProfile, {
            primary: primaryPalette,
            primarySurface: primarySurfacePalette,
            neutral: neutralPalette,
            neutralVariant: neutralVariantPalette,
        })),
    }
}

export function createFcThemeOverrideCss(preview: FcThemePreview): string {
    return [
        ':root {',
        ...preview.tokens.map((item) => `  ${item.token}: ${item.light.swatch} !important;`),
        '}',
        '',
        '[data-theme="dark"] {',
        ...preview.tokens.map((item) => `  ${item.token}: ${item.dark.swatch} !important;`),
        '}',
    ].join('\n')
}

function createTokenPreview(
    rule: FcThemeTokenRule,
    lightProfile: FcThemeLightProfile,
    palettes: Record<FcThemePaletteKey, TonalPalette>,
): FcThemeTokenPreview {
    if (rule.kind === 'onPrimary') {
        const lightPrimary = getToneHex(palettes.primary, 50)
        const darkPrimary = getToneHex(palettes.primary, 70)
        return {
            token: rule.token,
            label: rule.label,
            group: rule.group,
            light: createStaticTokenValue('自动对比', pickReadableTextColor(lightPrimary)),
            dark: createStaticTokenValue('自动对比', pickReadableTextColor(darkPrimary)),
        }
    }

    const defaultPaletteKey = rule.palette ?? 'primary'
    const lightPaletteKey = rule.lightPalette ?? defaultPaletteKey
    const darkPaletteKey = rule.darkPalette ?? defaultPaletteKey
    const lightPalette = palettes[lightPaletteKey]
    const darkPalette = palettes[darkPaletteKey]
    const lightTone = normalizeThemeTone(resolveLightTone(rule, lightProfile))
    const darkTone = normalizeThemeTone(rule.darkTone ?? 70)
    const lightHex = getToneHex(lightPalette, lightTone)
    const darkHex = getToneHex(darkPalette, darkTone)
    return {
        token: rule.token,
        label: rule.label,
        group: rule.group,
        light: createToneTokenValue(`Light ${formatPaletteLabel(lightPaletteKey)} T${lightTone}`, lightHex, rule.lightAlpha),
        dark: createToneTokenValue(`Dark T${darkTone}`, darkHex, rule.darkAlpha),
    }
}

function createToneSwatches(palette: TonalPalette): MaterialToneSwatch[] {
    return MATERIAL_THEME_TONES.map((tone) => ({
        tone,
        hex: hexFromArgb(palette.tone(tone)).toUpperCase(),
    }))
}

function createToneTokenValue(label: string, hex: string, alpha?: number): FcThemeTokenValue {
    return {
        label,
        value: alpha ? `${hex} / ${alpha}%` : hex,
        swatch: formatCssTokenValue(hex, alpha),
    }
}

function createStaticTokenValue(label: string, hex: string): FcThemeTokenValue {
    return {
        label,
        value: hex,
        swatch: hex,
    }
}

function formatCssTokenValue(hex: string, alpha?: number): string {
    if (!alpha) return hex
    return `color-mix(in srgb, ${hex} ${alpha}%, transparent)`
}

function getToneHex(palette: TonalPalette, tone: number): string {
    return hexFromArgb(palette.tone(tone)).toUpperCase()
}

function resolveLightTone(rule: FcThemeTokenRule, lightProfile: FcThemeLightProfile): number {
    if (rule.lightToneKey) return LIGHT_TONE_PROFILES[lightProfile][rule.lightToneKey]
    return rule.lightTone ?? 50
}

function normalizeThemeTone(tone: number): MaterialThemeTone {
    if (isMaterialThemeTone(tone)) return tone
    return MATERIAL_THEME_TONES.reduce((nearest, item) => (
        Math.abs(item - tone) < Math.abs(nearest - tone) ? item : nearest
    ))
}

function isMaterialThemeTone(tone: number): tone is MaterialThemeTone {
    return MATERIAL_THEME_TONES.some((item) => item === tone)
}

function formatPaletteLabel(palette: FcThemePaletteKey): string {
    if (palette === 'primary') return '主色'
    if (palette === 'primarySurface') return '主色柔面'
    if (palette === 'neutralVariant') return '中性变体'
    return '中性'
}

function pickReadableTextColor(backgroundHex: string): string {
    const whiteContrast = contrastRatio(backgroundHex, '#FFFFFF')
    const darkContrast = contrastRatio(backgroundHex, '#111111')
    return whiteContrast >= darkContrast ? '#FFFFFF' : '#111111'
}

function contrastRatio(firstHex: string, secondHex: string): number {
    const first = relativeLuminance(hexToRgb(firstHex))
    const second = relativeLuminance(hexToRgb(secondHex))
    const lighter = Math.max(first, second)
    const darker = Math.min(first, second)
    return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.03928
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hexToRgb(hex: string): [number, number, number] {
    const normalized = normalizeHexColor(hex) ?? '#000000'
    return [
        Number.parseInt(normalized.slice(1, 3), 16),
        Number.parseInt(normalized.slice(3, 5), 16),
        Number.parseInt(normalized.slice(5, 7), 16),
    ]
}
