/**
 * Pixi 地图风格 Shader 工具函数
 */

export * from './coastField'

/**
 * 获取数字参数，带默认值保护
 */
export function getNumberParam(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 获取字符串参数，带默认值保护
 */
export function getStringParam(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

/**
 * 获取布尔参数，带默认值保护
 */
export function getBooleanParam(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

/**
 * 限制值在范围内
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

/**
 * 简单噪声函数（用于 CPU 端测试）
 */
export function simpleHash(x: number, y: number): number {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return value - Math.floor(value)
}

/**
 * 检测点是否在多边形内（射线法）
 */
export function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    const [x, y] = point
    let inside = false

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]

        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
        if (intersect) inside = !inside
    }

    return inside
}

/**
 * 计算点到线段的最短距离
 */
export function distanceToSegment(
    point: [number, number],
    segmentStart: [number, number],
    segmentEnd: [number, number]
): number {
    const [px, py] = point
    const [x1, y1] = segmentStart
    const [x2, y2] = segmentEnd

    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
        // 线段退化为点
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    }

    // 投影参数 t
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared
    t = Math.max(0, Math.min(1, t))

    // 最近点
    const closestX = x1 + t * dx
    const closestY = y1 + t * dy

    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2)
}

/**
 * 计算点到多边形边界的最短距离
 */
export function distanceToPolygonBoundary(
    point: [number, number],
    polygon: [number, number][]
): number {
    let minDist = Infinity

    for (let i = 0; i < polygon.length; i++) {
        const start = polygon[i]
        const end = polygon[(i + 1) % polygon.length]
        const dist = distanceToSegment(point, start, end)
        minDist = Math.min(minDist, dist)
    }

    return minDist
}
