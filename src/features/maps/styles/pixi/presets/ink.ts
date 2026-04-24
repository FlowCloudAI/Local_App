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
        renderMode: 'auto',
        marker: {
            radius: 4,
            color: '#101010',
            iconSize: 18,
        },
        colorRules: [
            {
                typePattern: '都|京',
                color: '#9b2323',
                opacity: 0.72,
            },
        ],
        iconRules: [
            {
                typePattern: '都|京',
                iconSet: 'ink-stamp',
                asset: 'ink-seal',
                color: '#9b2323',
                iconSize: 24,
            },
        ],
        iconSet: 'ink-stamp',
    },
    labels: {
        show: true,
        renderer: 'overlay',
        color: '#0c0c0c',
        fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
        fontSize: 14,
        fontWeight: '500',
        offsetY: 16,
        rules: [
            {
                typePattern: '都|京',
                color: '#9b2323',
                opacity: 0.82,
                fontSize: 15,
                fontWeight: '600',
                offsetY: 18,
            },
        ],
    },
    effects: [
        {
            id: 'ink-bleed',
            params: {
                color: 'rgba(16, 16, 16, 1)',
                width: 9,
                blur: 4,
                opacity: 0.13,
            },
        },
        {
            id: 'edge-darken',
            params: {
                color: 'rgba(18, 18, 18, 1)',
                width: 7,
                opacity: 0.08,
            },
        },
        {
            id: 'paper-grain',
            params: {
                density: 1200,
                opacity: 0.055,
                darkColor: 'rgba(95, 88, 72, 1)',
                lightColor: 'rgba(255, 255, 250, 1)',
            },
        },
    ],
}
