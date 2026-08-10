import type {PixiMapStyle} from '../types'

export const tolkienPixiMapStyle: PixiMapStyle = {
    version: 1,
    id: 'tolkien',
    name: 'Pixi 托尔金',
    description: '独立 Pixi 托尔金预设：羊皮纸底、暖褐边界、地点塔标、多层海岸线与罗盘。',
    palette: {
        ocean: '#c9a86c',
        paper: '#ead2a2',
        land: '#ead8ac',
        coastline: '#5a3a1c',
        location: '#6a4325',
        label: '#5c3b22',
        accent: '#7a5018',
    },
    background: {
        kind: 'generated-texture',
        texture: 'parchment',
        color: '#c9a86c',
        opacity: 1,
        fit: 'fill',
    },
    regions: {
        fill: {
            // 陆地=羊皮纸本身：只上一层很淡的暖色调，让纸面的斑驳/纤维/颗粒透出来
            //（原来 0.72 几乎把纸纹盖死）。陆海区分靠海面蓝染 + 海岸线描边。
            color: '#e8d3a2',
            opacity: 0.22,
        },
        stroke: {
            color: '#6f4724',
            opacity: 0.9,
            width: 4,
        },
    },
    coastline: {
        enabled: true,
        layers: [
            {
                color: '#64411f',
                opacity: 0.22,
                width: 9,
                jitter: 1.8,
            },
            {
                color: '#825828',
                opacity: 0.48,
                width: 3.5,
                jitter: 0.9,
            },
        ],
    },
    locations: {
        renderMode: 'auto',
        marker: {
            radius: 7,
            color: '#6a4325',
            stroke: {
                color: '#f5e8c7',
                opacity: 1,
                width: 2,
            },
            iconSize: 32,
        },
        markerAssets: {
            marker: {iconSet: 'tolkien', asset: 'marker', color: '#6a4325', iconSize: 26},
            'major-city': {iconSet: 'tolkien', asset: 'major-city', color: '#5a3a1c', iconSize: 38},
            city: {iconSet: 'tolkien', asset: 'city', color: '#5a3a1c', iconSize: 34},
            town: {iconSet: 'tolkien', asset: 'town', color: '#6a4325', iconSize: 30},
            landmark: {iconSet: 'tolkien', asset: 'landmark', color: '#6a4325', iconSize: 30},
            event: {iconSet: 'tolkien', asset: 'event', color: '#8a3d2c', iconSize: 30},
            ruin: {iconSet: 'tolkien', asset: 'ruin', color: '#6a4325', iconSize: 30},
            harbor: {iconSet: 'tolkien', asset: 'harbor', color: '#385d67', iconSize: 32},
        },
        iconSet: 'tolkien',
    },
    labels: {
        show: true,
        renderer: 'overlay',
        color: '#5c3b22',
        fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
        fontSize: 14,
        fontWeight: '600',
        offsetY: 18,
        haloColor: 'rgba(247, 231, 188, 0.82)',
        haloWidth: 4,
        rules: [
            {
                markerClasses: ['major-city', 'city', 'harbor'],
                fontWeight: '700',
                color: '#4f321b',
            },
        ],
    },
    decorations: [
        {
            id: 'terrain',
            params: {
                organicStrength: 0.68,
                terrainKinds: {
                    grass: {
                        color: '#788551',
                        detailColor: '#5f5a34',
                        baseOpacity: 0.16,
                        pattern: 'tolkien-grass',
                        patternOpacity: 0.38,
                        patternScale: 25,
                    },
                    mountain: {
                        color: '#756454',
                        detailColor: '#5a4633',
                        baseOpacity: 0.11,
                        pattern: 'none',
                        patternOpacity: 0,
                        patternScale: 28,
                    },
                    desert: {
                        color: '#b98745',
                        detailColor: '#76502c',
                        baseOpacity: 0.18,
                        pattern: 'tolkien-desert',
                        patternOpacity: 0.34,
                        patternScale: 20,
                    },
                },
                symbols: {
                    mountain: {
                        asset: 'tolkien-mountain',
                        color: '#5a3a1c',
                        size: 48,
                        spacing: 50,
                        opacity: 0.9,
                        jitter: 0.42,
                        variants: 3,
                    },
                },
            },
        },
        {
            id: 'coastline-outline',
            params: {
                brush: 'tolkien-coastline',
                roughness: 1.2,
                // 棕色海岸线晕线（等距轮廓，作为海洋逐层加深的分界线）。
                // 下方 sea 的 depthBands/depthGap 与此处 hatchRings/hatchGap 对齐，
                // 蓝色便以这些晕线为界一层层加深，且加深宽度=晕线宽度(hatchRings×hatchGap)。
                hatchRings: 4,
                hatchGap: 7,
                hatchWidth: 0.9,
                hatchColor: '#6a4a26',
                hatchOpacity: 0.5,
            },
        },
        {
            id: 'compass',
            params: {
                asset: 'tolkien-compass',
                size: 58,
                margin: 72,
                color: '#5a3a1c',
            },
        },
        {
            // 陆地纵深：近岸内阴影，opacity>0 启用；width 控制阴影带宽度。
            id: 'land-depth',
            params: {
                width: 26,
                color: '#5a3a1c',
                opacity: 0.16,
            },
        },
        {
            // 海洋：离岸越远越深，且以海岸线晕线为界一层层加深（depthBands/depthGap
            // 与 coastline-outline 的 hatchRings/hatchGap 对齐 → 台阶落在晕线上、加深宽度=晕线宽度）。
            // depthOpacity=深海蓝上限；depthShallowFade=近岸减淡强度。
            id: 'sea',
            params: {
                depthBands: 4,
                depthGap: 7,
                depthColor: '#345d7a',
                depthOpacity: 0.5,
                depthShallowFade: 0.9,
            },
        },
    ],
    effects: [
        {
            id: 'chromatic-ageing',
            params: {
                color: 'rgba(136, 84, 28, 1)',
                opacity: 0.07,
            },
        },
        {
            id: 'edge-darken',
            params: {
                color: 'rgba(77, 43, 14, 1)',
                width: 20,
                opacity: 0.11,
            },
        },
        {
            id: 'paper-grain',
            params: {
                density: 1600,
                opacity: 0.08,
                darkColor: 'rgba(96, 60, 20, 1)',
                lightColor: 'rgba(255, 246, 212, 1)',
            },
        },
        {
            id: 'vignette',
            params: {
                color: 'rgba(72, 42, 14, 1)',
                inner: 0.36,
                opacity: 0.16,
            },
        },
    ],
}
