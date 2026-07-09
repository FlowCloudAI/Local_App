/**
 * Edge Darken Shader 插件
 *
 * 边缘加深效果：画布四周边缘变暗，增强老旧感和边框感。
 * 类似 vignette 但更强调矩形边缘。
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
 * Edge Darken Fragment Shader
 *
 * 矩形边缘渐变：四周向内渐变变暗
 */
const edgeDarkenFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 u_resolution;
uniform float u_width;          // 边缘宽度（像素）
uniform float u_intensity;      // 加深强度 0-1

varying vec2 vTextureCoord;

void main() {
    vec2 pos = vTextureCoord * u_resolution;

    // 计算到最近边缘的距离
    float distLeft = pos.x;
    float distRight = u_resolution.x - pos.x;
    float distTop = pos.y;
    float distBottom = u_resolution.y - pos.y;

    float minDist = min(min(distLeft, distRight), min(distTop, distBottom));

    // 边缘渐变：距离边缘越近越暗
    float edgeFade = smoothstep(0.0, u_width, minDist);

    // 应用强度
    float darkness = 1.0 - (1.0 - edgeFade) * u_intensity;

    gl_FragColor = vec4(vec3(0.0), 1.0 - darkness);
}
`

/**
 * 创建 Edge Darken Shader 渲染器
 */
function createEdgeDarkenShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const width = Math.max(5, getNumberParam(params.width, 40))
    const intensity = Math.max(0, Math.min(1, getNumberParam(params.intensity, 0.25)))

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: edgeDarkenFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_width: { value: width, type: 'f32' },
                u_intensity: { value: intensity, type: 'f32' },
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
 * Canvas 2D 版本的 edge-darken（保留作为 fallback）
 */
function createEdgeDarkenCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现
            console.log('[EdgeDarkenPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Edge Darken 插件实现
 */
export const edgeDarkenPlugin: PixiPluginImplementation = {
    id: 'edge-darken',
    pluginType: 'effect',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createEdgeDarkenShaderRenderer(params)
        } else {
            return createEdgeDarkenCanvasRenderer(params)
        }
    },
}
