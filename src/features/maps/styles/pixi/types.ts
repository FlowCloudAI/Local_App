import type {MapKeyLocationRenderMode, MapMarkerClass, MapPixiPreviewProps} from '../../components/MapShapeEditor'
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
export type PixiLocationIconSet = 'flat' | 'tolkien' | 'ink-stamp'
export type PixiLocationIconAsset = MapMarkerClass
export type PixiDecorationPluginId = 'coastline-outline' | 'compass' | 'land-depth' | 'sea' | 'terrain' | 'brush-stroke' | 'ink-wash'
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
    markerClasses: MapMarkerClass[]
    color: string
    opacity?: number
}

export interface PixiLocationIconRule {
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
    markerAssets?: Record<MapMarkerClass, PixiLocationIconRule>
    iconSet?: PixiLocationIconSet
}

export interface PixiLabelRule {
    markerClasses?: MapMarkerClass[]
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

// ============ Shader 插件系统类型定义 ============

export interface ShaderRenderContext {
    scene: {
        canvas: { width: number; height: number }
    }
    /**
     * 海岸场纹理（Pixi Texture，避免循环依赖用 unknown）：
     * RG16F，R=有符号海岸距离（场景像素，>0 海侧 <0 陆侧），G=保留。
     */
    coastField?: unknown
    /** RGBA8 地形场纹理：R=类型索引、G=覆盖度，B/A 保留。 */
    terrainField?: unknown
}

export interface ShaderRenderer {
    type: 'shader'
    /** Pixi Shader；由 overlays 挂到场景坐标系的 Mesh 四边形上渲染 */
    shader: unknown
    /** 场景数据/画布尺寸变化时同步 uniform 与海岸场纹理 */
    update?: (context: ShaderRenderContext) => void
    /** 释放 shader 资源（GlProgram 走 Pixi 全局缓存，不随之销毁） */
    destroy?: () => void
}

export interface PixiPluginImplementation {
    id: PixiDecorationPluginId | PixiEffectPluginId
    pluginType: 'decoration' | 'effect'
    /**
     * 创建 shader 渲染器；返回 null 表示按当前参数无需渲染
     * （如透明度为 0），或该插件没有 shader 实现（只存在于 Canvas 叠加位图）。
     */
    createShaderRenderer: (params: MapStyleParameterRecord) => ShaderRenderer | null
}
