import type {CSSProperties} from 'react'
import type {
    MapDeckPreviewProps,
    MapEditorCanvas,
    MapKeyLocationRenderMode,
    MapPixiPreviewProps,
    MapPreviewKeyLocationStyle,
    MapPreviewLabelStyle,
    MapPreviewScene,
    MapPreviewShapeStyle,
    MapRgbaColor,
} from 'flowcloudai-ui'

export type MapStyleRenderer = 'pixi' | 'deck'
export type MapStyleRendererIntent = 'balanced' | 'performance' | 'stylized'
export type MapStyleParameterValue = string | number | boolean | null
export type MapStyleParameterRecord = Record<string, MapStyleParameterValue | MapStyleParameterValue[]>

export interface MapStylePalette {
    ocean: string
    land: string
    coastline: string
    regionFill: string
    regionStroke: string
    location: string
    label: string
    accent: string
}

export interface MapStylePaintToken {
    color: string
    opacity?: number
}

export interface MapStyleStrokeToken extends MapStylePaintToken {
    width: number
    dashArray?: [number, number]
}

export interface MapStyleBackground {
    kind: 'solid' | 'generated-texture' | 'image'
    color?: string
    texture?: 'parchment' | 'rice-paper' | 'grid' | 'noise'
    url?: string
    opacity?: number
    fit?: 'fill' | 'cover' | 'contain'
    params?: MapStyleParameterRecord
}

export interface MapStyleRegions {
    fill: MapStylePaintToken
    stroke: MapStyleStrokeToken
    hover?: MapStylePaintToken
    selected?: MapStylePaintToken
}

export interface MapStyleCoastline {
    enabled: boolean
    layers: MapStyleStrokeToken[]
    roughness?: number
    smoothing?: number
}

export interface MapStyleMarker {
    radius: number
    color: string
    stroke?: MapStyleStrokeToken
    iconSize?: number
}

export interface MapStyleLocations {
    renderMode: MapKeyLocationRenderMode
    marker: MapStyleMarker
    iconSet?: string
}

export interface MapStyleLabels {
    show: boolean
    color: string
    fontFamily: string
    fontSize: number
    fontWeight?: string
}

export interface MapStyleDecorationPlugin {
    id: string
    params?: MapStyleParameterRecord
}

export interface MapStyleDecorations {
    compass?: MapStyleDecorationPlugin
    border?: MapStyleDecorationPlugin
    symbols?: MapStyleDecorationPlugin[]
}

export interface MapStyleEffect {
    id: string
    target?: MapStyleRenderer | 'all'
    params?: MapStyleParameterRecord
}

export interface MapStylePixiExtensions {
    overlayPlugins?: MapStyleDecorationPlugin[]
    filterPlugins?: MapStyleDecorationPlugin[]
}

export interface MapStyleDeckFallback {
    mode: 'performance' | 'readable'
    showLabels?: boolean
    regionFillOpacity?: number
    regionStrokeWidth?: number
    locationRadius?: number
}

/** 可存储的语义化地图风格定义。不要在这里保存函数、React 节点或渲染器实例。 */
export interface MapVisualStyle {
    version: 1
    id: string
    name: string
    description?: string
    rendererIntent: MapStyleRendererIntent
    palette: MapStylePalette
    background: MapStyleBackground
    regions: MapStyleRegions
    coastline?: MapStyleCoastline
    locations: MapStyleLocations
    labels: MapStyleLabels
    decorations?: MapStyleDecorations
    effects?: MapStyleEffect[]
    pixi?: MapStylePixiExtensions
    deck?: MapStyleDeckFallback
}

export interface MapStyleCompileInput {
    style: MapVisualStyle
    renderer: MapStyleRenderer
    canvas: MapEditorCanvas
    scene: MapPreviewScene
}

/** 编译后的运行时配置，可以包含渲染器对象；不要直接持久化。 */
export interface CompiledMapVisualStyle {
    renderer: MapStyleRenderer
    scene: MapPreviewScene
    viewportStyle?: CSSProperties
    shapeStyle?: MapPreviewShapeStyle
    keyLocationStyle?: MapPreviewKeyLocationStyle
    labelStyle?: MapPreviewLabelStyle
    deckProps?: Partial<MapDeckPreviewProps>
    pixiProps?: Partial<MapPixiPreviewProps>
}

export type RgbaColorInput = string | MapRgbaColor
