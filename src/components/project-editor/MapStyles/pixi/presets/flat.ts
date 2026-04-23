import type {PixiMapStyle} from '../types'

export const flatPixiMapStyle: PixiMapStyle = {
    version: 1,
    id: 'flat',
    name: 'Pixi 扁平',
    description: 'Pixi 风格系统的基础预设，强调清晰不透明区域与稳定地点标记。',
    palette: {
        ocean: '#b8d7ee',
        paper: '#ffffff',
        land: '#ffffff',
        coastline: '#185fa5',
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
}
