import type {Layer} from '@deck.gl/core'
import type {
    MapDeckPreviewTooltip,
    MapDeckShaderInject,
    MapPreviewKeyLocation,
    MapPreviewKeyLocationIcon,
    MapPreviewScene,
    MapPreviewShape,
} from 'flowcloudai-ui'

/** 支持的地图风格 */
export type MapStyle = 'flat' | 'tolkien' | 'ink'

// ── 装饰元素数据类型（纯数据，不依赖 deck.gl）────────────────────────────────

export interface DecoPath {
    path: [number, number][]
    color: [number, number, number, number]
    widthPixels: number
    dashArray?: [number, number]
}

export interface DecoSymbol {
    position: [number, number]
    type: 'mountain' | 'forest' | 'hill'
    color?: [number, number, number, number]
    size?: number
    rotation?: number
}

export interface DecoLayout {
    kind: 'compass' | 'border'
    position: [number, number]
    size: number
    rotation?: number
}

/** 风格生成的完整装饰数据包 */
export interface MapStyleDecorations {
    coastOutlines?: DecoPath[]
    landSymbols?: DecoSymbol[]
    layouts?: DecoLayout[]
}

// ── 上下文类型 ────────────────────────────────────────────────────────────────

export interface MapStyleDecorationContext {
    canvas: { width: number; height: number }
    scene: MapPreviewScene
}

export interface MapStyleLayerBuildContext extends MapStyleDecorationContext {
    decorations: MapStyleDecorations
}

// ── 现有配置类型 ──────────────────────────────────────────────────────────────

export interface MapStyleDeckConfig {
    polygonShaderInject?: MapDeckShaderInject
    polygonLayerProps?: Record<string, unknown>
    scatterplotLayerProps?: Record<string, unknown>
    iconLayerProps?: Record<string, unknown>
    textLayerProps?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckEffects?: any[]
}

// ── 风格定义 ──────────────────────────────────────────────────────────────────

export interface MapStyleDefinition {
    id: MapStyle
    label: string
    fontFamily: string
    oceanColor: string
    deckConfig: MapStyleDeckConfig

    createBackgroundTexture?: (canvas: { width: number; height: number }) => string | null
    buildLocationIcon?: (type: string, colorHex: string) => MapPreviewKeyLocationIcon | null
    buildShapeTooltip?: (shape: MapPreviewShape) => MapDeckPreviewTooltip
    buildLocationTooltip?: (location: MapPreviewKeyLocation) => MapDeckPreviewTooltip
    transformScene?: (scene: MapPreviewScene) => MapPreviewScene

    /** 根据 scene 生成装饰数据（纯数据，不创建 Layer） */
    buildDecorations?: (ctx: MapStyleDecorationContext) => MapStyleDecorations

    /** 根据装饰数据创建额外 deck.gl 图层，拼入 extraLayers */
    createExtraLayers?: (ctx: MapStyleLayerBuildContext) => Layer[]
}
