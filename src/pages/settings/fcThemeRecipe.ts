import {
    argbFromHex,
    Hct,
    hexFromArgb,
    themeFromSourceColor,
    TonalPalette,
} from '@material/material-color-utilities'
import {normalizeHexColor, type MaterialToneSwatch} from './materialThemePreview'

export interface FcThemeRecipe {
    id: string
    label: string
    description: string
    primarySeed: string
    neutralSeed: string
    neutralChroma: number
    neutralVariantChroma: number
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
    palette?: 'primary' | 'neutral' | 'neutralVariant'
    lightTone?: number
    darkTone?: number
    lightAlpha?: number
    darkAlpha?: number
    kind?: 'onPrimary'
}

export const DEFAULT_FC_THEME_RECIPE_ID = 'liuyun'

export const FC_THEME_RECIPES: FcThemeRecipe[] = [
    {
        id: 'liuyun',
        label: '流云',
        description: '干净微暖的默认蓝调。',
        primarySeed: '#378ADD',
        neutralSeed: '#F7F4EE',
        neutralChroma: 3.5,
        neutralVariantChroma: 7,
    },
    {
        id: 'ziteng',
        label: '紫藤',
        description: '冷灰紫背景，适合夜间整理设定。',
        primarySeed: '#7C5CE8',
        neutralSeed: '#F1EDF7',
        neutralChroma: 5,
        neutralVariantChroma: 10,
    },
    {
        id: 'qingsong',
        label: '青松',
        description: '低饱和青灰，稳定、安静。',
        primarySeed: '#2E7D63',
        neutralSeed: '#EEF5F1',
        neutralChroma: 5,
        neutralVariantChroma: 11,
    },
    {
        id: 'wanxia',
        label: '晚霞',
        description: '温暖橙红，适合轻松构思。',
        primarySeed: '#D86B47',
        neutralSeed: '#F8EFE8',
        neutralChroma: 6,
        neutralVariantChroma: 12,
    },
    {
        id: 'hupo',
        label: '琥珀',
        description: '纸张感更强的暖黄棕。',
        primarySeed: '#B7791F',
        neutralSeed: '#F5EBD6',
        neutralChroma: 7,
        neutralVariantChroma: 13,
    },
    {
        id: 'monlan',
        label: '墨蓝',
        description: '更专注的深蓝灰底色。',
        primarySeed: '#35618F',
        neutralSeed: '#EEF2F6',
        neutralChroma: 4,
        neutralVariantChroma: 9,
    },
    {
        id: 'yuebai',
        label: '月白',
        description: '近乎无色的轻冷背景。',
        primarySeed: '#6A8FB8',
        neutralSeed: '#F4F7FA',
        neutralChroma: 2,
        neutralVariantChroma: 6,
    },
    {
        id: 'nuanzhi',
        label: '暖纸',
        description: '偏稿纸的柔和暖底。',
        primarySeed: '#9B7044',
        neutralSeed: '#F4E8D2',
        neutralChroma: 8,
        neutralVariantChroma: 14,
    },
]

const FC_THEME_TOKEN_RULES: FcThemeTokenRule[] = [
    {token: '--fc-color-primary', label: '主色', group: '主色', palette: 'primary', lightTone: 50, darkTone: 70},
    {token: '--fc-color-primary-hover', label: '悬停', group: '主色', palette: 'primary', lightTone: 40, darkTone: 80},
    {token: '--fc-color-primary-active', label: '按下', group: '主色', palette: 'primary', lightTone: 30, darkTone: 90},
    {token: '--fc-color-primary-subtle', label: '弱背景', group: '主色', palette: 'primary', lightTone: 95, darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-border-focus', label: '焦点边框', group: '主色', palette: 'primary', lightTone: 50, darkTone: 60},
    {token: '--fc-color-text-link', label: '链接', group: '主色', palette: 'primary', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-link-hover', label: '链接悬停', group: '主色', palette: 'primary', lightTone: 30, darkTone: 80},
    {token: '--fc-color-text-on-primary', label: '主色上文字', group: '主色', kind: 'onPrimary'},

    {token: '--fc-color-bg', label: '页面背景', group: '背景', palette: 'neutral', lightTone: 99, darkTone: 8},
    {token: '--fc-color-bg-secondary', label: '工作台背景', group: '背景', palette: 'neutral', lightTone: 97, darkTone: 12},
    {token: '--fc-color-bg-tertiary', label: '悬停背景', group: '背景', palette: 'neutralVariant', lightTone: 94, darkTone: 16},
    {token: '--fc-color-bg-elevated', label: '浮层背景', group: '背景', palette: 'neutral', lightTone: 100, darkTone: 18},

    {token: '--fc-color-border', label: '边框', group: '边框', palette: 'neutralVariant', lightTone: 84, darkTone: 24},
    {token: '--fc-color-border-light', label: '浅边框', group: '边框', palette: 'neutralVariant', lightTone: 90, darkTone: 18},
    {token: '--fc-color-border-hover', label: '边框悬停', group: '边框', palette: 'neutralVariant', lightTone: 55, darkTone: 42},

    {token: '--fc-color-text', label: '正文', group: '文字', palette: 'neutral', lightTone: 10, darkTone: 92},
    {token: '--fc-color-text-secondary', label: '次级文字', group: '文字', palette: 'neutral', lightTone: 38, darkTone: 68},
    {token: '--fc-color-text-tertiary', label: '辅助文字', group: '文字', palette: 'neutral', lightTone: 60, darkTone: 45},
    {token: '--fc-color-text-disabled', label: '禁用文字', group: '文字', palette: 'neutral', lightTone: 65, darkTone: 35},
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
    const neutralHct = Hct.fromInt(argbFromHex(neutralSeed))
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
        tokens: FC_THEME_TOKEN_RULES.map((rule) => createTokenPreview(rule, {
            primary: primaryPalette,
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
    palettes: Record<'primary' | 'neutral' | 'neutralVariant', TonalPalette>,
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

    const palette = palettes[rule.palette ?? 'primary']
    const lightTone = rule.lightTone ?? 50
    const darkTone = rule.darkTone ?? 70
    const lightHex = getToneHex(palette, lightTone)
    const darkHex = getToneHex(palette, darkTone)
    return {
        token: rule.token,
        label: rule.label,
        group: rule.group,
        light: createToneTokenValue(`Light T${lightTone}`, lightHex, rule.lightAlpha),
        dark: createToneTokenValue(`Dark T${darkTone}`, darkHex, rule.darkAlpha),
    }
}

function createToneSwatches(palette: TonalPalette): MaterialToneSwatch[] {
    return [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 97, 99, 100].map((tone) => ({
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
