import type {MapStyleCompileContext} from '../common'
import {
    createParchmentTexture,
    createRicePaperTexture,
    makeSolidBackgroundDataUrl,
    paintToRgbaColor,
    strokeToRgbaColor,
} from '../common'
import type {CompiledPixiMapStyle, PixiLocationColorRule, PixiMapStyle} from './types'
import {buildTolkienPixiLocationIcon} from './icons'
import {createPixiOverlayRenderer} from './overlays'

function colorToHexString(color: [number, number, number, number]): string {
    return `#${color.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function matchLocationColorRule(type: string, rule: PixiLocationColorRule): boolean {
    if (rule.typeIncludes?.some(token => type.includes(token))) return true
    if (!rule.typePattern) return false

    try {
        return new RegExp(rule.typePattern).test(type)
    } catch {
        return false
    }
}

function resolveLocationColor(type: string, style: PixiMapStyle): [number, number, number, number] {
    const rule = style.locations.colorRules?.find(item => matchLocationColorRule(type, item))
    return paintToRgbaColor({
        color: rule?.color ?? style.locations.marker.color,
        opacity: rule?.opacity ?? 1,
    })
}

function resolvePixiBackgroundImage({style, canvas}: MapStyleCompileContext<PixiMapStyle>) {
    const background = style.background

    if (background.kind === 'image' && background.url) {
        return {
            url: background.url,
            opacity: background.opacity ?? 1,
            fit: background.fit ?? 'cover',
        }
    }

    if (background.kind === 'generated-texture') {
        const textureUrl = background.texture === 'parchment'
            ? createParchmentTexture(canvas.width, canvas.height)
            : background.texture === 'rice-paper'
                ? createRicePaperTexture(canvas.width, canvas.height)
                : ''

        if (textureUrl) {
            return {
                url: textureUrl,
                opacity: background.opacity ?? 1,
                fit: 'fill' as const,
            }
        }
    }

    return {
        url: makeSolidBackgroundDataUrl(background.color ?? style.palette.ocean),
        opacity: background.opacity ?? 1,
        fit: 'fill' as const,
    }
}

export function compilePixiMapStyle(context: MapStyleCompileContext<PixiMapStyle>): CompiledPixiMapStyle {
    const {style, scene} = context
    const markerStroke = style.locations.marker.stroke
    const compiledScene = {
        ...scene,
        backgroundImage: resolvePixiBackgroundImage(context),
        shapes: scene.shapes.map(shape => ({
            ...shape,
            fillColor: paintToRgbaColor(style.regions.fill),
            lineColor: strokeToRgbaColor(style.regions.stroke),
        })),
        keyLocations: scene.keyLocations.map(location => {
            const color = resolveLocationColor(location.type, style)
            const icon = style.locations.iconSet === 'tolkien'
                ? buildTolkienPixiLocationIcon(location.type, colorToHexString(color))
                : undefined

            return {
                ...location,
                color,
                icon,
                iconSize: icon ? style.locations.marker.iconSize : undefined,
            }
        }),
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
            emptyHint: '当前 Pixi 风格暂无可渲染的场景。',
            renderOverlay: createPixiOverlayRenderer(style),
        },
    }
}
