/* eslint-disable react-refresh/only-export-components */
import '@pixi/react'
import {extend} from '@pixi/react'
import {Container, Graphics, Mesh, Sprite, Text} from 'pixi.js'
extend({Container, Graphics, Mesh, Sprite, Text})
pixiOverlayLog('MODULE_INIT: extend called for Container, Graphics, Mesh, Sprite, Text')

import type {ReactNode} from 'react'
import {useCallback, useEffect, useMemo, useState} from 'react'
import type {TextStyleOptions, TextureShader} from 'pixi.js'
import {BufferImageSource, MeshGeometry, Texture} from 'pixi.js'
import {log_message} from '../../../../api'
import type {MapPixiPreviewOverlayContext, MapPreviewKeyLocation, MapRgbaColor} from '../../components/MapShapeEditor'
import type {
    PixiCoastlineLayerStyle,
    PixiDecorationPluginId,
    PixiEffectPluginId,
    PixiLabelRule,
    PixiMapStyle,
    PixiStylePluginConfig,
    ShaderRenderContext,
    ShaderRenderer,
} from './types'
import {
    colorizeTerrainFieldCanvas,
    createTerrainFieldCanvas,
    hexToRgbaColor,
    isMapDebugLogEnabled,
    mapRenderScale,
    strokeToRgbaColor,
} from '../common'
import {
    drawPixiCompassAsset,
    drawPixiEffectAsset,
    getPixiBrushAssetProfile,
    type PixiBrushAssetId,
    type PixiCompassAssetId,
} from './assets'
import {parseColorToVec3, shaderRegistry} from './shaderRegistry'
import type {CoastFieldData} from './utils'
import {createCoastFieldData} from './utils'

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

interface TerrainParams {
    grassColor?: string
    mountainColor?: string
    desertColor?: string
}

