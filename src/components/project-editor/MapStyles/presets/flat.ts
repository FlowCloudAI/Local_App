import type {MapVisualStyle} from '../types'

export const flatMapVisualStyle: MapVisualStyle = {
    version: 1,
    id: 'semantic-flat',
    name: '语义扁平',
    description: 'MapStyles 新语义层的基础预设，用于验证 Pixi 与 Deck 的最小编译链路。',
    rendererIntent: 'balanced',
    palette: {
        ocean: '#b8d7ee',
        land: '#ffffff',
        coastline: '#185fa5',
        regionFill: '#ffffff',
        regionStroke: '#185fa5',
        location: '#d4306a',
        label: '#262b38',
        accent: '#2563eb',
    },
    background: {
        kind: 'solid',
        color: '#b8d7ee',
        opacity: 1,
        fit: 'fill',
    },
    regions: {
        fill: {
            color: '#ffffff',
            opacity: 1,
        },
        stroke: {
            color: '#185fa5',
            opacity: 1,
            width: 2,
        },
    },
    coastline: {
        enabled: false,
        layers: [],
    },
    locations: {
        renderMode: 'circle',
        marker: {
            radius: 8,
            color: '#d4306a',
            stroke: {
                color: '#ffffff',
                opacity: 1,
                width: 2,
            },
        },
    },
    labels: {
        show: true,
        color: '#262b38',
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        fontSize: 13,
        fontWeight: '600',
    },
    deck: {
        mode: 'readable',
        showLabels: true,
        regionFillOpacity: 1,
        regionStrokeWidth: 2,
        locationRadius: 8,
    },
}
