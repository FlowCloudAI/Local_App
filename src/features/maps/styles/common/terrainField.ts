import type {MapTerrainStroke} from '../../components/MapShapeEditor'

const TERRAIN_CHANNELS = new Map([
    ['grass', 0],
    ['mountain', 1],
    ['desert', 2],
])

export interface TerrainFieldPalette {
    grass: [number, number, number]
    mountain: [number, number, number]
    desert: [number, number, number]
}

function createMaskCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function createBrushStamp(radius: number): HTMLCanvasElement | null {
    const size = Math.max(2, Math.ceil(radius * 2))
    const canvas = createMaskCanvas(size, size)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const center = size / 2
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
    gradient.addColorStop(0.72, 'rgba(0, 0, 0, 1)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    return canvas
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: MapTerrainStroke): void {
    const radius = Math.max(1, stroke.radius)
    const stamp = createBrushStamp(radius)
    if (!stamp || stroke.points.length === 0) return

    const stampRadius = stamp.width / 2
    const spacing = Math.max(1, radius / 3)
    ctx.save()
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'

    const stampAt = (x: number, y: number) => {
        ctx.drawImage(stamp, x - stampRadius, y - stampRadius)
    }

    stampAt(stroke.points[0][0], stroke.points[0][1])
    for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex++) {
        const [fromX, fromY] = stroke.points[pointIndex - 1]
        const [toX, toY] = stroke.points[pointIndex]
        const distance = Math.hypot(toX - fromX, toY - fromY)
        const steps = Math.max(1, Math.ceil(distance / spacing))
        for (let step = 1; step <= steps; step++) {
            const progress = step / steps
            stampAt(fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress)
        }
    }
    ctx.restore()
}

/**
 * 将开放语义的地形笔画光栅化为 RGBA8 覆盖度场：R=草地、G=高山、B=沙漠。
 * Alpha 固定为 255，避免纹理上传时预乘透明度改变三个独立通道。
 */
export function createTerrainFieldCanvas(
    strokes: MapTerrainStroke[] | undefined,
    width: number,
    height: number,
): HTMLCanvasElement | null {
    const fieldWidth = Math.round(width)
    const fieldHeight = Math.round(height)
    if (!strokes?.length || fieldWidth <= 0 || fieldHeight <= 0) return null

    const masks = [0, 1, 2].map(() => createMaskCanvas(fieldWidth, fieldHeight))
    const maskContexts = masks.map(mask => mask.getContext('2d'))
    if (maskContexts.some(context => !context)) return null

    // ponytail: 阶段 1 在笔画列表变化时全量重建；实际大图绘制掉帧后再做增量上传。
    let renderedStrokeCount = 0
    for (const stroke of strokes) {
        const channel = TERRAIN_CHANNELS.get(stroke.kind)
        const context = channel === undefined ? null : maskContexts[channel]
        if (!context) continue
        paintStroke(context, stroke)
        renderedStrokeCount++
    }
    if (renderedStrokeCount === 0) return null

    const result = createMaskCanvas(fieldWidth, fieldHeight)
    const resultContext = result.getContext('2d')
    if (!resultContext) return null
    const output = resultContext.createImageData(fieldWidth, fieldHeight)
    const channels = maskContexts.map(context => context!.getImageData(0, 0, fieldWidth, fieldHeight).data)

    for (let offset = 0; offset < output.data.length; offset += 4) {
        output.data[offset] = channels[0][offset + 3]
        output.data[offset + 1] = channels[1][offset + 3]
        output.data[offset + 2] = channels[2][offset + 3]
        output.data[offset + 3] = 255
    }
    resultContext.putImageData(output, 0, 0)
    return result
}

/** 把三通道覆盖度转换成 Canvas 回退路径可直接合成的透明色块。 */
export function colorizeTerrainFieldCanvas(
    field: HTMLCanvasElement,
    palette: TerrainFieldPalette,
    opacity: number,
): HTMLCanvasElement | null {
    const sourceContext = field.getContext('2d')
    if (!sourceContext) return null

    const result = createMaskCanvas(field.width, field.height)
    const resultContext = result.getContext('2d')
    if (!resultContext) return null

    const source = sourceContext.getImageData(0, 0, field.width, field.height)
    const output = resultContext.createImageData(field.width, field.height)
    const colors = [palette.grass, palette.mountain, palette.desert]
    const safeOpacity = Math.max(0, Math.min(1, opacity))

    for (let offset = 0; offset < source.data.length; offset += 4) {
        const weights = [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
        const total = weights[0] + weights[1] + weights[2]
        if (total === 0) continue
        for (let colorIndex = 0; colorIndex < 3; colorIndex++) {
            output.data[offset + colorIndex] = Math.round(
                colors[0][colorIndex] * weights[0] / total
                + colors[1][colorIndex] * weights[1] / total
                + colors[2][colorIndex] * weights[2] / total,
            )
        }
        output.data[offset + 3] = Math.round(Math.max(...weights) * safeOpacity)
    }
    resultContext.putImageData(output, 0, 0)
    return result
}
