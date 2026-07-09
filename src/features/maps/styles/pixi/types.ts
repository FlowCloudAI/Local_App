import type {MapKeyLocationRenderMode, MapPixiPreviewProps} from '../../components/MapShapeEditor'
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
export type PixiDecorationPluginId = 'coastline-outline' | 'compass' | 'land-depth' | 'sea' | 'brush-stroke' | 'ink-wash'
export type PixiEffectPluginId =
    | 'paper-grain'
    | 'vignette'
    | 'edge-darken'
    | 'ink-bleed'
    | 'chromatic-ageing'

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
    // 新增：指定实现方式（自动选择、强制 shader、强制 canvas）
    implementation?: 'auto' | 'shader' | 'canvas'
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
    // 新增：是否启用 shader 优化（默认 true）
    useShaderOptimization?: boolean
}

export interface CompiledPixiMapStyle extends MapStyleCompiledBase {
    renderer: 'pixi'
    pixiProps: Partial<MapPixiPreviewProps>
}

// ============ Shader 插件系统类型定义 ============

export interface ShaderRenderContext {
    scene: {
        shapes: Array<{ polygon: [number, number][] }>
        canvas: { width: number; height: number }
    }
    // 预计算的纹理资源
    distanceField?: unknown  // Pixi Texture，避免循环依赖先用 unknown
    landMask?: unknown
}

export interface ShaderRenderer {
    type: 'shader'
    // 创建 Pixi Filter 或自定义 Mesh
    filter: unknown  // Pixi Filter
    // 更新 shader uniform（场景数据、参数变化时调用）
    update?: (context: ShaderRenderContext) => void
}

export interface CanvasRenderer {
    type: 'canvas'
    // Canvas 2D 渲染函数
    render: (ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => void
}

export type PluginRenderer = ShaderRenderer | CanvasRenderer

export interface PixiPluginImplementation {
    id: PixiDecorationPluginId | PixiEffectPluginId
    pluginType: 'decoration' | 'effect'
    defaultImplementation: 'canvas' | 'shader'
    // 创建渲染器的工厂函数
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader') => PluginRenderer | null
}
