/**
 * 将 SVG 字符串编码为 DataURL（utf8 编码）。
 */
export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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