function drawTerrainColorBlocks(
    ctx: CanvasRenderingContext2D,
    context: MapPixiPreviewOverlayContext,
    params: TerrainParams,
    terrainField: HTMLCanvasElement | null,
): void {
    if (!terrainField) return
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (!shapes.length) return

    const grass = hexToRgbaColor(getStringParam(params.grassColor, '#82b45f'))
    const mountain = hexToRgbaColor(getStringParam(params.mountainColor, '#8a7868'))
    const desert = hexToRgbaColor(getStringParam(params.desertColor, '#d8b067'))
    const colored = colorizeTerrainFieldCanvas(terrainField, {
        grass: [grass[0], grass[1], grass[2]],
        mountain: [mountain[0], mountain[1], mountain[2]],
        desert: [desert[0], desert[1], desert[2]],
    })
    if (!colored) return

    ctx.save()
    traceLandPath(ctx, shapes)
    ctx.clip()
    ctx.drawImage(colored, 0, 0, context.scene.canvas.width, context.scene.canvas.height)
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

/**
 * 叠加位图绘制模式：
 * - full：全部效果（Canvas 回退路径）；
 * - linework：只画矢量线稿（海岸线本体描边 + 罗盘）。shader 路径下距离场类
 *   效果都交给 Mesh 插件，线稿位图叠在它们之上，重绘开销只剩轻量笔画。
 * 水墨的 brush-stroke / ink-wash 只保证 shader 路径效果；Canvas 回退不补等价笔触。
 */
type OverlayCanvasMode = 'full' | 'linework'

function createOverlayCanvas(
    context: MapPixiPreviewOverlayContext,
    style: PixiMapStyle,
    mode: OverlayCanvasMode = 'full',
    terrainField: HTMLCanvasElement | null = null,
): HTMLCanvasElement | null {
    pixiOverlayLog(`createOverlayCanvas: mode=${mode} canvas=${context.scene.canvas.width}x${context.scene.canvas.height} shapes=${context.scene.shapes.length}`)
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    if (sceneW <= 0 || sceneH <= 0) return null

    const showCoastStrokes = Boolean(
        style.coastline?.enabled
        && style.coastline.layers.length
        && style.decorations?.some(item => item.id === 'coastline-outline'),
    )
    const showCompass = hasDecoration(style, 'compass')
    if (mode === 'linework' && !showCoastStrokes && !showCompass) return null
    // 超采样：位图按 scale 放大生成，Sprite 仍按场景尺寸显示 → 放大更清晰。
    const scale = mapRenderScale(sceneW, sceneH)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sceneW * scale)
    canvas.height = Math.round(sceneH * scale)
    const ctx = canvas.getContext('2d')

    if (!ctx) {
        pixiOverlayLog('createOverlayCanvas: getContext(2d) returned null')
        return null
    }
    ctx.scale(scale, scale)

    // 海洋处理（近岸蓝色水深带），画在最底层。
    const seaPlugin = mode === 'full' ? style.decorations?.find(item => item.id === 'sea') : undefined
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
    }

    // 阶段 1 地形以平色覆盖度呈现；后续风格纹样仍位于同一层级。
    const terrainPlugin = mode === 'full' ? style.decorations?.find(item => item.id === 'terrain') : undefined
    if (terrainPlugin) {
        drawTerrainColorBlocks(ctx, context, {
            grassColor: getStringParam(terrainPlugin.params?.grassColor, '#82b45f'),
            mountainColor: getStringParam(terrainPlugin.params?.mountainColor, '#8a7868'),
            desertColor: getStringParam(terrainPlugin.params?.desertColor, '#d8b067'),
        }, terrainField)
    }

    // 陆地纵深（近岸内阴影）：画在最底层，其余效果叠加其上。opacity>0 才启用。
    const landDepthPlugin = mode === 'full' ? style.decorations?.find(item => item.id === 'land-depth') : undefined
    if (landDepthPlugin && getNumberParam(landDepthPlugin.params?.opacity, 0) > 0) {
        drawLandDepth(ctx, context, {
            width: getNumberParam(landDepthPlugin.params?.width, 26),
            color: getStringParam(landDepthPlugin.params?.color, '#5a3a1c'),
            opacity: getNumberParam(landDepthPlugin.params?.opacity, 0.16),
        })
    }

    if (mode === 'full') {
        for (const effect of style.effects ?? []) {
            if (!isEffectPluginId(effect.id)) continue
            // 色彩老化由独立的 multiply 混合层处理（见 PixiChromaticAgeingLayer）：
            // 在透明叠加 canvas 上画 multiply 不与下方场景发生混合，只会退化成一层平铺色纱。
            if (effect.id === 'chromatic-ageing') continue
            drawPixiEffectAsset({
                ctx,
                asset: effect.id,
                width: context.scene.canvas.width,
                height: context.scene.canvas.height,
                shapes: context.scene.shapes,
                params: effect.params,
            })
        }
    }

    const coastlinePlugin = style.decorations?.find(item => item.id === 'coastline-outline')
    if (style.coastline?.enabled && coastlinePlugin) {
        // 先画向海侧的等距晕线（在下），再叠陆地边界描边（在上）。hatchRings>0 才启用。
        // linework 模式下晕线由 shader 插件绘制，这里只留矢量描边。
        const hatchParams = coastlinePlugin.params
        if (mode === 'full' && getNumberParam(hatchParams?.hatchRings, 0) > 0) {
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

    if (showCompass) {
        drawCompass(ctx, context, style)
    }

    pixiOverlayLog(`createOverlayCanvas: done ${canvas.width}x${canvas.height}`)
    return canvas
}

/**
 * canvas 直通纹理：跳过 toDataURL(PNG 同步编码) + new Image(异步解码) 往返——
 * 超采样大图一次编码可达数百 ms，是风格/场景变更时叠加层重建的最大单项开销。
 * skipCache=true（第二参）确保每次新建 TextureSource，避免 Pixi 全局缓存
 * 返回已被 destroy 的旧纹理。
 */
function useCanvasTexture(canvas: HTMLCanvasElement | null): Texture {
    const [texture, setTexture] = useState<Texture>(Texture.EMPTY)

    useEffect(() => {
        if (!canvas) {
            setTexture(Texture.EMPTY)
            return
        }

        try {
            setTexture(Texture.from({resource: canvas}, true))
            pixiOverlayLog(`useCanvasTexture: created ${canvas.width}x${canvas.height}`)
        } catch (e) {
            pixiOverlayLog(`useCanvasTexture: Texture.from failed ${e instanceof Error ? e.message : String(e)}`)
            setTexture(Texture.EMPTY)
        }
    }, [canvas])

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

/**
 * 海岸场纹理：RG16F 半浮点有符号距离（R=距离，>0 海侧 <0 陆侧）。
 * 半浮点线性过滤是 WebGL2 核心能力；RG（4 字节/texel）保证任意宽度下
 * 行距 4 字节对齐（Pixi 上传不改 UNPACK_ALIGNMENT，R16F 奇数宽度会错位）。
 * 生命周期与 useCanvasTexture 同模式：替换/卸载后延迟销毁。
 */
function useCoastFieldTexture(field: CoastFieldData | null): Texture {
    const [texture, setTexture] = useState<Texture>(Texture.EMPTY)

    useEffect(() => {
        if (!field) {
            setTexture(Texture.EMPTY)
            return
        }

        try {
            const source = new BufferImageSource({
                resource: field.data,
                width: field.width,
                height: field.height,
                format: 'rg16float',
                alphaMode: 'no-premultiply-alpha',
                scaleMode: 'linear',
                label: 'map-coast-field',
            })
            setTexture(new Texture({source}))
            pixiOverlayLog(`useCoastFieldTexture: created ${field.width}x${field.height}`)
        } catch (e) {
            pixiOverlayLog(`useCoastFieldTexture: failed ${e instanceof Error ? e.message : String(e)}`)
            setTexture(Texture.EMPTY)
        }
    }, [field])

    useEffect(() => {
        return () => {
            if (texture !== Texture.EMPTY && !texture.destroyed) {
                texture.destroy(true)
            }
        }
    }, [texture])

    return texture
}

/**
 * Shader 模式的 Overlay 渲染
 *
 * 每个插件是一个覆盖场景的 Mesh 四边形（场景坐标 + UV=场景归一化坐标），
 * 兄弟节点按序 alpha 混合合成。不用 Filter 堆叠：后一个 pass 的 discard
 * 会把前一个 pass 的输出清掉，且 Filter 的屏幕空间 frame 数学在平移缩放
 * 下极易出错。海岸场纹理在此组件内生成并由 useCanvasTexture 管理生命周期。
 */
function PixiShaderOverlay({
    context,
    style,
    coastField,
    terrainField,
}: {
    context: MapPixiPreviewOverlayContext
    style: PixiMapStyle
    coastField: Texture
    terrainField: Texture
}) {
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    const shapes = context.scene.shapes

    // GPU 资源统一走"effect 内创建 + setState、被替换后在 cleanup 里销毁旧值"的模式
    //（与 useCanvasTexture 一致）。不能在 useMemo 里建资源、在 cleanup 里销毁：
    // StrictMode 会保留 useMemo 缓存并重放 effect 的 cleanup/setup，重放后 Mesh
    // 将渲染已销毁的 shader/geometry。

    // 场景四边形几何：aPosition 用场景坐标，aUV 0..1
    const [geometry, setGeometry] = useState<MeshGeometry | null>(null)
    useEffect(() => {
        setGeometry(new MeshGeometry({
            positions: new Float32Array([0, 0, sceneW, 0, sceneW, sceneH, 0, sceneH]),
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        }))
    }, [sceneW, sceneH])
    useEffect(() => () => {
        geometry?.destroy()
    }, [geometry])

    const [renderItems, setRenderItems] = useState<Array<{key: string; renderer: ShaderRenderer}>>([])
    useEffect(() => {
        const renderContext: ShaderRenderContext = {
            scene: {shapes, canvas: {width: sceneW, height: sceneH}},
            coastField,
            terrainField,
        }

        const items: Array<{key: string; renderer: ShaderRenderer}> = []
        const push = (config: PixiStylePluginConfig | undefined) => {
            if (!config) return
            const plugin = shaderRegistry.get(config.id)
            const renderer = plugin?.createShaderRenderer(config.params ?? {}) ?? null
            if (!renderer) return
            renderer.update?.(renderContext)
            items.push({key: config.id, renderer})
            pixiOverlayLog(`PixiShaderOverlay: added mesh for ${config.id}`)
        }

        // 与 Canvas 位图的绘制次序一致：海水 → 地形 → 陆地纵深 → 淡墨/笔触 → 效果 → 晕线。
        // 海岸线本体描边与罗盘是矢量线稿，由上层的 linework 位图承担。
        push(style.decorations?.find(item => item.id === 'sea'))
        if (terrainField !== Texture.EMPTY) {
            push(style.decorations?.find(item => item.id === 'terrain'))
        }
        push(style.decorations?.find(item => item.id === 'land-depth'))
        push(style.decorations?.find(item => item.id === 'ink-wash'))
        push(style.decorations?.find(item => item.id === 'brush-stroke'))
        for (const effect of style.effects ?? []) {
            if (effect.id === 'chromatic-ageing') continue // 独立 multiply 图层
            push(effect)
        }
        if (style.coastline?.enabled) {
            push(style.decorations?.find(item => item.id === 'coastline-outline'))
        }

        pixiOverlayLog(`PixiShaderOverlay: collected ${items.length} meshes`)
        setRenderItems(items)
    }, [shapes, sceneW, sceneH, style, coastField, terrainField])

    // 延迟销毁 shader（GlProgram 走 Pixi 全局缓存，不随之销毁）
    useEffect(() => () => {
        renderItems.forEach(item => item.renderer.destroy?.())
    }, [renderItems])

    if (!geometry || renderItems.length === 0) return null

    return (
        <>
            {renderItems.map(({key, renderer}, index) => (
                <pixiMesh
                    key={`${key}-${index}`}
                    geometry={geometry}
                    shader={renderer.shader as TextureShader}
                />
            ))}
        </>
    )
}

function PixiTextureOverlay({
    context,
    style,
    shaderContext,
}: {
    context: MapPixiPreviewOverlayContext
    style: PixiMapStyle
    shaderContext?: {
        useShader: boolean
    }
}) {
    pixiOverlayLog('PixiTextureOverlay: ENTER')
    const sceneW = context.scene.canvas.width
    const sceneH = context.scene.canvas.height
    const shapes = context.scene.shapes

    // 海岸场：CPU 精确 EDT（场景分辨率，一次性数十 ms），只在 shapes/尺寸变化时重算。
    // 生成失败（无有效陆地 / 环境不支持）时整体回退 Canvas 位图路径。
    const wantShader = Boolean(shaderContext?.useShader)
    const coastFieldData = useMemo(
        () => (wantShader ? createCoastFieldData(shapes, sceneW, sceneH) : null),
        [wantShader, shapes, sceneW, sceneH],
    )
    const coastField = useCoastFieldTexture(coastFieldData)
    const shaderActive = wantShader && coastFieldData !== null
    const terrainFieldCanvas = useMemo(
        () => createTerrainFieldCanvas(context.scene.terrainStrokes, sceneW, sceneH),
        [context.scene.terrainStrokes, sceneW, sceneH],
    )
    const terrainField = useCanvasTexture(terrainFieldCanvas)

    // overlay 内容只依赖 scene.shapes / 画布尺寸 / style，与 viewportTransform 无关
    //（它在场景坐标里绘制，平移缩放由父容器 transform 承担）。绝不能把整个 context 放进
    // 依赖：context 每帧都是新对象（带 viewportTransform），会导致平移缩放的每一帧都重跑
    // createOverlayCanvas（整块画布重绘 + 重新上传纹理），是风格化渲染卡成个位数帧的主因。
    const overlayCanvas = useMemo(
        () => createOverlayCanvas(context, style, shaderActive ? 'linework' : 'full', terrainFieldCanvas),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [context.scene.shapes, context.scene.terrainStrokes, sceneW, sceneH, style, shaderActive, terrainFieldCanvas],
    )
    const texture = useCanvasTexture(overlayCanvas)

    pixiOverlayLog(`PixiTextureOverlay: shaderActive=${shaderActive} overlayCanvas=${overlayCanvas ? 'present' : 'empty'}`)

    return (
        <>
            {shaderActive && coastField !== Texture.EMPTY && (
                <PixiShaderOverlay
                    context={context}
                    style={style}
                    coastField={coastField}
                    terrainField={terrainField}
                />
            )}
            {overlayCanvas && texture !== Texture.EMPTY && (
                <pixiSprite
                    texture={texture}
                    x={0}
                    y={0}
                    width={sceneW}
                    height={sceneH}
                />
            )}
        </>
    )
}

/**
 * 色彩老化（chromatic-ageing）：整幅暖褐正片叠底，统一压暗提黄做旧。
 * 必须作为独立 Pixi 图层用 blendMode='multiply' 与下方场景真正混合——
 * 画进透明叠加 canvas 的 multiply 不会作用到场景，只会退化成一层平铺色纱。
 * alpha 控制强度：result = dest * mix(1, color, alpha)。
 */
function PixiChromaticAgeingLayer({context, style}: {
    context: MapPixiPreviewOverlayContext
    style: PixiMapStyle
}) {
    const effect = style.effects?.find(item => item.id === 'chromatic-ageing')
    const width = context.scene.canvas.width
    const height = context.scene.canvas.height
    const opacity = Math.max(0, Math.min(1, getNumberParam(effect?.params?.opacity, 0.08)))
    const [r, g, b] = parseColorToVec3(
        getStringParam(effect?.params?.color, 'rgba(139, 83, 28, 1)'),
        [139 / 255, 83 / 255, 28 / 255],
    )
    const colorHex = (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255)

    const draw = useCallback((graphics: Graphics) => {
        graphics.clear()
        graphics.rect(0, 0, width, height)
        graphics.fill({color: colorHex})
    }, [width, height, colorHex])

    if (!effect || opacity <= 0 || width <= 0 || height <= 0) return null

    return <pixiGraphics blendMode="multiply" alpha={opacity} draw={draw}/>
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
            y={location.position[1] + offsetY / scale}
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

export function createPixiOverlayRenderer(
    style: PixiMapStyle,
    shaderContext?: {
        useShader: boolean
    },
): PixiOverlayRenderer | undefined {
    const showCoastline = Boolean(style.coastline?.enabled && hasDecoration(style, 'coastline-outline'))
    const showCompass = hasDecoration(style, 'compass')
    const showEffects = Boolean(style.effects?.length)
    const showDecorations = Boolean(style.decorations?.length)
    const showOverlayLabels = Boolean(style.labels.show && style.labels.renderer === 'overlay')
    const showTextureOverlay = showEffects || showDecorations || showCoastline || showCompass
    const showAgeing = Boolean(style.effects?.some(effect => effect.id === 'chromatic-ageing'))

    pixiOverlayLog(`createPixiOverlayRenderer: effects=${showEffects} coastline=${showCoastline} compass=${showCompass} labels=${showOverlayLabels} useShader=${shaderContext?.useShader ?? false}`)

    if (!showTextureOverlay && !showOverlayLabels) return undefined

    return (context) => {
        pixiOverlayLog(`RENDER_FN: called showTextureOverlay=${showTextureOverlay} showOverlayLabels=${showOverlayLabels} sceneShapes=${context.scene.shapes.length} sceneKeyLocs=${context.scene.keyLocations.length} canvas=${context.scene.canvas.width}x${context.scene.canvas.height}`)
        return (
            <>
                {showTextureOverlay && <PixiTextureOverlay context={context} style={style} shaderContext={shaderContext}/>}
                {showAgeing && <PixiChromaticAgeingLayer context={context} style={style}/>}
                {showOverlayLabels && <PixiOverlayLabels context={context} style={style}/>}
            </>
        )
    }
}
