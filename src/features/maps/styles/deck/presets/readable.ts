import type {DeckMapStyle} from '../types'

export const readableDeckMapStyle: DeckMapStyle = {
    version: 1,
    id: 'deck-readable',
    name: 'Deck 清晰',
    description: 'Deck 风格系统的基础预设，偏向大规模地图下的清晰与稳定。',
    background: {
        kind: 'solid',
        color: '#b8d7ee',
        opacity: 1,
        fit: 'fill',
    },
    polygon: {
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
    locations: {
        renderMode: 'circle',
        radius: 8,
        color: '#d4306a',
        stroke: {
            color: '#ffffff',
            opacity: 1,
            width: 2,
        },
        showLabels: true,
    },
    labels: {
        color: '#262b38',
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        fontSize: 13,
        fontWeight: '600',
    },
    performance: {
        mode: 'readable',
    },
}
