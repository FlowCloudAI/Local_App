import type {MapPreviewKeyLocationIcon, MapRgbaColor} from 'flowcloudai-ui'
import {createParchmentTexture, createRicePaperTexture, svgToDataUrl} from '../../common'
import type {
    PixiEffectPluginId,
    PixiGeneratedBackgroundTexture,
    PixiLocationIconAsset,
    PixiLocationIconSet,
} from '../types'

export type PixiCompassAssetId = 'tolkien-compass' | 'ink-minimal-compass'
export type PixiBrushAssetId = 'tolkien-coastline' | 'ink-boundary'

interface PixiLocationIconAssetInput {
    iconSet: PixiLocationIconSet
    asset?: PixiLocationIconAsset
    type: string
    color: string
}

interface CompassAssetInput {
    ctx: CanvasRenderingContext2D
    asset: PixiCompassAssetId
    cx: number
    cy: number
    size: number
    color: MapRgbaColor
}

interface PixiEffectAssetInput {
    ctx: CanvasRenderingContext2D
    asset: PixiEffectPluginId
    width: number
    height: number
    shapes: { polygon: [number, number][] }[]
    params?: Record<string, unknown>
}

export interface PixiBrushAssetProfile {
    jitterMultiplier: number
    lineWidthMultiplier: number
    alphaMultiplier: number
}

function rgbaToCss(color: MapRgbaColor, alphaMultiplier = 1): string {
    const alpha = Math.max(0, Math.min(1, (color[3] / 255) * alphaMultiplier))
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`
}

function getNumberParam(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getStringParam(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

function pointNoise(seed: number): number {
    const value = Math.sin(seed * 12.9898) * 43758.5453
    return value - Math.floor(value)
}

function isMajorTolkienLocation(type: string): boolean {
    return /城|都|王都|京|要塞|港/.test(type)
}

function resolveTolkienAsset(type: string, asset?: PixiLocationIconAsset): PixiLocationIconAsset {
    if (asset) return asset
    if (/遗迹|神殿/.test(type)) return 'tolkien-ruin'
    if (/村|镇|营地/.test(type)) return 'tolkien-settlement'
    return isMajorTolkienLocation(type) ? 'tolkien-castle' : 'tolkien-tower'
}

function resolveInkStampAsset(type: string, asset?: PixiLocationIconAsset): PixiLocationIconAsset {
    if (asset) return asset
    return /[都京]/.test(type) ? 'ink-seal' : 'ink-dot'
}

function makeTolkienCastleIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="44" viewBox="0 0 40 44">
                <path d="M10 40V18L7 15V12L20 6L33 12V15L30 18V40H10Z"
                      fill="#f7e7bc" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
                <path d="M7 40H33" stroke="${color}" stroke-width="1.4"/>
                <path d="M13 40V26H17V40M23 40V26H27V40" stroke="${color}" stroke-width="1.2"/>
                <circle cx="20" cy="14" r="2.2" fill="${color}"/>
                <path d="M14 18H26" stroke="${color}" stroke-width="0.9" stroke-opacity="0.6"/>
            </svg>
        `),
        width: 40,
        height: 44,
        anchorX: 20,
        anchorY: 40,
    }
}

function makeTolkienTowerIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="36" viewBox="0 0 32 36">
                <path d="M7 32V16L5 13V11L16 5L27 11V13L25 16V32H7Z"
                      fill="#f7e7bc" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M5 32H27" stroke="${color}" stroke-width="1.2"/>
                <circle cx="16" cy="13" r="1.8" fill="${color}"/>
            </svg>
        `),
        width: 32,
        height: 36,
        anchorX: 16,
        anchorY: 32,
    }
}

function makeTolkienSettlementIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="34" height="30" viewBox="0 0 34 30">
                <path d="M5 26V15L13 8L21 15V26H5Z" fill="#f7e7bc" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M18 26V13L26 7L31 12V26H18Z" fill="#f1dca8" stroke="${color}" stroke-width="1.3" stroke-linejoin="round"/>
                <path d="M3 26H32" stroke="${color}" stroke-width="1.2"/>
                <path d="M12 26V19H15V26" stroke="${color}" stroke-width="1"/>
            </svg>
        `),
        width: 34,
        height: 30,
        anchorX: 17,
        anchorY: 26,
    }
}

function makeTolkienRuinIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
                <path d="M7 28H29" stroke="${color}" stroke-width="1.4"/>
                <path d="M10 28V11M17 28V8M24 28V13" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M8 11H14M15 8H22M22 13H28" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M6 30C10 27 12 29 15 27C19 25 22 30 29 27" fill="none" stroke="${color}" stroke-width="0.8" stroke-opacity="0.55"/>
            </svg>
        `),
        width: 34,
        height: 34,
        anchorX: 17,
        anchorY: 28,
    }
}

function makeInkDotIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="4.2" fill="${color}" fill-opacity="0.86"/>
                <circle cx="9.2" cy="9.4" r="5.8" fill="${color}" fill-opacity="0.13"/>
            </svg>
        `),
        width: 20,
        height: 20,
        anchorX: 10,
        anchorY: 10,
    }
}

function makeInkSealIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
                <rect x="5" y="5" width="18" height="18" rx="2.4" fill="${color}" fill-opacity="0.78"/>
                <path d="M9 10H19M9 14H18M9 18H15" stroke="#fff7ef" stroke-width="1.2" stroke-linecap="round" stroke-opacity="0.72"/>
                <rect x="4.2" y="4.2" width="19.6" height="19.6" rx="2.8" fill="none" stroke="${color}" stroke-width="1.2" stroke-opacity="0.42"/>
            </svg>
        `),
        width: 28,
        height: 28,
        anchorX: 14,
        anchorY: 14,
    }
}

export function buildPixiLocationIconAsset(input: PixiLocationIconAssetInput): MapPreviewKeyLocationIcon | undefined {
    const asset = input.iconSet === 'tolkien'
        ? resolveTolkienAsset(input.type, input.asset)
        : resolveInkStampAsset(input.type, input.asset)

    switch (asset) {
        case 'tolkien-castle':
            return makeTolkienCastleIcon(input.color)
        case 'tolkien-settlement':
            return makeTolkienSettlementIcon(input.color)
        case 'tolkien-ruin':
            return makeTolkienRuinIcon(input.color)
        case 'tolkien-tower':
            return makeTolkienTowerIcon(input.color)
        case 'ink-seal':
            return makeInkSealIcon(input.color)
        case 'ink-dot':
            return makeInkDotIcon(input.color)
        default:
            return undefined
    }
}

export function createPixiPaperTextureAsset(
    texture: PixiGeneratedBackgroundTexture | undefined,
    width: number,
    height: number,
): string {
    if (texture === 'parchment') return createParchmentTexture(width, height)
    if (texture === 'rice-paper') return createRicePaperTexture(width, height)
    return ''
}

export function getPixiBrushAssetProfile(asset: PixiBrushAssetId | undefined): PixiBrushAssetProfile {
    if (asset === 'ink-boundary') {
        return {
            jitterMultiplier: 1.7,
            lineWidthMultiplier: 1,
            alphaMultiplier: 0.88,
        }
    }

    return {
        jitterMultiplier: 1,
        lineWidthMultiplier: 1,
        alphaMultiplier: 1,
    }
}

function buildCirclePoints(cx: number, cy: number, radius: number, segments: number): [number, number][] {
    const points: [number, number][] = []
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
    }
    return points
}

function drawClosedPath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
    if (!points.length) return
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1])
    }
    ctx.closePath()
}

function drawPolygonPath(ctx: CanvasRenderingContext2D, polygon: [number, number][]) {
    if (polygon.length < 3) return
    ctx.beginPath()
    ctx.moveTo(polygon[0][0], polygon[0][1])
    for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i][0], polygon[i][1])
    }
    ctx.closePath()
}

export function drawPixiCompassAsset({ctx, asset, cx, cy, size, color}: CompassAssetInput): void {
    const radius = size / 2
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    if (asset === 'ink-minimal-compass') {
        ctx.strokeStyle = rgbaToCss(color, 0.55)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.92, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx, cy - radius * 0.72)
        ctx.lineTo(cx + radius * 0.14, cy)
        ctx.lineTo(cx, cy + radius * 0.72)
        ctx.lineTo(cx - radius * 0.14, cy)
        ctx.closePath()
        ctx.stroke()
        ctx.restore()
        return
    }

    drawClosedPath(ctx, buildCirclePoints(cx, cy, radius * 1.06, 40))
    ctx.fillStyle = 'rgba(244, 225, 180, 0.43)'
    ctx.strokeStyle = rgbaToCss(color, 0.45)
    ctx.lineWidth = 1
    ctx.fill()
    ctx.stroke()

    const directions = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]
    directions.forEach((angle, index) => {
        const isNorth = index === 0
        const tip: [number, number] = [
            cx + Math.cos(angle) * radius * 0.84,
            cy + Math.sin(angle) * radius * 0.84,
        ]
        const left: [number, number] = [
            cx + Math.cos(angle + Math.PI / 2) * radius * 0.16,
            cy + Math.sin(angle + Math.PI / 2) * radius * 0.16,
        ]
        const right: [number, number] = [
            cx + Math.cos(angle - Math.PI / 2) * radius * 0.16,
            cy + Math.sin(angle - Math.PI / 2) * radius * 0.16,
        ]

        drawClosedPath(ctx, [left, tip, right])
        ctx.fillStyle = rgbaToCss(color, isNorth ? 0.27 : 0.14)
        ctx.strokeStyle = rgbaToCss(color, isNorth ? 0.88 : 0.6)
        ctx.lineWidth = isNorth ? 1.8 : 1.3
        ctx.fill()
        ctx.stroke()
    })

    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = rgbaToCss(color, 0.5)
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.12, 0, Math.PI * 2)
    ctx.fillStyle = rgbaToCss(color, 0.28)
    ctx.strokeStyle = rgbaToCss(color)
    ctx.lineWidth = 1.5
    ctx.fill()
    ctx.stroke()

    ctx.restore()
}

function drawPaperGrainEffect({ctx, width, height, params}: PixiEffectAssetInput): void {
    const density = Math.max(80, Math.min(5000, getNumberParam(params?.density, 1300)))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.08)))
    const darkColor = getStringParam(params?.darkColor, 'rgba(70, 45, 22, 1)')
    const lightColor = getStringParam(params?.lightColor, 'rgba(255, 248, 220, 1)')

    ctx.save()
    for (let i = 0; i < density; i++) {
        const x = pointNoise(i * 19.17) * width
        const y = pointNoise(i * 41.71) * height
        const radius = 0.35 + pointNoise(i * 13.11) * 1.15
        const isLight = pointNoise(i * 7.33) > 0.58
        ctx.globalAlpha = opacity * (0.35 + pointNoise(i * 5.9) * 0.65)
        ctx.fillStyle = isLight ? lightColor : darkColor
        ctx.fillRect(x, y, radius, radius)
    }
    ctx.restore()
}

function drawVignetteEffect({ctx, width, height, params}: PixiEffectAssetInput): void {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.18)))
    const inner = Math.max(0, Math.min(1, getNumberParam(params?.inner, 0.38)))
    const color = getStringParam(params?.color, 'rgba(72, 42, 14, 1)')
    const radius = Math.max(width, height) * 0.72
    const gradient = ctx.createRadialGradient(width * 0.5, height * 0.48, radius * inner, width * 0.5, height * 0.5, radius)

    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, color)
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
}

function drawEdgeDarkenEffect({ctx, shapes, params}: PixiEffectAssetInput): void {
    const width = getNumberParam(params?.width, 18)
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.12)))
    const color = getStringParam(params?.color, 'rgba(50, 28, 12, 1)')

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = width
    ctx.globalAlpha = opacity
    for (const shape of shapes) {
        drawPolygonPath(ctx, shape.polygon)
        ctx.stroke()
    }
    ctx.restore()
}

function drawInkBleedEffect({ctx, shapes, params}: PixiEffectAssetInput): void {
    const width = getNumberParam(params?.width, 10)
    const blur = getNumberParam(params?.blur, 5)
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.16)))
    const color = getStringParam(params?.color, 'rgba(16, 16, 16, 1)')

    ctx.save()
    ctx.filter = `blur(${blur}px)`
    ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = width
    ctx.globalAlpha = opacity
    for (const shape of shapes) {
        drawPolygonPath(ctx, shape.polygon)
        ctx.stroke()
    }
    ctx.restore()
}

function drawChromaticAgeingEffect({ctx, width, height, params}: PixiEffectAssetInput): void {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.08)))
    const color = getStringParam(params?.color, 'rgba(139, 83, 28, 1)')

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
}

export function drawPixiEffectAsset(input: PixiEffectAssetInput): void {
    switch (input.asset) {
        case 'paper-grain':
            drawPaperGrainEffect(input)
            break
        case 'vignette':
            drawVignetteEffect(input)
            break
        case 'edge-darken':
            drawEdgeDarkenEffect(input)
            break
        case 'ink-bleed':
            drawInkBleedEffect(input)
            break
        case 'chromatic-ageing':
            drawChromaticAgeingEffect(input)
            break
    }
}
