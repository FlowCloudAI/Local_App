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
export type PixiLocationIconSet = 'tolkien' | 'ink-stamp'
export type PixiLocationIconAsset =
    | 'tolkien-castle'
    | 'tolkien-tower'
    | 'tolkien-settlement'
    | 'tolkien-ruin'
    | 'ink-dot'
    | 'ink-seal'
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

export interface PixiLocationIconRule {
    typePattern?: string
    typeIncludes?: string[]
    iconSet: PixiLocationIconSet
    asset?: PixiLocationIconAsset
    color?: string
    iconSize?: number
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
    iconRules?: PixiLocationIconRule[]
    iconSet?: PixiLocationIconSet
}

export interface PixiLabelRule {
    typePattern?: string
    typeIncludes?: string[]
    namePattern?: string
    nameIncludes?: string[]
    color?: string
    opacity?: number
    fontFamily?: string
    fontSize?: number
    fontWeight?: string
    offsetY?: number
    haloColor?: string
    haloWidth?: number
}

export interface PixiLabelStyle {
    show: boolean
    renderer?: 'builtin' | 'overlay'
    color: string
    fontFamily: string
    fontSize: number
    fontWeight?: string
    offsetY?: number
    haloColor?: string
    haloWidth?: number
    rules?: PixiLabelRule[]
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
