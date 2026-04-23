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
            },
            {
                color: '#825828',
                opacity: 0.48,
                width: 3.5,
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
        iconSet: 'tolkien',
    },
    labels: {
        show: true,
        color: '#5c3b22',
        fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
        fontSize: 15,
        fontWeight: '600',
    },
    decorations: [
        {id: 'coastline-outline'},
        {id: 'compass'},
    ],
}
