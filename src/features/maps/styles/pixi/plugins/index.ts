/**
 * Shader 插件集合
 *
 * 导出所有已实现的插件，并在模块加载时自动注册到 shaderRegistry
 */

export * from './paperGrainPlugin'
export * from './seaPlugin'
export * from './coastlineOutlinePlugin'
export * from './landDepthPlugin'
export * from './vignettePlugin'
export * from './edgeDarkenPlugin'
export * from './chromaticAgeingPlugin'
export * from './inkBleedPlugin'
export * from './brushStrokePlugin'
export * from './inkWashPlugin'

// 自动注册所有插件
import { shaderRegistry } from '../shaderRegistry'
import { paperGrainPlugin } from './paperGrainPlugin'
import { seaPlugin } from './seaPlugin'
import { coastlineOutlinePlugin } from './coastlineOutlinePlugin'
import { landDepthPlugin } from './landDepthPlugin'
import { vignettePlugin } from './vignettePlugin'
import { edgeDarkenPlugin } from './edgeDarkenPlugin'
import { chromaticAgeingPlugin } from './chromaticAgeingPlugin'
import { inkBleedPlugin } from './inkBleedPlugin'
import { brushStrokePlugin } from './brushStrokePlugin'
import { inkWashPlugin } from './inkWashPlugin'

// 注册已实现的插件
shaderRegistry.register(paperGrainPlugin)
shaderRegistry.register(seaPlugin)
shaderRegistry.register(coastlineOutlinePlugin)
shaderRegistry.register(landDepthPlugin)
shaderRegistry.register(vignettePlugin)
shaderRegistry.register(edgeDarkenPlugin)
shaderRegistry.register(chromaticAgeingPlugin)
shaderRegistry.register(inkBleedPlugin)
shaderRegistry.register(brushStrokePlugin)
shaderRegistry.register(inkWashPlugin)

console.log('[ShaderPlugins] 已注册插件:', shaderRegistry.getAll().map(p => p.id).join(', '))
