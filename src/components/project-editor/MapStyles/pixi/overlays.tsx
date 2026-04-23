import '@pixi/react'
import type {ReactNode} from 'react'
import {useCallback} from 'react'
import type {Graphics} from 'pixi.js'
import type {MapPixiPreviewOverlayContext, MapRgbaColor} from 'flowcloudai-ui'
import type {PixiCoastlineLayerStyle, PixiDecorationPluginId, PixiMapStyle} from './types'
import {strokeToRgbaColor} from '../common'

type PixiOverlayRenderer = (context: MapPixiPreviewOverlayContext) => ReactNode

function colorToHex(color: MapRgbaColor): number {
    return (color[0] << 16) + (color[1] << 8) + color[2]
}

function colorToAlpha(color: MapRgbaColor): number {
    return Math.max(0, Math.min(1, color[3] / 255))
}

function flattenPolygon(polygon: [number, number][]): number[] {
    return polygon.flatMap(([x, y]) => [x, y])
}

function drawCoastlineLayer(
    graphics: Graphics,
    context: MapPixiPreviewOverlayContext,
    layer: PixiCoastlineLayerStyle,
) {
    graphics.clear()
    const color = strokeToRgbaColor(layer)
    const width = layer.width / Math.max(context.viewportTransform.scale, 0.01)

    for (const shape of context.scene.shapes) {
        if (shape.polygon.length < 3) continue
        graphics
            .poly(flattenPolygon(shape.polygon), true)
            .stroke({
                width,
                color: colorToHex(color),
                alpha: colorToAlpha(color),
            })
    }
}

function PixiCoastlineLayer({
                                context,
                                layer,
                                index,
                            }: {
    context: MapPixiPreviewOverlayContext
    layer: PixiCoastlineLayerStyle
    index: number
}) {
    const draw = useCallback((graphics: Graphics) => {
        drawCoastlineLayer(graphics, context, layer)
    }, [context, layer])

    return <pixiGraphics key={`coastline-${index}`} draw={draw}/>
}

function buildCirclePoints(cx: number, cy: number, radius: number, segments: number): [number, number][] {
    const points: [number, number][] = []
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
    }
    return points
}

function drawCompass(graphics: Graphics, context: MapPixiPreviewOverlayContext, color: MapRgbaColor) {
    graphics.clear()

    const scale = Math.max(context.viewportTransform.scale, 0.01)
    const size = 58 / scale
    const radius = size / 2
    const margin = 72 / scale
    const cx = context.scene.canvas.width - margin
    const cy = margin
    const baseColor = colorToHex(color)
    const baseAlpha = colorToAlpha(color)

    graphics
        .poly(flattenPolygon(buildCirclePoints(cx, cy, radius * 1.06, 40)), true)
        .fill({color: 0xf4e1b4, alpha: 0.43})
        .stroke({width: 1 / scale, color: baseColor, alpha: baseAlpha * 0.45})

    const directions = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]
    directions.forEach((angle, index) => {
        const isNorth = index === 0
        const tip: [number, number] = [
            cx + Math.cos(angle) * radius * 0.84,
            cy + Math.sin(angle) * radius * 0.84,
        ]
        const left: [number, number] = [
            cx + Math.cos(angle + Math.PI / 2) * radius * 0.16,
            cy + Math.sin(angle + Math.PI / 2) * radius * 0.16,
        ]
        const right: [number, number] = [
            cx + Math.cos(angle - Math.PI / 2) * radius * 0.16,
            cy + Math.sin(angle - Math.PI / 2) * radius * 0.16,
        ]

        graphics
            .poly(flattenPolygon([left, tip, right]), true)
            .fill({color: baseColor, alpha: baseAlpha * (isNorth ? 0.27 : 0.14)})
            .stroke({width: (isNorth ? 1.8 : 1.3) / scale, color: baseColor, alpha: baseAlpha * (isNorth ? 0.88 : 0.6)})
    })

    graphics
        .poly(flattenPolygon(buildCirclePoints(cx, cy, radius, 32)), false)
        .stroke({width: 1 / scale, color: baseColor, alpha: baseAlpha * 0.5})
        .circle(cx, cy, radius * 0.12)
        .stroke({width: 1.5 / scale, color: baseColor, alpha: baseAlpha})
}

function PixiCompass({context, color}: { context: MapPixiPreviewOverlayContext; color: MapRgbaColor }) {
    const draw = useCallback((graphics: Graphics) => {
        drawCompass(graphics, context, color)
    }, [color, context])

    return <pixiGraphics draw={draw}/>
}

function hasDecoration(style: PixiMapStyle, id: PixiDecorationPluginId): boolean {
    return Boolean(style.decorations?.some(plugin => plugin.id === id))
}

export function createPixiOverlayRenderer(style: PixiMapStyle): PixiOverlayRenderer | undefined {
    const showCoastline = Boolean(style.coastline?.enabled && hasDecoration(style, 'coastline-outline'))
    const showCompass = hasDecoration(style, 'compass')

    if (!showCoastline && !showCompass) return undefined

    return (context) => (
        <>
            {showCoastline && style.coastline?.layers.map((layer, index) => (
                <PixiCoastlineLayer
                    key={`coastline-${index}`}
                    context={context}
                    layer={layer}
                    index={index}
                />
            ))}
            {showCompass && (
                <PixiCompass
                    context={context}
                    color={strokeToRgbaColor({
                        color: style.palette.coastline,
                        opacity: 0.78,
                        width: 1,
                    })}
                />
            )}
        </>
    )
}
