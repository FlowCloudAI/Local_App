import type {MapPreviewBackgroundImage, MapRgbaColor} from '../../components/MapShapeEditor'
import type {MapStyleBackgroundImageToken, MapStylePaintToken, MapStyleStrokeToken} from './types'

const MAP_RENDER_BASE_SCALE = 2
const MAP_RENDER_MAX_DIM = 4096

/**
 * 风格化纹理（叠加层 / 纸底）的超采样倍率：按此倍率放大生成位图、再按场景尺寸显示，
 * 让放大查看时更锐利（避免"场景分辨率单张位图放大即糊"）。按最大边封顶，避免超出 GPU
 * 纹理上限。这些纹理都在已 memoize 的路径里一次性生成，超采样只增加一次性开销，不碰帧率。
 */
export function mapRenderScale(width: number, height: number): number {
    const longest = Math.max(width, height, 1)
    return Math.max(1, Math.min(MAP_RENDER_BASE_SCALE, MAP_RENDER_MAX_DIM / longest))
}

let mapDebugLogCache: boolean | null = null

/**
 * 地图渲染调试日志开关（默认关闭）。地图渲染热路径里散布着大量 `log_message` IPC 日志，
 * 每帧调用会向后端狂发 IPC、显著拖慢帧率；因此默认关闭，只在显式开启时输出。
 * 开启方式：URL 加 `?mapDebug=1`，或设置 `localStorage['fc:mapDebug']='1'` 后刷新。
 */
export function isMapDebugLogEnabled(): boolean {
    if (mapDebugLogCache === null) {
        try {
            const hasWindow = typeof window !== 'undefined'
            const byQuery = hasWindow
                && new URLSearchParams(window.location.search).get('mapDebug') === '1'
            const byStorage = hasWindow
                && window.localStorage?.getItem('fc:mapDebug') === '1'
            mapDebugLogCache = Boolean(byQuery || byStorage)
        } catch {
            mapDebugLogCache = false
        }
    }
    return mapDebugLogCache
}

function clampAlpha(opacity: number | undefined, fallback = 255): number {
    if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return fallback
    return Math.max(0, Math.min(255, Math.round(opacity * 255)))
}

export function hexToRgbaColor(value: string, opacity?: number): MapRgbaColor {
    const normalized = value.trim().replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return [0, 0, 0, clampAlpha(opacity)]
    }

    return [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16),
        clampAlpha(opacity),
    ]
}

export function paintToRgbaColor(paint: MapStylePaintToken): MapRgbaColor {
    return hexToRgbaColor(paint.color, paint.opacity)
}

export function strokeToRgbaColor(stroke: MapStyleStrokeToken): MapRgbaColor {
    return hexToRgbaColor(stroke.color, stroke.opacity)
}

export function makeSolidBackgroundDataUrl(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="${color}"/></svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * 将 SVG 字符串编码为 Data URL，供图标和轻量纹理复用。
 * 使用 base64 编码，兼容 WebView2 等对 ;utf8 非标准格式支持不完整的环境。
 */
export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;base64,${btoa(svg)}`
}

export function resolveBackgroundImage(
    background: MapStyleBackgroundImageToken,
    fallbackColor: string,
): MapPreviewBackgroundImage {
    if (background.kind === 'image' && background.url) {
        return {
            url: background.url,
            opacity: background.opacity ?? 1,
            fit: background.fit ?? 'cover',
        }
    }

    // 纹理生成器由各渲染器风格层自行解释；共享工具只提供安全纯色回退。
    return {
        url: makeSolidBackgroundDataUrl(background.color ?? fallbackColor),
        opacity: background.opacity ?? 1,
        fit: 'fill',
    }
}
