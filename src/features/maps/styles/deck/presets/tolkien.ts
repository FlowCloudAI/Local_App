import {PathLayer, PolygonLayer} from '@deck.gl/layers'
import type {Layer} from '@deck.gl/core'
import type {MapDeckPreviewTooltip, MapPreviewKeyLocation, MapPreviewScene, MapPreviewShape,} from 'flowcloudai-ui'
import type {
    MapStyleDecorationContext,
    MapStyleDecorations,
    MapStyleDefinition,
    MapStyleLayerBuildContext,
} from './types'
import {createParchmentTexture} from './textures'
import {createVignetteEffect} from './effects'
import {deckColorToHex} from './utils'
import {buildTolkienLocationIcon} from './icons'
import {buildCoastOutlines} from './generators/coast'
import {buildCompassPaths, buildCompassPolygons} from './generators/compass'

function buildShapeTooltip(shape: MapPreviewShape): MapDeckPreviewTooltip {
    return {
        html: `<div style="display:flex;flex-direction:column;gap:4px;min-width:180px;padding:12px 14px;border-radius:12px;background:linear-gradient(180deg, rgba(249,237,203,0.98), rgba(230,207,160,0.96));color:#5c3b22;border:1px solid rgba(120,78,39,0.35);box-shadow:0 14px 32px rgba(88,52,24,0.18);font-family:&quot;Georgia&quot;, &quot;Times New Roman&quot;, &quot;STSong&quot;, serif;"><strong style="font-size:14px;">${shape.name}</strong><span>边界点数：${shape.polygon.length}</span></div>`,
        style: {
            backgroundColor: 'transparent',
            border: 'none',
            padding: '0',
            boxShadow: 'none',
        },
    }
}

function buildLocationTooltip(location: MapPreviewKeyLocation): MapDeckPreviewTooltip {
    return {
        html: `<div style="display:flex;flex-direction:column;gap:4px;min-width:190px;padding:12px 14px;border-radius:12px;background:linear-gradient(180deg, rgba(249,237,203,0.98), rgba(230,207,160,0.96));color:#5c3b22;border:1px solid rgba(120,78,39,0.35);box-shadow:0 14px 32px rgba(88,52,24,0.18);font-family:&quot;Georgia&quot;, &quot;Times New Roman&quot;, &quot;STSong&quot;, serif;"><strong style="font-size:14px;">${location.name}</strong><span>类型：${location.type}</span><span>坐标：${Math.round(location.position[0])}, ${Math.round(location.position[1])}</span></div>`,
        style: {
            backgroundColor: 'transparent',
            border: 'none',
            padding: '0',
            boxShadow: 'none',
        },
    }
}

function transformScene(scene: MapPreviewScene): MapPreviewScene {
    return {
        ...scene,
        keyLocations: scene.keyLocations.map(location => {
            const icon = buildTolkienLocationIcon(location.type, deckColorToHex(location.color))
            return {
                ...location,
                icon: icon ?? undefined,
                iconSize: icon ? (location.type && /城|都|要塞|港/.test(location.type) ? 36 : 28) : undefined,
            }
        }),
    }
}

function buildDecorations(ctx: MapStyleDecorationContext): MapStyleDecorations {
    return {
        coastOutlines: buildCoastOutlines(ctx.scene),
    }
}

function createExtraLayers(ctx: MapStyleLayerBuildContext): Layer[] {
    const {decorations, canvas} = ctx
    const layers: Layer[] = []

    // 海岸线双重描边
    if (decorations.coastOutlines?.length) {
        layers.push(
            new PathLayer({
                id: 'tolkien-coast-outlines',
                data: decorations.coastOutlines,
                getPath: d => d.path,
                getColor: d => d.color,
                getWidth: d => d.widthPixels,
                widthMinPixels: 0.5,
                jointRounded: true,
                capRounded: true,
                pickable: false,
            })
        )
    }

    // 罗盘（画布右上角），使用填充面 + 描边，避免缩放后只剩细线。
    const compassPolygons = buildCompassPolygons(
        canvas.width - 72,
        72,
        58,
        [90, 58, 28, 200],
    )
    const compassPaths = buildCompassPaths(
        canvas.width - 72,
        72,
        58,
        [90, 58, 28, 200],
    )
    layers.push(
        new PolygonLayer({
            id: 'tolkien-compass-fill',
            data: compassPolygons,
            getPolygon: d => d.polygon,
            getFillColor: d => d.fillColor,
            getLineColor: d => d.lineColor,
            lineWidthMinPixels: 0.6,
            stroked: true,
            filled: true,
            pickable: false,
        }),
        new PathLayer({
            id: 'tolkien-compass',
            data: compassPaths,
            getPath: d => d.path,
            getColor: d => d.color,
            getWidth: d => d.widthPixels,
            widthMinPixels: 0.5,
            jointRounded: true,
            pickable: false,
        })
    )

    return layers
}

export const tolkienStyle: MapStyleDefinition = {
    id: 'tolkien',
    label: '托尔金',
    fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
    oceanColor: '#c9a86c',

    deckConfig: {
        polygonShaderInject: {
            'fs:DECKGL_FILTER_COLOR': `
                float lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
                color.r = min(lum * 1.10 + 0.06, 1.0);
                color.g = min(lum * 1.02 + 0.02, 1.0);
                color.b = min(lum * 0.82, 1.0);
                color.a *= 0.94;
                float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
                color.rgb *= (0.97 + n * 0.06);
            `,
        },
        polygonLayerProps: {
            lineWidthMinPixels: 4,
        },
        scatterplotLayerProps: {
            getRadius: 7,
            radiusMaxPixels: 16,
            stroked: true,
            getLineColor: () => [245, 232, 199, 255] as [number, number, number, number],
            lineWidthMinPixels: 2,
        },
        iconLayerProps: {
            getSize: 32,
        },
        textLayerProps: {
            getSize: 15,
            getColor: () => [92, 59, 34, 255] as [number, number, number, number],
            fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
        },
        deckEffects: [createVignetteEffect()],
    },

    createBackgroundTexture: (canvas) => createParchmentTexture(canvas.width, canvas.height),
    buildLocationIcon: buildTolkienLocationIcon,
    buildShapeTooltip,
    buildLocationTooltip,
    transformScene,
    buildDecorations,
    createExtraLayers,
}
