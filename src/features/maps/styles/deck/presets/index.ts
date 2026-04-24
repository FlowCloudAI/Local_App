import {flatStyle} from './flat'
import {inkStyle} from './ink'
import {tolkienStyle} from './tolkien'
import type {MapStyle, MapStyleDefinition} from './types'

const registry: Record<MapStyle, MapStyleDefinition> = {
    flat: flatStyle,
    tolkien: tolkienStyle,
    ink: inkStyle,
}

/**
 * 根据风格 ID 获取完整风格定义。若 ID 不存在则回退到扁平风格。
 */
export function getStyleDefinition(id: MapStyle): MapStyleDefinition {
    return registry[id] ?? registry.flat
}

export {makeOceanSvgUrl} from './utils'
export type {
    MapStyle,
    MapStyleDefinition,
    MapStyleDeckConfig,
    MapStyleDecorations,
    MapStyleDecorationContext,
    MapStyleLayerBuildContext,
    DecoPath,
    DecoSymbol,
    DecoLayout,
} from './types'
