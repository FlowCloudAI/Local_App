import type {MapKeyLocationRenderMode, MapPixiPreviewProps} from 'flowcloudai-ui'
import type {
    MapStyleBackgroundImageToken,
    MapStyleCompiledBase,
    MapStylePaintToken,
    MapStyleParameterRecord,
    MapStyleStrokeToken,
} from '../common'

export interface PixiMapStylePalette {
    ocean: string
    paper: string
    land: string
    coastline: string
    location: string
    label: string
    accent: string
}

export type PixiGeneratedBackgroundTexture = 'parchment' | 'rice-paper'
export type PixiLocationIconSet = 'tolkien'
export type PixiDecorationPluginId = 'coastline-outline' | 'compass'
export type PixiEffectPluginId = 'ink-bleed'

export interface PixiBackgroundStyle extends MapStyleBackgroundImageToken {
    texture?: PixiGeneratedBackgroundTexture
}

export interface PixiRegionStyle {
    fill: MapStylePaintToken
    stroke: MapStyleStrokeToken
    edgeRoughness?: number
    selected?: MapStylePaintToken
    hover?: MapStylePaintToken
}

export interface PixiCoastlineLayerStyle extends MapStyleStrokeToken {
    jitter?: number
}

export interface PixiCoastlineStyle {
    enabled: boolean
    layers: PixiCoastlineLayerStyle[]
    smoothing?: number
}

export interface PixiLocationColorRule {
    typePattern?: string
    typeIncludes?: string[]
    color: string
    opacity?: number
}

export interface PixiLocationStyle {
    renderMode: MapKeyLocationRenderMode
    marker: {
        radius: number
        color: string
        stroke?: MapStyleStrokeToken
        iconSize?: number
    }
    colorRules?: PixiLocationColorRule[]
    iconSet?: PixiLocationIconSet
}

export interface PixiLabelStyle {
    show: boolean
    color: string
    fontFamily: string
    fontSize: number
    fontWeight?: string
}

export interface PixiStylePluginConfig {
    id: PixiDecorationPluginId | PixiEffectPluginId
    params?: MapStyleParameterRecord
}

export interface PixiMapStyle {
    version: 1
    id: string
    name: string
    description?: string
    palette: PixiMapStylePalette
    background: PixiBackgroundStyle
    regions: PixiRegionStyle
    coastline?: PixiCoastlineStyle
    locations: PixiLocationStyle
    labels: PixiLabelStyle
    decorations?: PixiStylePluginConfig[]
    effects?: PixiStylePluginConfig[]
}

export interface CompiledPixiMapStyle extends MapStyleCompiledBase {
    renderer: 'pixi'
    pixiProps: Partial<MapPixiPreviewProps>
}
