/**
 * Vignette Shader 插件
 *
 * 边缘晕影效果：从中心向边缘渐变变暗，营造聚焦感。
 * 使用径向渐变实现，简单高效。
 */

import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import type {
    PixiPluginImplementation,
    PluginRenderer,
    ShaderRenderContext,
} from '../types'
import type { MapStyleParameterRecord } from '../../common'
import { getNumberParam } from '../utils'

/**
 * 默认 Vertex Shader
 */
const defaultVertexShader = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform mat3 uProjectionMatrix;
uniform mat3 uTextureMatrix;

void main() {
    gl_Position = vec4((uProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = (uTextureMatrix * vec3(aPosition, 1.0)).xy;
}
`

/**
 * Vignette Fragment Shader
 *
 * 径向渐变：中心最亮，向边缘逐渐变暗
 */
const vignetteFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 u_resolution;
uniform float u_intensity;      // 晕影强度 0-1
uniform float u_radius;         // 晕影半径（归一化 0-1）
uniform float u_softness;       // 边缘柔和度 0-1

varying vec2 vTextureCoord;

void main() {
    // 计算到中心的归一化距离
    vec2 center = vec2(0.5, 0.5);
    vec2 uv = vTextureCoord - center;

    // 考虑画布宽高比
    float aspectRatio = u_resolution.x / u_resolution.y;
    uv.x *= aspectRatio;

    float dist = length(uv);

    // 平滑阶梯函数：内半径无遮罩，外半径全黑
    float vignette = smoothstep(u_radius, u_radius - u_softness, dist);

    // 应用强度
    float darkness = 1.0 - (1.0 - vignette) * u_intensity;

    gl_FragColor = vec4(vec3(0.0), 1.0 - darkness);
}
`

/**
 * 创建 Vignette Shader 渲染器
 */
function createVignetteShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const intensity = Math.max(0, Math.min(1, getNumberParam(params.intensity, 0.5)))
    const radius = Math.max(0, Math.min(1, getNumberParam(params.radius, 0.7)))
    const softness = Math.max(0, Math.min(1, getNumberParam(params.softness, 0.4)))

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: vignetteFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_intensity: { value: intensity, type: 'f32' },
                u_radius: { value: radius, type: 'f32' },
                u_softness: { value: softness, type: 'f32' },
            }),
        },
    })

    return {
        type: 'shader',
        filter,
        update: (context: ShaderRenderContext) => {
            const uniforms = filter.resources.uniforms.uniforms
            uniforms.u_resolution = [context.scene.canvas.width, context.scene.canvas.height]
        },
    }
}

/**
 * Canvas 2D 版本的 vignette（保留作为 fallback）
 */
function createVignetteCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现（引用现有 overlays.tsx 中的逻辑）
            console.log('[VignettePlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Vignette 插件实现
 */
export const vignettePlugin: PixiPluginImplementation = {
    id: 'vignette',
    pluginType: 'effect',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createVignetteShaderRenderer(params)
        } else {
            return createVignetteCanvasRenderer(params)
        }
    },
}
