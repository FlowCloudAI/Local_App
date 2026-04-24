import type {MapStyleCompileContext} from '../common'
import {paintToRgbaColor, resolveBackgroundImage, strokeToRgbaColor} from '../common'
import type {CompiledDeckMapStyle, DeckMapStyle} from './types'

export function compileDeckMapStyle({style, scene}: MapStyleCompileContext<DeckMapStyle>): CompiledDeckMapStyle {
    const compiledScene = {
        ...scene,
        backgroundImage: resolveBackgroundImage(style.background, style.background.color ?? '#b8d7ee'),
        shapes: scene.shapes.map(shape => ({
            ...shape,
            fillColor: paintToRgbaColor(style.polygon.fill),
            lineColor: strokeToRgbaColor(style.polygon.stroke),
        })),
        keyLocations: scene.keyLocations.map(location => ({
            ...location,
            color: paintToRgbaColor({
                color: style.locations.color,
                opacity: 1,
            }),
        })),
    }

    return {
        renderer: 'deck',
        scene: compiledScene,
        viewportStyle: {
            backgroundColor: style.background.color,
        },
        shapeStyle: {
            lineWidth: style.polygon.stroke.width,
        },
        keyLocationStyle: {
            renderMode: style.locations.renderMode,
            radius: style.locations.radius,
            strokeColor: style.locations.stroke ? strokeToRgbaColor(style.locations.stroke) : undefined,
            strokeWidth: style.locations.stroke?.width,
            showStroke: Boolean(style.locations.stroke),
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
                backgroundColor: style.background.color,
            },
            showLabels: style.locations.showLabels,
            keyLocationRenderMode: style.locations.renderMode,
        },
    }
}
