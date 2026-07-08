/**
 * 转义 HTML 特殊字符。tooltip 的 html 字段最终走 deck.gl / MapPixiPreview 的 innerHTML
 * 渲染，用户或导入的实体名（shape.name / location.name / location.type）必须先转义，
 * 否则可注入 HTML/CSS（`</strong><style>…` 等）。
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * 将 SVG 字符串编码为 DataURL（base64 编码）。
 * 兼容 WebView2 等对 ;utf8 非标准格式支持不完整的环境。
 */
export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * 将 deck.gl 的 RGBA 数组（0-255）转为 hex 字符串（无前缀 #）。
 */
export function deckColorToHex(color: [number, number, number, number]): string {
    return `#${color.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 根据颜色生成 1x1 SVG 的 DataURL，用作海洋/背景底色。
 */
export function makeOceanSvgUrl(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="${color}"/></svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
}
