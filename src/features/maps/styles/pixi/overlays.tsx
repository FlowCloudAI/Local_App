/* eslint-disable react-refresh/only-export-components */
import '@pixi/react'
import {extend} from '@pixi/react'
import {Container, Graphics, Sprite, Text} from 'pixi.js'
extend({Container, Graphics, Sprite, Text})
pixiOverlayLog('MODULE_INIT: extend called for Container, Graphics, Sprite, Text')

import type {ReactNode} from 'react'
import {useEffect, useMemo, useState} from 'react'
import type {TextStyleOptions} from 'pixi.js'
import {Texture} from 'pixi.js'
import {log_message} from '../../../../api'
import type {MapPixiPreviewOverlayContext, MapPreviewKeyLocation, MapRgbaColor} from '../../components/MapShapeEditor'
import type {
    PixiCoastlineLayerStyle,
    PixiDecorationPluginId,
    PixiEffectPluginId,
    PixiLabelRule,
    PixiMapStyle,
} from './types'
import {hexToRgbaColor, isMapDebugLogEnabled, mapRenderScale, strokeToRgbaColor} from '../common'
import {
    drawPixiCompassAsset,
    drawPixiEffectAsset,
    getPixiBrushAssetProfile,
    type PixiBrushAssetId,
    type PixiCompassAssetId,
} from './assets'

function pixiOverlayLog(msg: string) {
    if (!isMapDebugLogEnabled()) return
    void log_message('info', `[PixiOverlay] ${msg}`)
}

pixiOverlayLog('MODULE_INIT: overlays.tsx loaded, extend already called')

type PixiOverlayRenderer = (context: MapPixiPreviewOverlayContext) => ReactNode

