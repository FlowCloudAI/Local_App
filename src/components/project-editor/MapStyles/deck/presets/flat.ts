import type {
    MapDeckPreviewTooltip,
    MapPreviewKeyLocation,
    MapPreviewKeyLocationIcon,
    MapPreviewScene,
    MapPreviewShape
} from 'flowcloudai-ui'
import type {MapStyleDefinition} from './types'

function buildLocationIcon(): MapPreviewKeyLocationIcon | null {
    return null
}

function buildShapeTooltip(shape: MapPreviewShape): MapDeckPreviewTooltip {
    return {
        html: `<div style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.98);color:#1f2937;border:1px solid rgba(148,163,184,0.35);box-shadow:0 10px 28px rgba(15,23,42,0.12);font-family:&quot;Microsoft YaHei UI&quot;, &quot;PingFang SC&quot;, sans-serif;"><strong>${shape.name}</strong><span>边界点数：${shape.polygon.length}</span></div>`,
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
        html: `<div style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.98);color:#0f172a;border:1px solid rgba(59,130,246,0.18);box-shadow:0 10px 28px rgba(15,23,42,0.12);font-family:&quot;Microsoft YaHei UI&quot;, &quot;PingFang SC&quot;, sans-serif;"><strong>${location.name}</strong><span>类型：${location.type}</span><span>坐标：${Math.round(location.position[0])}, ${Math.round(location.position[1])}</span></div>`,
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

export const flatStyle: MapStyleDefinition = {
    id: 'flat',
    label: '扁平',
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
    oceanColor: '#b8d7ee',

    deckConfig: {
        polygonShaderInject: {},
        polygonLayerProps: {
            lineWidthMinPixels: 2,
            getFillColor: () => [255, 255, 255, 255] as [number, number, number, number],
        },
        scatterplotLayerProps: {
            getRadius: 8,
            radiusMaxPixels: 18,
            stroked: true,
            getLineColor: () => [255, 255, 255, 255] as [number, number, number, number],
            lineWidthMinPixels: 2,
        },
        iconLayerProps: undefined,
        textLayerProps: {
            getSize: 13,
            getColor: () => [38, 43, 56, 255] as [number, number, number, number],
            fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        },
        deckEffects: undefined,
    },

    buildLocationIcon,
    buildShapeTooltip,
    buildLocationTooltip,
    transformScene,
}
