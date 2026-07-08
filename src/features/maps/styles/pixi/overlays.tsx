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
import {hexToRgbaColor, isMapDebugLogEnabled, strokeToRgbaColor} from '../common'
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
): void {
    const rings = Math.max(1, Math.min(12, Math.round(getNumberParam(hatch.rings, 4))))
    const gap = Math.max(1, getNumberParam(hatch.gap, 7))
    const lineWidth = Math.max(0.4, getNumberParam(hatch.width, 0.9))
    const opacity = Math.max(0, Math.min(1, getNumberParam(hatch.opacity, 0.5)))
    const rgba = hexToRgbaColor(getStringParam(hatch.color, '#6a4a26'))
    const width = context.scene.canvas.width
    const height = context.scene.canvas.height
    const shapes = context.scene.shapes.filter(shape => shape.polygon.length >= 3)
    if (!shapes.length || width <= 0 || height <= 0) return

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    const maskCtx = maskCanvas.getContext('2d')
    const ringCanvas = document.createElement('canvas')
    ringCanvas.width = width
    ringCanvas.height = height
    const ringCtx = ringCanvas.getContext('2d')
    if (!maskCtx || !ringCtx) return

    for (let ring = 1; ring <= rings; ring++) {
        const ringOpacity = opacity * (1 - (ring - 1) / rings)
        if (ringOpacity <= 0.01) continue
        const distance = ring * gap

        // 外圈：陆地膨胀 distance
        paintDilatedLand(maskCtx, shapes, width, height, distance)
        ringCtx.globalCompositeOperation = 'source-over'
        ringCtx.clearRect(0, 0, width, height)
        ringCtx.drawImage(maskCanvas, 0, 0)

        // 减去内圈：陆地膨胀 distance − lineWidth，剩下一条细环
        paintDilatedLand(maskCtx, shapes, width, height, Math.max(0, distance - lineWidth))
        ringCtx.globalCompositeOperation = 'destination-out'
        ringCtx.drawImage(maskCanvas, 0, 0)

        // 用晕线颜色给细环上色（source-in：只在细环 alpha 处着色）
        ringCtx.globalCompositeOperation = 'source-in'
        ringCtx.fillStyle = colorToCss(rgba, 1)
        ringCtx.fillRect(0, 0, width, height)
        ringCtx.globalCompositeOperation = 'source-over'

        ctx.save()
        ctx.globalAlpha = ringOpacity
        ctx.drawImage(ringCanvas, 0, 0)
        ctx.restore()
    }
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
    const canvas = document.createElement('canvas')
    canvas.width = context.scene.canvas.width
    canvas.height = context.scene.canvas.height
    const ctx = canvas.getContext('2d')

    if (!ctx) {
        pixiOverlayLog('createOverlayDataUrl: getContext(2d) returned null')
        return ''
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
            })
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
