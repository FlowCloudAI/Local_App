import type {PixiMapStyle} from '../types'

export const inkPixiMapStyle: PixiMapStyle = {
    version: 1,
    id: 'ink',
    name: 'Pixi 水墨',
    description: '独立 Pixi 水墨预设：宣纸底、极淡填充、墨色边界、黑与朱红地点。',
    palette: {
        ocean: '#ede9e0',
        paper: '#fbfaf7',
        land: '#fbfaf7',
        coastline: '#121212',
        location: '#101010',
        label: '#0c0c0c',
        accent: '#9b2323',
    },
    background: {
        kind: 'generated-texture',
        texture: 'rice-paper',
        color: '#ede9e0',
        opacity: 1,
        fit: 'fill',
    },
    regions: {
        fill: {
            color: '#fbfaf7',
            opacity: 0.04,
        },
        stroke: {
            color: '#121212',
            opacity: 0.82,
            width: 3,
        },
    },
    coastline: {
        enabled: false,
        layers: [],
    },
    locations: {
        renderMode: 'circle',
        marker: {
            radius: 4,
            color: '#101010',
        },
        colorRules: [
            {
                typePattern: '都|京',
                color: '#9b2323',
                opacity: 0.72,
            },
        ],
    },
    labels: {
        show: true,
        color: '#0c0c0c',
        fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
        fontSize: 14,
        fontWeight: '500',
    },
}
