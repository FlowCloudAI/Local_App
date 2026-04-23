import type {MapPreviewBackgroundImage, MapRgbaColor} from 'flowcloudai-ui'
import type {MapStyleBackground, MapStylePaintToken, MapStylePalette, MapStyleStrokeToken} from './types'

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
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function resolveBackgroundImage(
    background: MapStyleBackground,
    palette: MapStylePalette,
): MapPreviewBackgroundImage {
    if (background.kind === 'image' && background.url) {
        return {
            url: background.url,
            opacity: background.opacity ?? 1,
            fit: background.fit ?? 'cover',
        }
    }

    // 纹理生成器后续由 Pixi 插件层接管；当前先回退到可存储的纯色背景。
    const color = background.color ?? palette.ocean
    return {
        url: makeSolidBackgroundDataUrl(color),
        opacity: background.opacity ?? 1,
        fit: 'fill',
    }
}
