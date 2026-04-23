import type {CompiledMapVisualStyle, MapStyleCompileInput} from '../types'
import {paintToRgbaColor, resolveBackgroundImage, strokeToRgbaColor} from '../utils'

export function compilePixiStyle(input: MapStyleCompileInput): CompiledMapVisualStyle {
    const {style, scene} = input
    const markerStroke = style.locations.marker.stroke
    const compiledScene = {
        ...scene,
        backgroundImage: resolveBackgroundImage(style.background, style.palette),
        shapes: scene.shapes.map(shape => ({
            ...shape,
            fillColor: paintToRgbaColor(style.regions.fill),
            lineColor: strokeToRgbaColor(style.regions.stroke),
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
        renderer: 'pixi',
        scene: compiledScene,
        viewportStyle: {
            backgroundColor: style.background.color ?? style.palette.ocean,
        },
        shapeStyle: {
            lineWidth: style.regions.stroke.width,
        },
        keyLocationStyle: {
            renderMode: style.locations.renderMode,
            radius: style.locations.marker.radius,
            strokeColor: markerStroke ? strokeToRgbaColor(markerStroke) : undefined,
            strokeWidth: markerStroke?.width,
            showStroke: Boolean(markerStroke),
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
        pixiProps: {
            style: {
                backgroundColor: style.background.color ?? style.palette.ocean,
            },
            showLabels: style.labels.show,
            keyLocationRenderMode: style.locations.renderMode,
            emptyHint: '当前语义风格暂无可渲染的 Pixi 场景。',
        },
    }
}
