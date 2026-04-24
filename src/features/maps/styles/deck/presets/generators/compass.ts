/**
 * 生成右上角罗盘的 PathLayer 路径数据。
 * 用 4 条箭头臂 + 一个圆圈表示罗盘玫瑰。
 */
export interface CompassPath {
    path: [number, number][]
    color: [number, number, number, number]
    widthPixels: number
}

export interface CompassPolygon {
    polygon: [number, number][]
    fillColor: [number, number, number, number]
    lineColor: [number, number, number, number]
}

function buildCirclePoints(cx: number, cy: number, radius: number, segments: number): [number, number][] {
    const points: [number, number][] = []
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
    }
    return points
}

/**
 * 生成罗盘的填充面，避免只有细线导致缩放后显示不清。
 */
export function buildCompassPolygons(
    cx: number,
    cy: number,
    size: number,
    color: [number, number, number, number] = [90, 58, 28, 200],
): CompassPolygon[] {
    const r = size / 2
    const polygons: CompassPolygon[] = [
        {
            polygon: buildCirclePoints(cx, cy, r * 1.06, 40),
            fillColor: [244, 225, 180, 110],
            lineColor: [color[0], color[1], color[2], 90],
        },
    ]

    const directions = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]
    directions.forEach((angle, index) => {
        const isNorth = index === 0
        const tip: [number, number] = [
            cx + Math.cos(angle) * r * 0.84,
            cy + Math.sin(angle) * r * 0.84,
        ]
        const left: [number, number] = [
            cx + Math.cos(angle + Math.PI / 2) * r * 0.16,
            cy + Math.sin(angle + Math.PI / 2) * r * 0.16,
        ]
        const right: [number, number] = [
            cx + Math.cos(angle - Math.PI / 2) * r * 0.16,
            cy + Math.sin(angle - Math.PI / 2) * r * 0.16,
        ]
        polygons.push({
            polygon: [left, tip, right],
            fillColor: isNorth
                ? [color[0], color[1], color[2], 54]
                : [color[0], color[1], color[2], 28],
            lineColor: [color[0], color[1], color[2], isNorth ? 175 : 120],
        })
    })

    return polygons
}

export function buildCompassPaths(
    cx: number,
    cy: number,
    size: number,
    color: [number, number, number, number] = [90, 58, 28, 200],
): CompassPath[] {
    const r = size / 2
    const paths: CompassPath[] = []

    // 外圆（用多边形近似）
    paths.push({
        path: buildCirclePoints(cx, cy, r, 32),
        color: [color[0], color[1], color[2], Math.round(color[3] * 0.5)],
        widthPixels: 1,
    })

    // 4 个方向箭头臂（N/S/E/W）
    const directions = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]
    directions.forEach((angle, i) => {
        const isNorth = i === 0
        const tipX = cx + Math.cos(angle - Math.PI / 2) * r * 0.88
        const tipY = cy + Math.sin(angle - Math.PI / 2) * r * 0.88
        const baseX = cx
        const baseY = cy
        // 菱形臂：从中心到顶点
        const leftAngle = angle - Math.PI / 2 + Math.PI / 2 + Math.PI / 10
        const rightAngle = angle - Math.PI / 2 + Math.PI / 2 - Math.PI / 10
        const armWidth = r * 0.3
        const armPath: [number, number][] = [
            [baseX + Math.cos(leftAngle) * armWidth * 0.5, baseY + Math.sin(leftAngle) * armWidth * 0.5],
            [tipX, tipY],
            [baseX + Math.cos(rightAngle) * armWidth * 0.5, baseY + Math.sin(rightAngle) * armWidth * 0.5],
        ]
        const armColor: [number, number, number, number] = isNorth
            ? [color[0], color[1], color[2], color[3]]
            : [color[0], color[1], color[2], Math.round(color[3] * 0.65)]
        paths.push({path: armPath, color: armColor, widthPixels: isNorth ? 1.8 : 1.3})
    })

    // 中心点（小圆）
    const centerCircle: [number, number][] = []
    const cr = r * 0.12
    for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2
        centerCircle.push([cx + Math.cos(a) * cr, cy + Math.sin(a) * cr])
    }
    paths.push({path: centerCircle, color, widthPixels: 1.5})

    return paths
}
