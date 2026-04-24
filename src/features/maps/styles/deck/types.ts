import type {MapDeckPreviewProps, MapKeyLocationRenderMode} from 'flowcloudai-ui'
import type {
    MapStyleBackgroundImageToken,
    MapStyleCompiledBase,
    MapStylePaintToken,
    MapStyleStrokeToken,
} from '../common'

export interface DeckPolygonStyle {
    fill: MapStylePaintToken
    stroke: MapStyleStrokeToken
}

export interface DeckLocationStyle {
    renderMode: MapKeyLocationRenderMode
    radius: number
    color: string
    stroke?: MapStyleStrokeToken
    showLabels: boolean
}

export interface DeckPerformanceStyle {
    mode: 'performance' | 'readable'
    maxLabels?: number
    simplifyGeometry?: boolean
}

export interface DeckMapStyle {
    version: 1
    id: string
    name: string
    description?: string
    background: MapStyleBackgroundImageToken
    polygon: DeckPolygonStyle
    locations: DeckLocationStyle
    labels: {
        color: string
        fontFamily: string
        fontSize: number
        fontWeight?: string
    }
    performance: DeckPerformanceStyle
}

export interface CompiledDeckMapStyle extends MapStyleCompiledBase {
    renderer: 'deck'
    deckProps: Partial<MapDeckPreviewProps>
}
