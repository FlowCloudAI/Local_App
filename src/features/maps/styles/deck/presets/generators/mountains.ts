import type {MapPreviewScene} from 'flowcloudai-ui'
import type {DecoSymbol} from '../types'

/** 确定性伪随机，基于 seed，保证相同 scene 生成相同符号位置 */
function seededRandom(seed: number): number {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
}

/**
 * 在每个 shape 内部生成 1-2 个山脉装饰符号。
 * 使用形状坐标和序号作为随机种子，保证稳定性（不随 re-render 跳动）。
 */
export function buildDecorativeMountains(scene: MapPreviewScene): DecoSymbol[] {
    const symbols: DecoSymbol[] = []

    scene.shapes.forEach((shape, shapeIndex) => {
        const poly = shape.polygon
        if (poly.length < 3) return

        const xs = poly.map(p => p[0])
        const ys = poly.map(p => p[1])
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        const w = maxX - minX
        const h = maxY - minY

        // 太小的 shape 不加装饰
        if (w < 60 || h < 60) return

        // 基于形状序号 + bbox 生成确定性种子
        const baseSeed = shapeIndex * 100 + Math.round(minX + minY)
        const count = seededRandom(baseSeed) > 0.5 ? 2 : 1

        for (let i = 0; i < count; i++) {
            const rx = seededRandom(baseSeed + i * 7 + 1)
            const ry = seededRandom(baseSeed + i * 7 + 2)
            const rSize = seededRandom(baseSeed + i * 7 + 3)
            const rRot = seededRandom(baseSeed + i * 7 + 4)

            // 在 bbox 内部（留出 20% 边距避免紧贴边界）
            const margin = 0.2
            const x = minX + w * (margin + rx * (1 - 2 * margin))
            const y = minY + h * (margin + ry * (1 - 2 * margin))

            symbols.push({
                position: [x, y],
                type: 'mountain',
                color: [110, 75, 40, 140] as [number, number, number, number],
                size: 18 + rSize * 14,
                rotation: (rRot - 0.5) * 20,
            })
        }
    })

    return symbols
}

/**
 * 将 DecoSymbol 转换为可用 PathLayer 渲染的山脉路径。
 * 每个山脉由大三角 + 右侧小三角组成。
 */
export function mountainSymbolsToPaths(symbols: DecoSymbol[]): {
    path: [number, number][]
    color: [number, number, number, number]
    widthPixels: number
}[] {
    return symbols.flatMap(sym => {
        const [cx, cy] = sym.position
        const s = sym.size ?? 18
        const c = Math.cos(((sym.rotation ?? 0) * Math.PI) / 180)
        const sn = Math.sin(((sym.rotation ?? 0) * Math.PI) / 180)
        const color = sym.color ?? [110, 75, 40, 140]

        const rotate = (dx: number, dy: number): [number, number] => [
            cx + dx * c - dy * sn,
            cy + dx * sn + dy * c,
        ]

        // 主峰三角（左-顶-右闭合）
        const mainPeak: [number, number][] = [
            rotate(-s * 0.72, s * 0.42),
            rotate(0, -s * 0.42),
            rotate(s * 0.72, s * 0.42),
            rotate(-s * 0.72, s * 0.42),
        ]

        // 右侧次峰（小一些）
        const subPeak: [number, number][] = [
            rotate(s * 0.08, s * 0.42),
            rotate(s * 0.45, -s * 0.05),
            rotate(s * 0.82, s * 0.42),
        ]

        return [
            {path: mainPeak, color: color as [number, number, number, number], widthPixels: 1.5},
            {
                path: subPeak,
                color: [color[0], color[1], color[2], Math.round(color[3] * 0.7)] as [number, number, number, number],
                widthPixels: 1.2
            },
        ]
    })
}
