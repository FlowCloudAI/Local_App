import {
    MAP_TERRAIN_KINDS,
    type MapTerrainStroke,
} from '../../components/MapShapeEditor'

export const TERRAIN_FIELD_EMPTY_INDEX = 255

export interface TerrainFieldData {
    width: number
    height: number
    /** RGBA8：R=类型索引，G=覆盖度，B/A 预留。 */
    data: Uint8Array
}

/** 编辑态读取实时语义，预览态只读取最近一次生成快照。 */
export function resolveTerrainStrokesForViewport(
    mode: 'edit' | 'preview',
    draftStrokes: MapTerrainStroke[] | undefined,
    generatedStrokes: MapTerrainStroke[] | undefined,
): MapTerrainStroke[] {
    return mode === 'edit' ? draftStrokes ?? [] : generatedStrokes ?? []
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
 * 将地形笔画光栅化为 RGBA8 单选场：R=类型索引、G=覆盖度，255=空。
 * 重叠处只保留最后一次有效绘制的类型；覆盖度写入各类型并集（Σ覆盖度，封顶 255）——
 * 异种笔画交界两侧的抗锯齿量互补，相加即恢复满覆盖，交界处不露底；
 * 单一笔画的外缘无邻居，仍是原始抗锯齿覆盖度，供消费端做软边。
 */
export function createTerrainFieldData(
    strokes: MapTerrainStroke[] | undefined,
    width: number,
    height: number,
): TerrainFieldData | null {
    const fieldWidth = Math.round(width)
    const fieldHeight = Math.round(height)
    if (!strokes?.length || fieldWidth <= 0 || fieldHeight <= 0) return null

    const fieldKinds = MAP_TERRAIN_KINDS.filter(definition => definition.renderLayer === 'field')
    const masks = fieldKinds.map(() => createMaskCanvas(fieldWidth, fieldHeight))
    const maskContexts = masks.map(mask => mask.getContext('2d'))
    if (maskContexts.some(context => !context)) return null
    const maskIndexByKind = new Map<string, number>(fieldKinds.map((definition, index) => [definition.id, index]))

    // TODO: 阶段 1 在笔画列表变化时全量重建（编辑器已改为松手才提交，重建频率=每笔一次）；
    // 大图仍掉帧时再做脏矩形增量合并。
    let hasPaintStroke = false
    for (const [strokeIndex, stroke] of strokes.entries()) {
        if (stroke.mode === 'erase') {
            for (const context of maskContexts) {
                paintStroke(context!, stroke, strokeIndex + 1, strokes.length)
            }
            continue
        }
        const maskIndex = maskIndexByKind.get(stroke.kind)
        if (maskIndex === undefined) continue
        paintStroke(maskContexts[maskIndex]!, stroke, strokeIndex + 1, strokes.length)
        hasPaintStroke = true
    }
    if (!hasPaintStroke) return null

    const output = new Uint8Array(fieldWidth * fieldHeight * 4)
    const channels = maskContexts.map(context => context!.getImageData(0, 0, fieldWidth, fieldHeight).data)

    for (let offset = 0; offset < output.length; offset += 4) {
        // 胜者选择：实心像素（覆盖度≥50%）按笔画次序取最后绘制者；纯边缘像素
        // 退回覆盖度最高的通道。注意：次序编码在抗锯齿混合下会失真，
        // 因此只对 ≥128 的实心像素解码比较。
        let topChannel = -1
        let topOrder = 0
        let fringeChannel = -1
        let fringeCoverage = 0
        let totalCoverage = 0
        for (let channel = 0; channel < channels.length; channel++) {
            const coverage = channels[channel][offset + 3]
            totalCoverage += coverage
            if (coverage > fringeCoverage) {
                fringeChannel = channel
                fringeCoverage = coverage
            }
            if (coverage < 128) continue
            const order = decodeStrokeOrder(channels[channel], offset)
            if (order > topOrder) {
                topChannel = channel
                topOrder = order
            }
        }

        // 胜者通道写入并集覆盖度：异种笔画的抗锯齿边缘互相拼接/叠压时，
        // 交界像素两侧覆盖度互补，只保留胜者自身覆盖度会留下半透明缝。
        const winner = topChannel >= 0 ? topChannel : fringeChannel
        output[offset] = winner >= 0 ? fieldKinds[winner].order : TERRAIN_FIELD_EMPTY_INDEX
        output[offset + 1] = winner >= 0 ? Math.min(255, totalCoverage) : 0
        output[offset + 3] = 255
    }
    return {width: fieldWidth, height: fieldHeight, data: output}
}
