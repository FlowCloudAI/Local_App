import {
    type MapMarkerClass,
    type MapPreviewKeyLocationIcon,
    type MapRgbaColor,
} from '../../../components/MapShapeEditor'
import {createParchmentTexture, createRicePaperTexture, makeSeededRng, svgToDataUrl} from '../../common'
import type {
    PixiEffectPluginId,
    PixiGeneratedBackgroundTexture,
    PixiLocationIconAsset,
    PixiLocationIconSet,
} from '../types'
import tolkienHill1Url from './terrain/tolkien/hill-1.png'
import tolkienHill2Url from './terrain/tolkien/hill-2.png'
import tolkienHill3Url from './terrain/tolkien/hill-3.png'
import tolkienMountain1Url from './terrain/tolkien/mountain-1.png'
import tolkienMountain2Url from './terrain/tolkien/mountain-2.png'
import tolkienMountain3Url from './terrain/tolkien/mountain-3.png'
import tolkienTree1Url from './terrain/tolkien/tree-1.png'
import tolkienTree2Url from './terrain/tolkien/tree-2.png'
import tolkienTree3Url from './terrain/tolkien/tree-3.png'

export type PixiCompassAssetId = 'tolkien-compass' | 'ink-minimal-compass'
export type PixiBrushAssetId = 'tolkien-coastline' | 'ink-boundary'
export type PixiTerrainSymbolAssetId =
    | 'flat-mountain'
    | 'tolkien-mountain'
    | 'tolkien-hill'
    | 'tolkien-tree'
    | 'ink-mountain'

export interface PixiTerrainSymbolAsset {
    url: string
    width: number
    height: number
    anchorX: number
    anchorY: number
}

type PixiTerrainSymbolVariants = readonly [
    PixiTerrainSymbolAsset,
    PixiTerrainSymbolAsset,
    PixiTerrainSymbolAsset,
]

const TOLKIEN_TERRAIN_SYMBOL_ASSETS: Partial<Record<PixiTerrainSymbolAssetId, PixiTerrainSymbolVariants>> = {
    'tolkien-mountain': [
        {url: tolkienMountain1Url, width: 512, height: 512, anchorX: 256, anchorY: 447},
        {url: tolkienMountain2Url, width: 512, height: 512, anchorX: 256, anchorY: 487},
        {url: tolkienMountain3Url, width: 512, height: 512, anchorX: 256, anchorY: 469},
    ],
    'tolkien-hill': [
        {url: tolkienHill1Url, width: 512, height: 512, anchorX: 256, anchorY: 512},
        {url: tolkienHill2Url, width: 512, height: 512, anchorX: 256, anchorY: 512},
        {url: tolkienHill3Url, width: 512, height: 512, anchorX: 256, anchorY: 503},
    ],
    'tolkien-tree': [
        {url: tolkienTree1Url, width: 256, height: 256, anchorX: 128, anchorY: 256},
        {url: tolkienTree2Url, width: 256, height: 256, anchorX: 128, anchorY: 256},
        {url: tolkienTree3Url, width: 256, height: 256, anchorX: 128, anchorY: 256},
    ],
}

