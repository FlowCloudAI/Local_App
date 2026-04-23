import '@pixi/react'
import type {ReactNode} from 'react'
import {useEffect, useMemo, useState} from 'react'
import type {TextStyleOptions} from 'pixi.js'
import {Texture} from 'pixi.js'
import type {MapPixiPreviewOverlayContext, MapPreviewKeyLocation, MapRgbaColor} from 'flowcloudai-ui'
import type {PixiCoastlineLayerStyle, PixiDecorationPluginId, PixiLabelRule, PixiMapStyle,} from './types'
import {hexToRgbaColor, strokeToRgbaColor} from '../common'
import {drawPixiCompassAsset, getPixiBrushAssetProfile, type PixiBrushAssetId, type PixiCompassAssetId,} from './assets'

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

function createOverlayDataUrl(context: MapPixiPreviewOverlayContext, style: PixiMapStyle): string {
    const canvas = document.createElement('canvas')
    canvas.width = context.scene.canvas.width
    canvas.height = context.scene.canvas.height
    const ctx = canvas.getContext('2d')

    if (!ctx) return ''

    const coastlinePlugin = style.decorations?.find(item => item.id === 'coastline-outline')
    if (style.coastline?.enabled && coastlinePlugin) {
        const brushAsset = getStringParam(coastlinePlugin.params?.brush, 'tolkien-coastline') as PixiBrushAssetId
        style.coastline.layers.forEach((layer, index) => drawCoastlineLayer(ctx, context, layer, index, brushAsset))
    }

    if (hasDecoration(style, 'compass')) {
        drawCompass(ctx, context, style)
    }

    return canvas.toDataURL('image/png')
}

function useImageTexture(url: string): Texture {
    const [texture, setTexture] = useState<Texture>(Texture.EMPTY)

    useEffect(() => {
        if (!url) {
            setTexture(Texture.EMPTY)
            return undefined
        }

        let cancelled = false
        let activeTexture: Texture | null = null
        const image = new Image()

        image.onload = () => {
            if (cancelled) return
            activeTexture = Texture.from({resource: image}, true)
            setTexture(activeTexture)
        }
        image.onerror = () => {
            if (!cancelled) setTexture(Texture.EMPTY)
        }
        image.src = url

        return () => {
            cancelled = true
            if (activeTexture && activeTexture !== Texture.EMPTY && !activeTexture.destroyed) {
                activeTexture.destroy(true)
            }
        }
    }, [url])

    return texture
}

function PixiTextureOverlay({context, style}: { context: MapPixiPreviewOverlayContext; style: PixiMapStyle }) {
    const dataUrl = useMemo(() => createOverlayDataUrl(context, style), [context.scene, style])
    const texture = useImageTexture(dataUrl)

    if (!dataUrl) return null

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
    if (!style.labels.show || style.labels.renderer !== 'overlay') return null

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
    const showOverlayLabels = Boolean(style.labels.show && style.labels.renderer === 'overlay')
    const showTextureOverlay = showCoastline || showCompass

    if (!showCoastline && !showCompass && !showOverlayLabels) return undefined

    return (context) => (
        <>
            {showTextureOverlay && <PixiTextureOverlay context={context} style={style}/>}
            {showOverlayLabels && <PixiOverlayLabels context={context} style={style}/>}
        </>
    )
}
