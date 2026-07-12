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
        location: '#8f2f2f',
        label: '#6f2b2b',
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
            opacity: 0.5,
            width: 2,
        },
    },
    coastline: {
        enabled: true,
        layers: [
            {
                color: '#1f1f1f',
                opacity: 0.2,
                width: 5,
                jitter: 1.2,
            },
            {
                color: '#121212',
                opacity: 0.9,
                width: 2,
                jitter: 0.8,
            },
        ],
    },
    locations: {
        renderMode: 'auto',
        marker: {
            radius: 4,
            color: '#8f2f2f',
            iconSize: 18,
        },
        colorRules: [
            {
                typePattern: '都|京',
                color: '#9b2323',
                opacity: 0.72,
            },
        ],
        markerAssets: {
            marker: {iconSet: 'ink-stamp', asset: 'marker', color: '#8f2f2f', iconSize: 18},
            'major-city': {iconSet: 'ink-stamp', asset: 'major-city', color: '#9b2323', iconSize: 26},
            city: {iconSet: 'ink-stamp', asset: 'city', color: '#71382e', iconSize: 22},
            town: {iconSet: 'ink-stamp', asset: 'town', color: '#574a3b', iconSize: 22},
            landmark: {iconSet: 'ink-stamp', asset: 'landmark', color: '#31545a', iconSize: 24},
            event: {iconSet: 'ink-stamp', asset: 'event', color: '#9b2323', iconSize: 22},
            ruin: {iconSet: 'ink-stamp', asset: 'ruin', color: '#6d5843', iconSize: 22},
            harbor: {iconSet: 'ink-stamp', asset: 'harbor', color: '#315d69', iconSize: 24},
        },
        iconSet: 'ink-stamp',
    },
    labels: {
        show: true,
        renderer: 'overlay',
        color: '#6f2b2b',
        fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
        fontSize: 14,
        fontWeight: '600',
        offsetY: 18,
        haloColor: 'rgba(251, 250, 247, 0.94)',
        haloWidth: 3,
        rules: [
            {
                typePattern: '都|京',
                color: '#8f2020',
                opacity: 0.82,
                fontWeight: '600',
            },
        ],
    },
    decorations: [
        {
            id: 'terrain',
            params: {
                organicStrength: 0.86,
                terrainKinds: {
                    grass: {
                        color: '#71806a',
                        detailColor: '#4f6250',
                        baseOpacity: 0.09,
                        pattern: 'ink-grass',
                        patternOpacity: 0.34,
                        patternScale: 24,
                    },
                    mountain: {
                        color: '#596767',
                        detailColor: '#455454',
                        baseOpacity: 0.07,
                        pattern: 'none',
                        patternOpacity: 0,
                        patternScale: 30,
                    },
                    desert: {
                        color: '#9a8462',
                        detailColor: '#766044',
                        baseOpacity: 0.1,
                        pattern: 'ink-desert',
                        patternOpacity: 0.32,
                        patternScale: 28,
                    },
                },
                symbols: {
                    mountain: {
                        asset: 'ink-mountain',
                        color: '#47585a',
                        size: 58,
                        spacing: 58,
                        opacity: 0.76,
                        jitter: 0.48,
                        variants: 3,
                    },
                },
            },
        },
        {
            id: 'coastline-outline',
            params: {
                brush: 'ink-boundary',
                hatchRings: 0,
            },
        },
        {
            id: 'brush-stroke',
            params: {
                baseWidth: 5,
                widthVariation: 0.28,
                dryBrushThreshold: 0.28,
                inkColor: '#121212',
                inkOpacity: 0.52,
            },
        },
        {
            id: 'ink-wash',
            params: {
                washWidth: 24,
                lightInk: '#30302c',
                washOpacity: 0.22,
                layers: 4,
            },
        },
        {
            id: 'sea',
            params: {
                depthBands: 3,
                depthGap: 18,
                depthColor: '#8a887e',
                depthOpacity: 0.1,
                depthShallowFade: 0.85,
            },
        },
    ],
    effects: [
        {
            id: 'ink-bleed',
            params: {
                color: 'rgba(16, 16, 16, 1)',
                width: 3,
                blur: 9,
                opacity: 0.28,
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
