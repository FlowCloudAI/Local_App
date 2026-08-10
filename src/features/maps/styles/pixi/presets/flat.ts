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
        enabled: true,
        layers: [{
            color: '#185fa5',
            opacity: 1,
            width: 2,
            jitter: 0,
        }],
    },
    decorations: [
        {
            id: 'terrain',
            params: {
                terrainKinds: {
                    grass: {
                        color: '#82b45f',
                        detailColor: '#4f7f3a',
                        baseOpacity: 1,
                        pattern: 'flat-grass',
                        patternOpacity: 0.24,
                        patternScale: 22,
                    },
                    mountain: {
                        color: '#8a7868',
                        detailColor: '#5f5248',
                        baseOpacity: 1,
                        pattern: 'flat-mountain',
                        patternOpacity: 0.12,
                        patternScale: 30,
                    },
                    desert: {
                        color: '#d8b067',
                        detailColor: '#9b7437',
                        baseOpacity: 1,
                        pattern: 'flat-desert',
                        patternOpacity: 0.24,
                        patternScale: 18,
                    },
                    hill: {
                        color: '#a69a78',
                        detailColor: '#807454',
                        baseOpacity: 1,
                        pattern: 'flat-mountain',
                        patternOpacity: 0.08,
                        patternScale: 26,
                    },
                    forest: {
                        color: '#5f8158',
                        detailColor: '#456640',
                        baseOpacity: 1,
                        pattern: 'flat-grass',
                        patternOpacity: 0.24,
                        patternScale: 20,
                    },
                },
                symbols: {
                    mountain: {
                        asset: 'flat-mountain',
                        color: '#5f5248',
                        size: 36,
                        spacing: 46,
                        opacity: 0.78,
                        jitter: 0.32,
                        variants: 3,
                    },
                },
            },
        },
        {
            id: 'coastline-outline',
            params: {
                brush: 'tolkien-coastline',
                hatchRings: 0,
            },
        },
    ],
    locations: {
        renderMode: 'auto',
        marker: {
            radius: 8,
            color: '#d4306a',
            stroke: {
                color: '#ffffff',
                opacity: 1,
                width: 2,
            },
            iconSize: 28,
        },
        markerAssets: {
            marker: {iconSet: 'flat', asset: 'marker', color: '#d4306a', iconSize: 24},
            'major-city': {iconSet: 'flat', asset: 'major-city', color: '#b51f4d', iconSize: 34},
            city: {iconSet: 'flat', asset: 'city', color: '#2563eb', iconSize: 30},
            town: {iconSet: 'flat', asset: 'town', color: '#16a085', iconSize: 28},
            landmark: {iconSet: 'flat', asset: 'landmark', color: '#7c3aed', iconSize: 28},
            event: {iconSet: 'flat', asset: 'event', color: '#d97706', iconSize: 26},
            ruin: {iconSet: 'flat', asset: 'ruin', color: '#6b7280', iconSize: 28},
            harbor: {iconSet: 'flat', asset: 'harbor', color: '#0f6b9e', iconSize: 30},
        },
        iconSet: 'flat',
    },
    labels: {
        show: true,
        renderer: 'overlay',
        color: '#262b38',
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        fontSize: 14,
        fontWeight: '600',
        offsetY: 18,
        haloColor: 'rgba(255, 255, 255, 0.9)',
        haloWidth: 3,
    },
}
