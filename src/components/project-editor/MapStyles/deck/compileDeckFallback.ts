import type {CompiledMapVisualStyle, MapStyleCompileInput} from '../types'
import {paintToRgbaColor, resolveBackgroundImage, strokeToRgbaColor} from '../utils'

export function compileDeckFallback(input: MapStyleCompileInput): CompiledMapVisualStyle {
    const {style, scene} = input
    const deckFallback = style.deck
    const compiledScene = {
        ...scene,
        backgroundImage: resolveBackgroundImage(style.background, style.palette),
        shapes: scene.shapes.map(shape => ({
            ...shape,
            fillColor: paintToRgbaColor({
                ...style.regions.fill,
                opacity: deckFallback?.regionFillOpacity ?? style.regions.fill.opacity,
            }),
            lineColor: strokeToRgbaColor({
                ...style.regions.stroke,
                width: deckFallback?.regionStrokeWidth ?? style.regions.stroke.width,
            }),
        })),
        keyLocations: scene.keyLocations.map(location => ({
            ...location,
            color: paintToRgbaColor({
                color: style.locations.marker.color,
                opacity: 1,
            }),
        })),
    }

    return {
        renderer: 'deck',
        scene: compiledScene,
        viewportStyle: {
            backgroundColor: style.background.color ?? style.palette.ocean,
        },
        shapeStyle: {
            lineWidth: deckFallback?.regionStrokeWidth ?? style.regions.stroke.width,
        },
        keyLocationStyle: {
            renderMode: style.locations.renderMode,
            radius: deckFallback?.locationRadius ?? style.locations.marker.radius,
            strokeColor: style.locations.marker.stroke
                ? strokeToRgbaColor(style.locations.marker.stroke)
                : undefined,
            strokeWidth: style.locations.marker.stroke?.width,
            showStroke: Boolean(style.locations.marker.stroke),
            iconSize: style.locations.marker.iconSize,
        },
        labelStyle: {
            fontSize: style.labels.fontSize,
            color: paintToRgbaColor({
                color: style.labels.color,
                opacity: 1,
            }),
            fontFamily: style.labels.fontFamily,
            fontWeight: style.labels.fontWeight,
        },
        deckProps: {
            style: {
                backgroundColor: style.background.color ?? style.palette.ocean,
            },
            showLabels: deckFallback?.showLabels ?? style.labels.show,
            keyLocationRenderMode: style.locations.renderMode,
        },
    }
}
