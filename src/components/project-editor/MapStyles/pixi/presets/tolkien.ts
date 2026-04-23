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
            color: '#ead8ac',
            opacity: 0.72,
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
        iconRules: [
            {
                typePattern: '城|都|王都|京|要塞|港',
                iconSet: 'tolkien',
                asset: 'tolkien-castle',
                color: '#5a3a1c',
                iconSize: 36,
            },
            {
                typePattern: '村|镇|营地',
                iconSet: 'tolkien',
                asset: 'tolkien-settlement',
                color: '#6a4325',
                iconSize: 30,
            },
            {
                typePattern: '遗迹|神殿',
                iconSet: 'tolkien',
                asset: 'tolkien-ruin',
                color: '#6a4325',
                iconSize: 30,
            },
        ],
        iconSet: 'tolkien',
    },
    labels: {
        show: true,
        renderer: 'overlay',
        color: '#5c3b22',
        fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
        fontSize: 15,
        fontWeight: '600',
        offsetY: 34,
        haloColor: 'rgba(247, 231, 188, 0.82)',
        haloWidth: 4,
        rules: [
            {
                typePattern: '城|都|王都|京|要塞|港',
                fontSize: 17,
                fontWeight: '700',
                offsetY: 42,
                color: '#4f321b',
            },
        ],
    },
    decorations: [
        {
            id: 'coastline-outline',
            params: {
                brush: 'tolkien-coastline',
                roughness: 1.2,
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
    ],
}
