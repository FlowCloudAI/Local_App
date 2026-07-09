import type {
    PixiDecorationPluginId,
    PixiEffectPluginId,
    PixiPluginImplementation,
} from './types'

/**
 * Shader 插件注册表
 *
 * 每个插件可以有 Canvas 和 Shader 两种实现方式。
 * 内置风格可以优先使用 Shader 实现以获得更好的性能。
 */
class ShaderPluginRegistry {
    private plugins = new Map<string, PixiPluginImplementation>()

    register(plugin: PixiPluginImplementation): void {
        this.plugins.set(plugin.id, plugin)
    }

    get(id: PixiDecorationPluginId | PixiEffectPluginId): PixiPluginImplementation | undefined {
        return this.plugins.get(id)
    }

    has(id: string): boolean {
        return this.plugins.has(id)
    }

    getAll(): PixiPluginImplementation[] {
        return Array.from(this.plugins.values())
    }

    clear(): void {
        this.plugins.clear()
    }
}

export const shaderRegistry = new ShaderPluginRegistry()

/**
 * 检测 WebGL 支持
 */
export function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2')
        return gl !== null
    } catch {
        return false
    }
}

/**
 * 工具函数：将十六进制颜色转换为 vec3 (0-1 范围)
 */
export function hexToVec3(hex: string): [number, number, number] {
    const cleaned = hex.replace('#', '')
    const r = parseInt(cleaned.substring(0, 2), 16) / 255
    const g = parseInt(cleaned.substring(2, 4), 16) / 255
    const b = parseInt(cleaned.substring(4, 6), 16) / 255
    return [r, g, b]
}

/**
 * 工具函数：将 RGBA 颜色数组转换为 vec4 (0-1 范围)
 */
export function rgbaToVec4(rgba: [number, number, number, number]): [number, number, number, number] {
    return [
        rgba[0] / 255,
        rgba[1] / 255,
        rgba[2] / 255,
        rgba[3] / 255,
    ]
}

/**
 * 工具函数：解析颜色字符串为 vec3
 */
export function parseColorToVec3(color: string, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
    if (!color || typeof color !== 'string') return fallback

    // rgba() 格式
    if (color.startsWith('rgba(')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (match) {
            return [
                parseInt(match[1]) / 255,
                parseInt(match[2]) / 255,
                parseInt(match[3]) / 255,
            ]
        }
    }

    // 十六进制格式
    if (color.startsWith('#')) {
        return hexToVec3(color)
    }

    return fallback
}
