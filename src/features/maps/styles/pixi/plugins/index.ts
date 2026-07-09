/**
 * Shader 插件集合：模块加载时自动注册到 shaderRegistry。
 *
 * 注意：chromatic-ageing 不是 shader 插件——正片叠底必须与下方场景混合，
 * 由 overlays 的 PixiChromaticAgeingLayer（blendMode 图层）实现，两条渲染
 * 路径共用；compass 与海岸线本体描边是矢量线稿，走 linework Canvas 位图。
 */

export * from './shared'
export * from './paperGrainPlugin'
export * from './seaPlugin'
export * from './coastlineOutlinePlugin'
export * from './landDepthPlugin'
export * from './vignettePlugin'
export * from './edgeDarkenPlugin'
export * from './inkBleedPlugin'
export * from './brushStrokePlugin'
export * from './inkWashPlugin'

import {shaderRegistry} from '../shaderRegistry'
import {paperGrainPlugin} from './paperGrainPlugin'
import {seaPlugin} from './seaPlugin'
import {coastlineOutlinePlugin} from './coastlineOutlinePlugin'
import {landDepthPlugin} from './landDepthPlugin'
import {vignettePlugin} from './vignettePlugin'
import {edgeDarkenPlugin} from './edgeDarkenPlugin'
import {inkBleedPlugin} from './inkBleedPlugin'
import {brushStrokePlugin} from './brushStrokePlugin'
import {inkWashPlugin} from './inkWashPlugin'

shaderRegistry.register(seaPlugin)
shaderRegistry.register(coastlineOutlinePlugin)
shaderRegistry.register(landDepthPlugin)
shaderRegistry.register(inkWashPlugin)
shaderRegistry.register(brushStrokePlugin)
shaderRegistry.register(paperGrainPlugin)
shaderRegistry.register(vignettePlugin)
shaderRegistry.register(edgeDarkenPlugin)
shaderRegistry.register(inkBleedPlugin)
