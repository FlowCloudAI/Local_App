import type {MapPreviewBackgroundImage, MapRgbaColor} from 'flowcloudai-ui'
import type {MapStyleBackgroundImageToken, MapStylePaintToken, MapStyleStrokeToken} from './types'

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

/**
 * 将 SVG 字符串编码为 Data URL，供图标和轻量纹理复用。
 */
export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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