function colorToCss(color: MapRgbaColor, alphaMultiplier = 1): string {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.max(0, Math.min(1, (color[3] / 255) * alphaMultiplier))})`
}

function colorToHexNumber(color: MapRgbaColor): number {
    return (color[0] << 16) + (color[1] << 8) + color[2]
}

function colorToAlpha(color: MapRgbaColor): number {
    return Math.max(0, Math.min(1, color[3] / 255))
}

function getNumberParam(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getStringParam(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

function matchTextByRule(value: string, pattern?: string, includes?: string[]): boolean {
    if (includes?.some(token => value.includes(token))) return true
    if (!pattern) return false

    try {
        return new RegExp(pattern).test(value)
    } catch {
        return false
    }
}

function matchLabelRule(location: MapPreviewKeyLocation, rule: PixiLabelRule): boolean {
    return matchTextByRule(location.type, rule.typePattern, rule.typeIncludes)
        || matchTextByRule(location.name, rule.namePattern, rule.nameIncludes)
}

function resolveLabelRule(location: MapPreviewKeyLocation, style: PixiMapStyle): PixiLabelRule | undefined {
    return style.labels.rules?.find(rule => matchLabelRule(location, rule))
}

function pointNoise(seed: number): number {
    const value = Math.sin(seed * 12.9898) * 43758.5453
    return value - Math.floor(value)
}

function jitterPoint(point: [number, number], amount: number, seed: number): [number, number] {
    if (amount <= 0) return point
    return [
        point[0] + (pointNoise(seed) - 0.5) * amount,
        point[1] + (pointNoise(seed + 31.7) - 0.5) * amount,
    ]
}

function drawPolygonStroke(
    ctx: CanvasRenderingContext2D,
    polygon: [number, number][],
    jitter: number,
    seed: number,
) {
    if (polygon.length < 3) return

    const first = jitterPoint(polygon[0], jitter, seed)
    ctx.beginPath()
    ctx.moveTo(first[0], first[1])

    for (let i = 1; i < polygon.length; i++) {
        const point = jitterPoint(polygon[i], jitter, seed + i * 17)
        ctx.lineTo(point[0], point[1])
    }

    ctx.closePath()
    ctx.stroke()
}

function drawCoastlineLayer(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    layer: PixiCoastlineLayerStyle,
    layerIndex: number,
    brushAsset: PixiBrushAssetId,
) {
    const brush = getPixiBrushAssetProfile(brushAsset)
    ctx.save()
    ctx.strokeStyle = colorToCss(strokeToRgbaColor(layer), brush.alphaMultiplier)
    ctx.lineWidth = layer.width * brush.lineWidthMultiplier
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    context.scene.shapes.forEach((shape, shapeIndex) => {
        drawPolygonStroke(
            ctx,
            shape.polygon,
            (layer.jitter ?? 0) * brush.jitterMultiplier,
            layerIndex * 1009 + shapeIndex * 503,
        )
    })

    ctx.restore()
}

interface CoastlineHatchParams {
    rings?: number
    gap?: number
    width?: number
    color?: string
    opacity?: number
}

/** 在给定 ctx 上把所有陆地描成一条闭合路径（不描边不填充），供膨胀遮罩复用。 */
function traceLandPath(
    maskCtx: CanvasRenderingContext2D,
    shapes: { polygon: [number, number][] }[],
): void {
    maskCtx.beginPath()
    for (const shape of shapes) {
        const polygon = shape.polygon
        maskCtx.moveTo(polygon[0][0], polygon[0][1])
        for (let i = 1; i < polygon.length; i++) {
            maskCtx.lineTo(polygon[i][0], polygon[i][1])
        }
        maskCtx.closePath()
    }
}

/**
 * 把所有陆地按距离 d 做形态学膨胀（圆形结构元 = 填充 + 半径 d 的圆头描边），画成实心遮罩。
 * 圆形结构元让尖角/小碎边被"磨圆"，深湾处相邻边界平滑合并，从根本上避免顶点外扩会产生的自交。
 */
function paintDilatedLand(
    maskCtx: CanvasRenderingContext2D,
    shapes: { polygon: [number, number][] }[],
    width: number,
    height: number,
    distance: number,
): void {
    maskCtx.clearRect(0, 0, width, height)
    maskCtx.fillStyle = '#000'
    maskCtx.strokeStyle = '#000'
    maskCtx.lineJoin = 'round'
    maskCtx.lineCap = 'round'
    maskCtx.lineWidth = Math.max(0.01, distance * 2)
    traceLandPath(maskCtx, shapes)
    maskCtx.fill()
    if (distance > 0) maskCtx.stroke()
}

/**
 * 海岸线晕线：向海侧一圈圈逐渐变淡的等距轮廓（古地图/托尔金标志性的"海里一圈圈线"）。
 * 做法：对"陆地膨胀 d"与"陆地膨胀 d−线宽"求差，得到偏移 d 处的一条细环。圆形结构元
 * 天然避免尖角自交，深湾/小碎边处相邻晕线会平滑合并而非乱交叠。绘制在场景坐标里。
 */
function drawCoastlineHatching(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    hatch: CoastlineHatchParams,
    scale: number,
): void {
    const rings = Math.max(1, Math.min(12, Math.round(getNumberParam(hatch.rings, 4))))
    const gap = Math.max(1, getNumberParam(hatch.gap, 7))
    const lineWidth = Math.max(0.4, getNumberParam(hatch.width, 0.9))
    const opacity = Math.max(0, Math.min(1, getNumberParam(hatch.opacity, 0.5)))
    const rgba = hexToRgbaColor(getStringParam(hatch.color, '#6a4a26'))
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    const physW = Math.round(sceneW * scale)
    const physH = Math.round(sceneH * scale)
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (!shapes.length || physW <= 0 || physH <= 0) return

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = physW
    maskCanvas.height = physH
    const maskCtx = maskCanvas.getContext('2d')
    const ringCanvas = document.createElement('canvas')
    ringCanvas.width = physW
    ringCanvas.height = physH
    const ringCtx = ringCanvas.getContext('2d')
    if (!maskCtx || !ringCtx) return
    // 遮罩按场景坐标绘制到物理分辨率（超采样）。
    maskCtx.scale(scale, scale)

    for (let ring = 1; ring <= rings; ring++) {
        const ringOpacity = opacity * (1 - (ring - 1) / rings)
        if (ringOpacity <= 0.01) continue
        const distance = ring * gap

        // 外圈：陆地膨胀 distance
        paintDilatedLand(maskCtx, shapes, sceneW, sceneH, distance)
        ringCtx.globalCompositeOperation = 'source-over'
        ringCtx.clearRect(0, 0, physW, physH)
        ringCtx.drawImage(maskCanvas, 0, 0)

        // 减去内圈：陆地膨胀 distance − lineWidth，剩下一条细环
        paintDilatedLand(maskCtx, shapes, sceneW, sceneH, Math.max(0, distance - lineWidth))
        ringCtx.globalCompositeOperation = 'destination-out'
        ringCtx.drawImage(maskCanvas, 0, 0)

        // 用晕线颜色给细环上色（source-in：只在细环 alpha 处着色）
        ringCtx.globalCompositeOperation = 'source-in'
        ringCtx.fillStyle = colorToCss(rgba, 1)
        ringCtx.fillRect(0, 0, physW, physH)
        ringCtx.globalCompositeOperation = 'source-over'

        // ringCanvas 是物理分辨率；主 ctx 处于 scale 变换下，这里清空变换按 1:1 贴回。
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = ringOpacity
        ctx.drawImage(ringCanvas, 0, 0)
        ctx.restore()
    }
}

interface LandDepthParams {
    width?: number
    color?: string
    opacity?: number
}

/**
 * 陆地纵深：沿海岸向陆地内侧画一条又宽又柔的暗边（裁剪到陆地内部），形成"近岸略深、
 * 内陆渐亮"的内阴影，让陆地不再是纯色剪纸。绘制在场景坐标里（随主 ctx 的超采样一起变清晰）。
 */
function drawLandDepth(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    depth: LandDepthParams,
): void {
    const bandWidth = Math.max(2, getNumberParam(depth.width, 26))
    const opacity = Math.max(0, Math.min(1, getNumberParam(depth.opacity, 0.16)))
    const rgba = hexToRgbaColor(getStringParam(depth.color, '#5a3a1c'))
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (!shapes.length) return

    ctx.save()
    traceLandPath(ctx, shapes)
    ctx.clip()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = bandWidth * 2
    ctx.strokeStyle = colorToCss(rgba, opacity)
    ctx.filter = `blur(${Math.max(1, bandWidth * 0.5)}px)`
    traceLandPath(ctx, shapes)
    ctx.stroke()
    ctx.restore()
}

interface SeaDepthParams {
    bands?: number
    gap?: number
    color?: string
    /** 深海（远岸）蓝的不透明度上限。 */
    opacity?: number
    /** 近岸减淡强度 0~1：越大近岸越浅、深浅对比越强。 */
    shallowFade?: number
}

/**
 * 海水深浅：整片海面铺深蓝，再按"到海岸的距离"在近岸逐渐减淡 → 离岸越远越深、越靠岸越浅。
 * 用陆地逐层形态学膨胀累积出一张"近岸=强、离岸→0"的 fade 遮罩，再以它 destination-out 减淡深蓝。
 * 过渡宽度 = bands×gap；圆形结构元保证近岸减淡带平滑、无尖角自交。最后挖掉陆地只留海侧。
 */
function drawSeaDepthBands(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    params: SeaDepthParams,
    scale: number,
): void {
    const bands = Math.max(1, Math.min(24, Math.round(getNumberParam(params.bands, 6))))
    const gap = Math.max(1, getNumberParam(params.gap, 10))
    const deepOpacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.22)))
    const shallowFade = Math.max(0, Math.min(1, getNumberParam(params.shallowFade, 0.9)))
    const rgba = hexToRgbaColor(getStringParam(params.color, '#3f6f8f'))
    if (deepOpacity <= 0) return
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    const physW = Math.round(sceneW * scale)
    const physH = Math.round(sceneH * scale)
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (!shapes.length || physW <= 0 || physH <= 0) return

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = physW
    maskCanvas.height = physH
    const maskCtx = maskCanvas.getContext('2d')
    const fadeCanvas = document.createElement('canvas')
    fadeCanvas.width = physW
    fadeCanvas.height = physH
    const fadeCtx = fadeCanvas.getContext('2d')
    const bandCanvas = document.createElement('canvas')
    bandCanvas.width = physW
    bandCanvas.height = physH
    const bandCtx = bandCanvas.getContext('2d')
    if (!maskCtx || !fadeCtx || !bandCtx) return
    maskCtx.scale(scale, scale)

    // fade 遮罩：陆地逐层膨胀累积，越靠岸被覆盖层数越多 → alpha 越高；离岸 bands×gap 外→0。
    const perLayer = 1 / bands
    fadeCtx.globalCompositeOperation = 'source-over'
    for (let k = 1; k <= bands; k++) {
        paintDilatedLand(maskCtx, shapes, sceneW, sceneH, k * gap)
        fadeCtx.globalAlpha = perLayer
        fadeCtx.drawImage(maskCanvas, 0, 0)
    }
    fadeCtx.globalAlpha = 1

    // 深蓝铺满整片，再用 fade 在近岸 destination-out 减淡（离岸保持深蓝）。
    bandCtx.fillStyle = colorToCss(rgba, deepOpacity)
    bandCtx.fillRect(0, 0, physW, physH)
    bandCtx.globalCompositeOperation = 'destination-out'
    bandCtx.globalAlpha = shallowFade
    bandCtx.drawImage(fadeCanvas, 0, 0)
    bandCtx.globalAlpha = 1
    bandCtx.globalCompositeOperation = 'source-over'

    // 挖掉陆地本体，只保留海侧
    paintDilatedLand(maskCtx, shapes, sceneW, sceneH, 0)
    bandCtx.globalCompositeOperation = 'destination-out'
    bandCtx.drawImage(maskCanvas, 0, 0)
    bandCtx.globalCompositeOperation = 'source-over'

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(bandCanvas, 0, 0)
    ctx.restore()
}

interface SeaWaveParams {
    spacing?: number    // 分布网格步长（越小越密）
    amplitude?: number
    wavelength?: number // 单段波浪周期（越小越密）
    width?: number
    color?: string
    opacity?: number
    margin?: number
    segLength?: number  // 每段波浪的长度
    density?: number    // 每格出现概率 0~1
}

/**
 * 程序化海浪：不是贯穿的水纹线，而是散布在海面的一段段短正弦波。
 * 用抖动网格 + 噪声跳过做随机分布（各段不落在同一纬线上），每段长度/振幅/相位各异。
 * 再挖掉陆地（含少量岸边留白），只在海面留下断续水纹。
 */
function drawSeaWaves(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    params: SeaWaveParams,
    scale: number,
): void {
    const cell = Math.max(6, getNumberParam(params.spacing, 24))
    const amplitude = Math.max(0, getNumberParam(params.amplitude, 2.4))
    const wavelength = Math.max(4, getNumberParam(params.wavelength, 9))
    const lineWidth = Math.max(0.4, getNumberParam(params.width, 1))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.2)))
    const margin = Math.max(0, getNumberParam(params.margin, 4))
    const segLength = Math.max(6, getNumberParam(params.segLength, 22))
    const density = Math.max(0, Math.min(1, getNumberParam(params.density, 0.6)))
    const rgba = hexToRgbaColor(getStringParam(params.color, '#345d7a'))
    if (opacity <= 0) return
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    const physW = Math.round(sceneW * scale)
    const physH = Math.round(sceneH * scale)
    if (physW <= 0 || physH <= 0) return

    const waveCanvas = document.createElement('canvas')
    waveCanvas.width = physW
    waveCanvas.height = physH
    const waveCtx = waveCanvas.getContext('2d')
    if (!waveCtx) return

    waveCtx.save()
    waveCtx.scale(scale, scale)
    waveCtx.strokeStyle = colorToCss(rgba, opacity)
    waveCtx.lineWidth = lineWidth
    waveCtx.lineJoin = 'round'
    waveCtx.lineCap = 'round'
    for (let gy = cell * 0.5; gy < sceneH; gy += cell) {
        for (let gx = cell * 0.5; gx < sceneW; gx += cell) {
            const seed = gx * 0.1237 + gy * 0.3719
            if (pointNoise(seed * 1.7 + 3.1) > density) continue
            const cx = gx + (pointNoise(seed + 11.1) - 0.5) * cell * 1.4
            const cy = gy + (pointNoise(seed + 23.3) - 0.5) * cell * 1.4
            const phase = pointNoise(seed + 5.5) * Math.PI * 2
            const len = segLength * (0.55 + pointNoise(seed + 7.7) * 0.9)
            const amp = amplitude * (0.55 + pointNoise(seed + 9.9) * 0.9)
            const half = len / 2
            waveCtx.beginPath()
            for (let x = -half; x <= half; x += 2.5) {
                const yy = cy + Math.sin((x / wavelength) * Math.PI * 2 + phase) * amp
                if (x === -half) waveCtx.moveTo(cx + x, yy)
                else waveCtx.lineTo(cx + x, yy)
            }
            waveCtx.stroke()
        }
    }
    waveCtx.restore()

    // 挖掉陆地（含少量岸边留白），只在海面留下水纹。
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (shapes.length) {
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = physW
        maskCanvas.height = physH
        const maskCtx = maskCanvas.getContext('2d')
        if (maskCtx) {
            maskCtx.scale(scale, scale)
            paintDilatedLand(maskCtx, shapes, sceneW, sceneH, margin)
            waveCtx.globalCompositeOperation = 'destination-out'
            waveCtx.drawImage(maskCanvas, 0, 0)
            waveCtx.globalCompositeOperation = 'source-over'
        }
    }

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(waveCanvas, 0, 0)
    ctx.restore()
}

function drawCompass(ctx: CanvasRenderingContext2D, context: MapPixiPreviewOverlayContext, style: PixiMapStyle) {
    const plugin = style.decorations?.find(item => item.id === 'compass')
    const size = getNumberParam(plugin?.params?.size, 58)
    const margin = getNumberParam(plugin?.params?.margin, 72)
    const color = hexToRgbaColor(getStringParam(plugin?.params?.color, style.palette.coastline), 0.78)
    const asset = getStringParam(plugin?.params?.asset, 'tolkien-compass') as PixiCompassAssetId

    drawPixiCompassAsset({
        ctx,
        asset,
        cx: context.scene.canvas.width - margin,
        cy: margin,
        size,
        color,
    })
}

function hasDecoration(style: PixiMapStyle, id: PixiDecorationPluginId): boolean {
    return Boolean(style.decorations?.some(plugin => plugin.id === id))
}

function isEffectPluginId(id: string): id is PixiEffectPluginId {
    return id === 'paper-grain'
        || id === 'vignette'
        || id === 'edge-darken'
        || id === 'ink-bleed'
        || id === 'chromatic-ageing'
}

function createOverlayDataUrl(context: MapPixiPreviewOverlayContext, style: PixiMapStyle): string {
    pixiOverlayLog(`createOverlayDataUrl: canvas=${context.scene.canvas.width}x${context.scene.canvas.height} shapes=${context.scene.shapes.length}`)
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    if (sceneW <= 0 || sceneH <= 0) return ''
    // 超采样：位图按 scale 放大生成，Sprite 仍按场景尺寸显示 → 放大更清晰。
    const scale = mapRenderScale(sceneW, sceneH)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sceneW * scale)
    canvas.height = Math.round(sceneH * scale)
    const ctx = canvas.getContext('2d')

    if (!ctx) {
        pixiOverlayLog('createOverlayDataUrl: getContext(2d) returned null')
        return ''
    }
    ctx.scale(scale, scale)

    // 海洋处理（近岸蓝色水深带 + 程序化海浪），画在最底层。
    const seaPlugin = style.decorations?.find(item => item.id === 'sea')
    if (seaPlugin) {
        const sea = seaPlugin.params
        if (getNumberParam(sea?.depthOpacity, 0) > 0) {
            drawSeaDepthBands(ctx, context, {
                bands: getNumberParam(sea?.depthBands, 6),
                gap: getNumberParam(sea?.depthGap, 10),
                color: getStringParam(sea?.depthColor, '#3f6f8f'),
                opacity: getNumberParam(sea?.depthOpacity, 0.22),
                shallowFade: getNumberParam(sea?.depthShallowFade, 0.9),
            }, scale)
        }
        if (getNumberParam(sea?.waveOpacity, 0) > 0) {
            drawSeaWaves(ctx, context, {
                spacing: getNumberParam(sea?.waveSpacing, 24),
                amplitude: getNumberParam(sea?.waveAmplitude, 2.4),
                wavelength: getNumberParam(sea?.waveLength, 9),
                width: getNumberParam(sea?.waveWidth, 1),
                color: getStringParam(sea?.waveColor, '#345d7a'),
                opacity: getNumberParam(sea?.waveOpacity, 0.2),
                margin: getNumberParam(sea?.waveMargin, 4),
                segLength: getNumberParam(sea?.waveSegLength, 22),
                density: getNumberParam(sea?.waveDensity, 0.6),
            }, scale)
        }
    }

    // 陆地纵深（近岸内阴影）：画在最底层，其余效果叠加其上。opacity>0 才启用。
    const landDepthPlugin = style.decorations?.find(item => item.id === 'land-depth')
    if (landDepthPlugin && getNumberParam(landDepthPlugin.params?.opacity, 0) > 0) {
        drawLandDepth(ctx, context, {
            width: getNumberParam(landDepthPlugin.params?.width, 26),
            color: getStringParam(landDepthPlugin.params?.color, '#5a3a1c'),
            opacity: getNumberParam(landDepthPlugin.params?.opacity, 0.16),
        })
    }

    for (const effect of style.effects ?? []) {
        if (!isEffectPluginId(effect.id)) continue
        drawPixiEffectAsset({
            ctx,
            asset: effect.id,
            width: context.scene.canvas.width,
            height: context.scene.canvas.height,
            shapes: context.scene.shapes,
            params: effect.params,
        })
    }

    const coastlinePlugin = style.decorations?.find(item => item.id === 'coastline-outline')
    if (style.coastline?.enabled && coastlinePlugin) {
        // 先画向海侧的等距晕线（在下），再叠陆地边界描边（在上）。hatchRings>0 才启用。
        const hatchParams = coastlinePlugin.params
        if (getNumberParam(hatchParams?.hatchRings, 0) > 0) {
            drawCoastlineHatching(ctx, context, {
                rings: getNumberParam(hatchParams?.hatchRings, 4),
                gap: getNumberParam(hatchParams?.hatchGap, 7),
                width: getNumberParam(hatchParams?.hatchWidth, 0.9),
                color: getStringParam(hatchParams?.hatchColor, '#6a4a26'),
                opacity: getNumberParam(hatchParams?.hatchOpacity, 0.5),
            }, scale)
        }
        const brushAsset = getStringParam(coastlinePlugin.params?.brush, 'tolkien-coastline') as PixiBrushAssetId
        style.coastline.layers.forEach((layer, index) => drawCoastlineLayer(ctx, context, layer, index, brushAsset))
    }

    if (hasDecoration(style, 'compass')) {
        drawCompass(ctx, context, style)
    }

    const dataUrl = canvas.toDataURL('image/png')
    pixiOverlayLog(`createOverlayDataUrl: dataUrlLen=${dataUrl.length} prefix=${dataUrl.slice(0, 40)}`)
    return dataUrl
}

function useImageTexture(url: string): Texture {
    const [texture, setTexture] = useState<Texture>(Texture.EMPTY)

    useEffect(() => {
        if (!url) {
            setTexture(Texture.EMPTY)
            return undefined
        }

        let cancelled = false
        const image = new Image()

        image.onload = () => {
            if (cancelled) return
            try {
                setTexture(Texture.from({resource: image}, true))
                pixiOverlayLog(`useImageTexture: loaded ok urlLen=${url.length}`)
            } catch (e) {
                pixiOverlayLog(`useImageTexture: Texture.from failed ${e instanceof Error ? e.message : String(e)}`)
                setTexture(Texture.EMPTY)
            }
        }
        image.onerror = () => {
            if (!cancelled) {
                pixiOverlayLog(`useImageTexture: image.onerror urlLen=${url.length} prefix=${url.slice(0, 60)}`)
                setTexture(Texture.EMPTY)
            }
        }
        image.src = url

        return () => {
            cancelled = true
        }
    }, [url])

    // 纹理销毁延到它被下一张纹理替换（或组件卸载）之后再做，避免 Sprite 渲染已销毁纹理
    // 触发 Pixi applyStyleParams 读取 null.style 崩溃（详见 MapPixiPreview.usePixiImageTexture）。
    useEffect(() => {
        return () => {
            if (texture !== Texture.EMPTY && !texture.destroyed) {
                texture.destroy(true)
            }
        }
    }, [texture])

    return texture
}

function PixiTextureOverlay({context, style}: { context: MapPixiPreviewOverlayContext; style: PixiMapStyle }) {
    pixiOverlayLog('PixiTextureOverlay: ENTER')
    // overlay 内容只依赖 scene.shapes / 画布尺寸 / style，与 viewportTransform 无关
    //（它在场景坐标里绘制，平移缩放由父容器 transform 承担）。绝不能把整个 context 放进
    // 依赖：context 每帧都是新对象（带 viewportTransform），会导致平移缩放的每一帧都重跑
    // createOverlayDataUrl（整块画布 toDataURL + 重新上传纹理），是风格化渲染卡成个位数帧的主因。
    const dataUrl = useMemo(
        () => createOverlayDataUrl(context, style),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [context.scene.shapes, context.scene.canvas.width, context.scene.canvas.height, style],
    )
    pixiOverlayLog(`PixiTextureOverlay: useMemo dataUrl=${dataUrl ? 'present' : 'empty'}`)
    const texture = useImageTexture(dataUrl)
    pixiOverlayLog(`PixiTextureOverlay: useImageTexture returned texture=${texture !== Texture.EMPTY ? 'loaded' : 'empty'}`)
    pixiOverlayLog(`PixiTextureOverlay: dataUrl=${dataUrl ? 'present' : 'empty'} texture=${texture !== Texture.EMPTY ? 'loaded' : 'empty'}`)

    if (!dataUrl) {
        pixiOverlayLog('PixiTextureOverlay: EXIT early (no dataUrl)')
        return null
    }

    pixiOverlayLog(`PixiTextureOverlay: RETURN pixiSprite w=${context.scene.canvas.width} h=${context.scene.canvas.height}`)
    return (
        <pixiSprite
            texture={texture}
            x={0}
            y={0}
            width={context.scene.canvas.width}
            height={context.scene.canvas.height}
        />
    )
}

function PixiOverlayLabel({
                              context,
                              location,
                              style,
                          }: {
    context: MapPixiPreviewOverlayContext
    location: MapPreviewKeyLocation
    style: PixiMapStyle
}) {
    const scale = Math.max(context.viewportTransform.scale, 0.01)
    const inverseScale = 1 / scale
    const rule = resolveLabelRule(location, style)
    const color = hexToRgbaColor(rule?.color ?? style.labels.color, rule?.opacity ?? 1)
    const haloColor = rule?.haloColor ?? style.labels.haloColor
    const haloWidth = rule?.haloWidth ?? style.labels.haloWidth ?? 0
    const offsetY = rule?.offsetY ?? style.labels.offsetY ?? 18
    const labelStyle = useMemo<TextStyleOptions>(() => ({
        align: 'center',
        fill: colorToHexNumber(color),
        fontFamily: rule?.fontFamily ?? style.labels.fontFamily,
        fontSize: rule?.fontSize ?? style.labels.fontSize,
        fontWeight: (rule?.fontWeight ?? style.labels.fontWeight ?? '600') as TextStyleOptions['fontWeight'],
        padding: haloWidth > 0 ? haloWidth + 2 : 0,
        stroke: haloColor && haloWidth > 0
            ? {
                color: haloColor,
                width: haloWidth,
            }
            : undefined,
    }), [color, haloColor, haloWidth, rule, style.labels])

    return (
        <pixiText
            text={location.name}
            x={location.position[0]}
            y={location.position[1] - offsetY / scale}
            anchor={0.5}
            alpha={colorToAlpha(color)}
            scale={inverseScale}
            style={labelStyle}
        />
    )
}

function PixiOverlayLabels({context, style}: { context: MapPixiPreviewOverlayContext; style: PixiMapStyle }) {
    pixiOverlayLog(`PixiOverlayLabels: ENTER show=${style.labels.show} renderer=${style.labels.renderer} locCount=${context.scene.keyLocations.length}`)
    if (!style.labels.show || style.labels.renderer !== 'overlay') {
        pixiOverlayLog('PixiOverlayLabels: EXIT early')
        return null
    }

    pixiOverlayLog(`PixiOverlayLabels: RETURN ${context.scene.keyLocations.length} labels`)
    return (
        <>
            {context.scene.keyLocations.map(location => (
                <PixiOverlayLabel
                    key={location.id}
                    context={context}
                    location={location}
                    style={style}
                />
            ))}
        </>
    )
}

export function createPixiOverlayRenderer(style: PixiMapStyle): PixiOverlayRenderer | undefined {
    const showCoastline = Boolean(style.coastline?.enabled && hasDecoration(style, 'coastline-outline'))
    const showCompass = hasDecoration(style, 'compass')
    const showEffects = Boolean(style.effects?.length)
    const showOverlayLabels = Boolean(style.labels.show && style.labels.renderer === 'overlay')
    const showTextureOverlay = showEffects || showCoastline || showCompass

    pixiOverlayLog(`createPixiOverlayRenderer: effects=${showEffects} coastline=${showCoastline} compass=${showCompass} labels=${showOverlayLabels}`)

    if (!showEffects && !showCoastline && !showCompass && !showOverlayLabels) return undefined

    return (context) => {
        pixiOverlayLog(`RENDER_FN: called showTextureOverlay=${showTextureOverlay} showOverlayLabels=${showOverlayLabels} sceneShapes=${context.scene.shapes.length} sceneKeyLocs=${context.scene.keyLocations.length} canvas=${context.scene.canvas.width}x${context.scene.canvas.height}`)
        return (
            <>
                {showTextureOverlay && <PixiTextureOverlay context={context} style={style}/>}
                {showOverlayLabels && <PixiOverlayLabels context={context} style={style}/>}
            </>
        )
    }
}
