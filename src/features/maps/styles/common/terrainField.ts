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

    const points = stroke.points
    if (points.length === 1) {
        ctx.arc(points[0][0], points[0][1], radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        return
    }

    // 中点二次曲线平滑（经典手绘笔迹算法）：以相邻点中点为锚、原始点为控制点，
    // 采样点之间走圆滑曲线而非直线段——这是"快笔不成折线"的下半场
    //（上半场是编辑器用 getCoalescedEvents 补回帧间轨迹点）。
    ctx.moveTo(points[0][0], points[0][1])
    if (points.length === 2) {
        ctx.lineTo(points[1][0], points[1][1])
    } else {
        for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++) {
            const midX = (points[pointIndex][0] + points[pointIndex + 1][0]) / 2
            const midY = (points[pointIndex][1] + points[pointIndex + 1][1]) / 2
            ctx.quadraticCurveTo(points[pointIndex][0], points[pointIndex][1], midX, midY)
        }
        const last = points[points.length - 1]
        ctx.lineTo(last[0], last[1])
    }
    ctx.stroke()
    ctx.restore()
}

/**
 * 将地形笔画光栅化为 RGBA8 单选场：R=草地、G=高山、B=沙漠。
 * 重叠处只保留最后一次有效绘制的类型；胜者通道沿用各层最大覆盖度，避免内部交界露底，
 * 外缘仍保留抗锯齿覆盖度供消费端做软边。Alpha 固定 255，避免纹理预乘。
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

    // TODO: 阶段 1 在笔画列表变化时全量重建（编辑器已改为松手才提交，重建频率=每笔一次）；
    // 大图仍掉帧时再做脏矩形增量合并。
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
        // 内部像素（覆盖度≥50%）按笔画次序取胜者；纯边缘像素（0<覆盖度<50%）
        // 取覆盖度最高的通道并保留其覆盖度——这圈 fringe 就是消费端软边的原料。
        // 注意：次序编码在抗锯齿混合下会失真，因此只对 ≥128 的实心像素解码比较。
        let topChannel = -1
        let topOrder = 0
        let maxCoverage = 0
        for (let channel = 0; channel < channels.length; channel++) {
            const coverage = channels[channel][offset + 3]
            maxCoverage = Math.max(maxCoverage, coverage)
            if (coverage < 128) continue
            const order = decodeStrokeOrder(channels[channel], offset)
            if (order > topOrder) {
                topChannel = channel
                topOrder = order
            }
        }

        if (topChannel >= 0) {
            // 顶层类型的抗锯齿边缘若落在完整下层之上，沿用下层覆盖度，避免露出白缝。
            output.data[offset + topChannel] = maxCoverage
        } else {
            let fringeChannel = -1
            let fringeAlpha = 0
            for (let channel = 0; channel < channels.length; channel++) {
                const alpha = channels[channel][offset + 3]
                if (alpha > fringeAlpha) {
                    fringeChannel = channel
                    fringeAlpha = alpha
                }
            }
            if (fringeChannel >= 0) output.data[offset + fringeChannel] = fringeAlpha
        }
        output.data[offset + 3] = 255
    }
    resultContext.putImageData(output, 0, 0)
    return result
}

/** 与 shader 版一致的覆盖度→软边映射（smoothstep 0.30..0.80），保证双路径 parity。 */
function coverageToAlpha(coverage: number): number {
    const t = Math.max(0, Math.min(1, (coverage / 255 - 0.30) / 0.50))
    return Math.round(t * t * (3 - 2 * t) * 255)
}

/** 把三通道覆盖度转换成 Canvas 回退路径可直接合成的透明色块（边缘按覆盖度软化）。 */
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
        let channel = -1
        let coverage = 0
        for (let candidate = 0; candidate < 3; candidate++) {
            if (source.data[offset + candidate] > coverage) {
                channel = candidate
                coverage = source.data[offset + candidate]
            }
        }
        if (channel < 0) continue
        const alpha = coverageToAlpha(coverage)
        if (alpha <= 0) continue
        for (let colorIndex = 0; colorIndex < 3; colorIndex++) {
            output.data[offset + colorIndex] = colors[channel][colorIndex]
        }
        output.data[offset + 3] = alpha
    }
    resultContext.putImageData(output, 0, 0)
    return result
}