interface PixiLocationIconAssetInput {
    iconSet: PixiLocationIconSet
    asset: PixiLocationIconAsset
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

export function buildPixiTerrainSymbolAsset(
    asset: PixiTerrainSymbolAssetId,
    color: string,
    variant: number,
): PixiTerrainSymbolAsset {
    const normalizedVariant = Math.abs(Math.round(variant)) % 3
    const imageVariants = TOLKIEN_TERRAIN_SYMBOL_ASSETS[asset]
    if (imageVariants) return imageVariants[normalizedVariant]

    if (asset === 'flat-mountain') {
        const peaks = [
            'M3 29L15 9L23 20L29 11L43 29Z',
            'M3 29L12 14L20 22L28 7L43 29Z',
            'M3 29L17 6L27 21L33 13L43 29Z',
        ][normalizedVariant]
        return {
            url: svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="46" height="32" viewBox="0 0 46 32">
                <path d="${peaks}" fill="#ffffff" fill-opacity="0.72" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M10 29L16 20L20 24M23 20L29 13L34 22" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.58"/>
            </svg>`),
            width: 46,
            height: 32,
            anchorX: 23,
            anchorY: 29,
        }
    }

    const ridges = [
        'M2 37C8 30 12 22 18 13C22 21 26 28 29 31C34 25 37 19 42 10C46 22 50 31 56 37',
        'M2 37C9 29 14 18 20 8C25 21 29 29 32 32C38 24 42 17 47 12C51 23 54 31 58 37',
        'M2 37C8 31 13 24 17 16C22 24 26 29 30 33C35 28 39 18 44 7C49 22 53 31 58 37',
    ][normalizedVariant]
    return {
        url: svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="42" viewBox="0 0 60 42">
            <path d="${ridges}" fill="${color}" fill-opacity="0.13"/>
            <path d="${ridges}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.72"/>
            <path d="M5 35C17 31 23 38 34 34C43 31 49 36 57 33" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.32"/>
            <path d="M9 28C18 25 24 29 31 27C39 25 45 28 52 25" fill="none" stroke="#fbfaf7" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.68"/>
        </svg>`),
        width: 60,
        height: 42,
        anchorX: 30,
        anchorY: 37,
    }
}

function makeFlatMarkerIcon(markerClass: MapMarkerClass, color: string): MapPreviewKeyLocationIcon {
    const body = (() => {
        switch (markerClass) {
            case 'major-city':
                return `<circle cx="16" cy="15" r="11" fill="#fff" stroke="${color}" stroke-width="2"/><circle cx="16" cy="15" r="6.5" fill="${color}"/><path d="M16 7V23M8 15H24" stroke="#fff" stroke-width="1.6"/>`
            case 'city':
                return `<circle cx="16" cy="15" r="9" fill="#fff" stroke="${color}" stroke-width="2"/><rect x="11" y="10" width="10" height="10" rx="2" fill="${color}"/>`
            case 'town':
                return `<path d="M4 24H28" stroke="${color}" stroke-width="2"/><path d="M6 23V15L11 11L16 15V23M15 23V13L21 8L27 13V23" fill="#fff" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`
            case 'landmark':
                return `<path d="M16 4L27 15L16 27L5 15Z" fill="#fff" stroke="${color}" stroke-width="2"/><path d="M16 9L18 13L23 15L18 17L16 22L14 17L9 15L14 13Z" fill="${color}"/>`
            case 'event':
                return `<path d="M16 4L27 15L16 27L5 15Z" fill="${color}"/><path d="M16 9V17" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="21" r="1.5" fill="#fff"/>`
            case 'ruin':
                return `<circle cx="16" cy="15" r="12" fill="#fff" fill-opacity="0.94" stroke="${color}" stroke-opacity="0.24"/><path d="M5 25H27M9 24V11M16 24V8M23 24V13M7 11H13M14 8H21M21 13H27" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
            case 'harbor':
                return `<circle cx="16" cy="15" r="12" fill="#fff" fill-opacity="0.94" stroke="${color}" stroke-opacity="0.24"/><circle cx="16" cy="7" r="2.5" fill="none" stroke="${color}" stroke-width="2"/><path d="M16 10V25M9 14H23M7 19C8 25 12 27 16 27C20 27 24 25 25 19M7 19L11 18M25 19L21 18" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
            default:
                return `<path d="M16 3C10.5 3 6 7.5 6 13C6 20 16 29 16 29C16 29 26 20 26 13C26 7.5 21.5 3 16 3Z" fill="#fff" stroke="${color}" stroke-width="2"/><circle cx="16" cy="13" r="4" fill="${color}"/>`
        }
    })()

    return {
        url: svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`),
        width: 32,
        height: 32,
        anchorX: 16,
        anchorY: 28,
    }
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
                <circle cx="17" cy="17" r="14" fill="#f7e7bc" fill-opacity="0.92" stroke="${color}" stroke-width="0.8" stroke-opacity="0.3"/>
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

function makeTolkienMarkerIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32">
                <path d="M14 29C14 29 5 21 5 13A9 9 0 0 1 23 13C23 21 14 29 14 29Z" fill="#f7e7bc" stroke="${color}" stroke-width="1.6"/>
                <circle cx="14" cy="13" r="3.2" fill="${color}"/>
            </svg>
        `),
        width: 28,
        height: 32,
        anchorX: 14,
        anchorY: 29,
    }
}

function makeTolkienLandmarkIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="36" viewBox="0 0 30 36">
                <path d="M9 31L11 9L16 4L21 10L23 31Z" fill="#ead2a2" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M15 8L14 27M10 31H24" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.7"/>
            </svg>
        `),
        width: 30,
        height: 36,
        anchorX: 15,
        anchorY: 31,
    }
}

function makeTolkienEventIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="34" viewBox="0 0 32 34">
                <circle cx="16" cy="17" r="14" fill="#f7e7bc" fill-opacity="0.92" stroke="${color}" stroke-width="0.8" stroke-opacity="0.3"/>
                <path d="M9 29L23 8M23 29L9 8" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                <path d="M20 7L27 5L25 12ZM12 7L5 5L7 12Z" fill="#f7e7bc" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M6 29H12M20 29H26" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `),
        width: 32,
        height: 34,
        anchorX: 16,
        anchorY: 29,
    }
}

function makeTolkienHarborIcon(color: string): MapPreviewKeyLocationIcon {
    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="34" height="36" viewBox="0 0 34 36">
                <circle cx="17" cy="17" r="14" fill="#f7e7bc" fill-opacity="0.92" stroke="${color}" stroke-width="0.8" stroke-opacity="0.3"/>
                <circle cx="17" cy="7" r="2.5" fill="#f7e7bc" stroke="${color}" stroke-width="1.5"/>
                <path d="M17 10V29M10 14H24M7 22C8 29 12 32 17 32C22 32 26 29 27 22M7 22L12 20M27 22L22 20" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 33C9 31 12 34 17 32C22 30 25 34 29 32" fill="none" stroke="${color}" stroke-width="0.9" stroke-opacity="0.55"/>
            </svg>
        `),
        width: 34,
        height: 36,
        anchorX: 17,
        anchorY: 32,
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

function makeInkClassIcon(markerClass: MapMarkerClass, color: string): MapPreviewKeyLocationIcon {
    if (markerClass === 'marker') return makeInkDotIcon(color)
    if (markerClass === 'major-city') return makeInkSealIcon(color)

    const body = (() => {
        switch (markerClass) {
            case 'city':
                return `<circle cx="14" cy="14" r="12" fill="#fbfaf7" fill-opacity="0.94" stroke="${color}" stroke-width="0.8" stroke-opacity="0.28"/><circle cx="14" cy="14" r="7" fill="none" stroke="${color}" stroke-width="2.2" stroke-opacity="0.86"/><circle cx="14.5" cy="13.5" r="3.2" fill="${color}" fill-opacity="0.82"/>`
            case 'town':
                return `<circle cx="8" cy="16" r="3.2" fill="${color}" fill-opacity="0.78"/><circle cx="14" cy="11" r="3.8" fill="${color}" fill-opacity="0.9"/><circle cx="20" cy="16" r="3" fill="${color}" fill-opacity="0.7"/><path d="M5 21C10 19 17 22 23 20" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-opacity="0.55"/>`
            case 'landmark':
                return `<circle cx="14" cy="14" r="12" fill="#fbfaf7" fill-opacity="0.94" stroke="${color}" stroke-width="0.8" stroke-opacity="0.28"/><path d="M4 22L11 11L15 16L19 7L25 22" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 23C12 21 18 24 24 21" stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.5"/>`
            case 'event':
                return `<path d="M14 3L17 10L24 7L20 14L25 19L17 18L14 25L11 18L3 20L8 14L4 8L11 10Z" fill="${color}" fill-opacity="0.78"/><circle cx="14" cy="14" r="2.2" fill="#fff7ef" fill-opacity="0.78"/>`
            case 'ruin':
                return `<circle cx="14" cy="14" r="12" fill="#fbfaf7" fill-opacity="0.94" stroke="${color}" stroke-width="0.8" stroke-opacity="0.28"/><path d="M5 23H24M8 22V11M14 22V7M20 22V13M7 11H11M12 7H18M19 13H24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.82"/>`
            case 'harbor':
                return `<circle cx="14" cy="14" r="12" fill="#fbfaf7" fill-opacity="0.94" stroke="${color}" stroke-width="0.8" stroke-opacity="0.28"/><path d="M14 5V21M8 10H20M5 17C7 23 11 25 14 25C18 25 22 22 23 17" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M4 25C9 22 12 27 17 24C21 22 24 25 26 24" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.58"/>`
            default:
                return ''
        }
    })()

    return {
        url: svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">${body}</svg>`),
        width: 28,
        height: 28,
        anchorX: 14,
        anchorY: 24,
    }
}

