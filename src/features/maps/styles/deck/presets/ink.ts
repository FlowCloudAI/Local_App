import type {MapDeckPreviewTooltip, MapPreviewKeyLocation, MapPreviewScene, MapPreviewShape,} from 'flowcloudai-ui'
import type {MapStyleDefinition} from './types'
import {createRicePaperTexture} from './textures'
import {createInkBleedEffect} from './effects'

function buildShapeTooltip(shape: MapPreviewShape): MapDeckPreviewTooltip {
    return {
        html: `<div style="display:flex;flex-direction:column;gap:5px;min-width:170px;padding:10px 12px;border-radius:4px;background:rgba(255,255,255,0.96);color:#111111;border:1px solid rgba(17,17,17,0.22);box-shadow:6px 8px 0 rgba(17,17,17,0.08);font-family:&quot;STKaiti&quot;, &quot;KaiTi&quot;, &quot;FangSong&quot;, serif;"><strong>${shape.name}</strong><span>边界点数：${shape.polygon.length}</span></div>`,
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
        html: `<div style="display:flex;flex-direction:column;gap:5px;min-width:180px;padding:10px 12px;border-radius:4px;background:rgba(255,255,255,0.96);color:#111111;border:1px solid rgba(17,17,17,0.22);box-shadow:6px 8px 0 rgba(17,17,17,0.08);font-family:&quot;STKaiti&quot;, &quot;KaiTi&quot;, &quot;FangSong&quot;, serif;"><strong>${location.name}</strong><span>类型：${location.type}</span><span>坐标：${Math.round(location.position[0])}, ${Math.round(location.position[1])}</span></div>`,
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
        keyLocations: scene.keyLocations.map(location => ({
            ...location,
            icon: undefined,
            iconSize: undefined,
        })),
    }
}

export const inkStyle: MapStyleDefinition = {
    id: 'ink',
    label: '水墨',
    fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
    oceanColor: '#ede9e0',

    deckConfig: {
        polygonShaderInject: {
            'fs:DECKGL_FILTER_COLOR': `
                float lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
                // 轻微去饱和，保留淡墨韵味，不强制灰度
                vec3 tint = vec3(0.10, 0.10, 0.12);
                vec3 base = mix(color.rgb, vec3(lum), 0.35);
                color.rgb = mix(base, tint, 0.06);
                color.a *= 0.82;
            `,
        },
        polygonLayerProps: {
            lineWidthMinPixels: 3,
            getLineColor: () => [18, 18, 18, 210] as [number, number, number, number],
            getFillColor: (s: { fillColor: [number, number, number, number] }) =>
                [s.fillColor[0], s.fillColor[1], s.fillColor[2], 8] as [number, number, number, number],
        },
        scatterplotLayerProps: {
            getRadius: 4,
            radiusMaxPixels: 9,
            stroked: false,
            filled: true,
            getFillColor: (loc: { type?: string }) => {
                const isCapital = loc.type ? /都|京/.test(loc.type) : false
                return isCapital
                    ? ([155, 35, 35, 180] as [number, number, number, number])
                    : ([16, 16, 16, 170] as [number, number, number, number])
            },
        },
        iconLayerProps: {
            getSize: 0,
        },
        textLayerProps: {
            getSize: 14,
            getColor: () => [12, 12, 12, 230] as [number, number, number, number],
            fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
            getPixelOffset: () => [0, -12] as [number, number],
        },
        deckEffects: [createInkBleedEffect()],
    },

    createBackgroundTexture: (canvas) => createRicePaperTexture(canvas.width, canvas.height),
    buildLocationIcon: () => null,
    buildShapeTooltip,
    buildLocationTooltip,
    transformScene,
}
