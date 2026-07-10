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

function encodeStrokeOrder(order: number, strokeCount: number): string {
    const value = Math.max(1, Math.round(order / Math.max(1, strokeCount) * 0xffffff))
    return `rgb(${value & 0xff}, ${(value >> 8) & 0xff}, ${(value >> 16) & 0xff})`
}

function decodeStrokeOrder(data: Uint8ClampedArray, offset: number): number {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)
}

function paintStroke(
    ctx: CanvasRenderingContext2D,
    stroke: MapTerrainStroke,
    order: number,
    strokeCount: number,
): void {
    const radius = Math.max(1, stroke.radius)
    if (stroke.points.length === 0) return

    ctx.save()
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
    ctx.fillStyle = encodeStrokeOrder(order, strokeCount)
    ctx.strokeStyle = encodeStrokeOrder(order, strokeCount)
    ctx.lineWidth = radius * 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.points[0][0], stroke.points[0][1])
    for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex++) {
        ctx.lineTo(stroke.points[pointIndex][0], stroke.points[pointIndex][1])
    }
    if (stroke.points.length === 1) {
        ctx.arc(stroke.points[0][0], stroke.points[0][1], radius, 0, Math.PI * 2)
        ctx.fill()
    } else {
        ctx.stroke()
    }
    ctx.restore()
}

/**
 * 将地形笔画光栅化为 RGBA8 单选场：R=草地、G=高山、B=沙漠。
 * 重叠处只保留最后一次有效绘制的类型；Alpha 固定为 255，避免纹理预乘。
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
    let hasPaintStroke = false
    for (const [strokeIndex, stroke] of strokes.entries()) {
        const channel = TERRAIN_CHANNELS.get(stroke.kind)
        const context = channel === undefined ? null : maskContexts[channel]
        if (!context) continue
        paintStroke(context, stroke, strokeIndex + 1, strokes.length)
        if (stroke.mode === 'paint') hasPaintStroke = true
    }
    if (!hasPaintStroke) return null

    const result = createMaskCanvas(fieldWidth, fieldHeight)
    const resultContext = result.getContext('2d')
    if (!resultContext) return null
    const output = resultContext.createImageData(fieldWidth, fieldHeight)
    const channels = maskContexts.map(context => context!.getImageData(0, 0, fieldWidth, fieldHeight).data)

    for (let offset = 0; offset < output.data.length; offset += 4) {
        let topChannel = -1
        let topOrder = 0
        for (let channel = 0; channel < channels.length; channel++) {
            if (channels[channel][offset + 3] < 128) continue
            const order = decodeStrokeOrder(channels[channel], offset)
            if (order > topOrder) {
                topChannel = channel
                topOrder = order
            }
        }
        if (topChannel >= 0) output.data[offset + topChannel] = 255
        output.data[offset + 3] = 255
    }
    resultContext.putImageData(output, 0, 0)
    return result
}

/** 把三通道覆盖度转换成 Canvas 回退路径可直接合成的透明色块。 */
export function colorizeTerrainFieldCanvas(
    field: HTMLCanvasElement,
    palette: TerrainFieldPalette,
): HTMLCanvasElement | null {
    const sourceContext = field.getContext('2d')
    if (!sourceContext) return null

    const result = createMaskCanvas(field.width, field.height)
    const resultContext = result.getContext('2d')
    if (!resultContext) return null

    const source = sourceContext.getImageData(0, 0, field.width, field.height)
    const output = resultContext.createImageData(field.width, field.height)
    const colors = [palette.grass, palette.mountain, palette.desert]

    for (let offset = 0; offset < source.data.length; offset += 4) {
        const channel = source.data[offset] > 0 ? 0 : source.data[offset + 1] > 0 ? 1 : source.data[offset + 2] > 0 ? 2 : -1
        if (channel < 0) continue
        for (let colorIndex = 0; colorIndex < 3; colorIndex++) {
            output.data[offset + colorIndex] = colors[channel][colorIndex]
        }
        output.data[offset + 3] = 255
    }
    resultContext.putImageData(output, 0, 0)
    return result
}