export function buildPixiLocationIconAsset(input: PixiLocationIconAssetInput): MapPreviewKeyLocationIcon | undefined {
    const markerClass = input.asset
    if (input.iconSet === 'flat') return makeFlatMarkerIcon(markerClass, input.color)
    if (input.iconSet === 'ink-stamp') return makeInkClassIcon(markerClass, input.color)

    switch (markerClass) {
        case 'marker':
            return makeTolkienMarkerIcon(input.color)
        case 'major-city':
            return makeTolkienCastleIcon(input.color)
        case 'city':
            return makeTolkienTowerIcon(input.color)
        case 'town':
            return makeTolkienSettlementIcon(input.color)
        case 'landmark':
            return makeTolkienLandmarkIcon(input.color)
        case 'event':
            return makeTolkienEventIcon(input.color)
        case 'ruin':
            return makeTolkienRuinIcon(input.color)
        case 'harbor':
            return makeTolkienHarborIcon(input.color)
    }
}

/**
 * 纸纹 canvas 按 (纹理类型, 尺寸) 缓存：生成器是确定性 PRNG，同 key 结果恒等，缓存安全。
 * 每次编译都重新生成超采样大图（含逐像素噪声循环）是重复开销；命中缓存后编译只剩纹理上传。
 * 少量 LRU 条目即可覆盖"同一地图反复调参"的主场景。
 */
const paperTextureCanvasCache = new Map<string, HTMLCanvasElement>()
const PAPER_TEXTURE_CACHE_LIMIT = 4

export function getPixiPaperTextureCanvas(
    texture: PixiGeneratedBackgroundTexture | undefined,
    width: number,
    height: number,
): HTMLCanvasElement | null {
    if (!texture || width <= 0 || height <= 0) return null

    const key = `${texture}:${width}x${height}`
    const cached = paperTextureCanvasCache.get(key)
    if (cached) {
        // LRU：重插使其成为最新条目
        paperTextureCanvasCache.delete(key)
        paperTextureCanvasCache.set(key, cached)
        return cached
    }

    const canvas = texture === 'parchment'
        ? createParchmentTexture(width, height)
        : createRicePaperTexture(width, height)
    if (!canvas) return null

    paperTextureCanvasCache.set(key, canvas)
    if (paperTextureCanvasCache.size > PAPER_TEXTURE_CACHE_LIMIT) {
        const oldest = paperTextureCanvasCache.keys().next().value
        if (oldest !== undefined) paperTextureCanvasCache.delete(oldest)
    }
    return canvas
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
    const density = Math.max(80, Math.min(20000, getNumberParam(params?.density, 1300)))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params?.opacity, 0.08)))
    const darkColor = getStringParam(params?.darkColor, 'rgba(70, 45, 22, 1)')
    const lightColor = getStringParam(params?.lightColor, 'rgba(255, 248, 220, 1)')
    // 均匀随机撒点：原来用 fract(sin(i·k)) 哈希，对规则 i 步长会呈结构化/准周期分布，
    // 缩放到屏幕上形成规则网格般的摩尔纹。改用 mulberry32 PRNG，分布真随机、无摩尔纹。
    const rng = makeSeededRng(Math.round(width) * 6151 + Math.round(height) * 3079 + 101)

    ctx.save()
    for (let i = 0; i < density; i++) {
        const x = rng() * width
        const y = rng() * height
        const radius = 0.35 + rng() * 1.15
        const isLight = rng() > 0.58
        ctx.globalAlpha = opacity * (0.35 + rng() * 0.65)
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
        // chromatic-ageing 不在此绘制：multiply 对透明叠加 canvas 无混合对象，
        // 由 overlays 的 PixiChromaticAgeingLayer 以 blendMode 图层实现。
    }
}
