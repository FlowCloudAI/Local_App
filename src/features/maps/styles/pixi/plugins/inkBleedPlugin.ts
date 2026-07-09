/**
 * Ink Bleed Shader 插件
 *
 * 墨水晕染效果：模拟墨水在纸张上扩散的效果（水墨风格）。
 * 使用简化的高斯模糊近似 + 混合模式实现。
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
 * Ink Bleed Fragment Shader
 *
 * 简化的径向模糊 + 暗化混合
 */
const inkBleedFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 u_resolution;
uniform float u_bleedRadius;    // 晕染半径（像素）
uniform float u_intensity;      // 效果强度 0-1
uniform int u_samples;          // 采样数（4-12）

varying vec2 vTextureCoord;

// 简单哈希函数（伪随机数生成）
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec4 centerColor = texture2D(uTexture, vTextureCoord);

    // 跳过透明像素
    if (centerColor.a < 0.01) {
        discard;
    }

    // 简化的径向采样（模拟高斯模糊）
    vec3 bleedColor = centerColor.rgb;
    float totalWeight = 1.0;

    float angleStep = 6.28318 / float(u_samples);
    float radius = u_bleedRadius / u_resolution.x;

    for (int i = 0; i < 12; i++) {
        if (i >= u_samples) break;

        float angle = float(i) * angleStep;
        vec2 offset = vec2(cos(angle), sin(angle)) * radius;

        // 随机化半径（更自然的晕染）
        float randomRadius = hash(vTextureCoord + offset) * 0.5 + 0.5;
        vec2 sampleCoord = vTextureCoord + offset * randomRadius;

        vec4 sampleColor = texture2D(uTexture, sampleCoord);
        float weight = sampleColor.a * (1.0 - randomRadius);

        bleedColor += sampleColor.rgb * weight;
        totalWeight += weight;
    }

    bleedColor /= totalWeight;

    // 暗化混合（墨水扩散会变暗）
    vec3 finalColor = mix(centerColor.rgb, bleedColor * 0.85, u_intensity);

    gl_FragColor = vec4(finalColor, centerColor.a);
}
`

/**
 * 创建 Ink Bleed Shader 渲染器
 */
function createInkBleedShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const bleedRadius = Math.max(1, getNumberParam(params.bleedRadius, 3))
    const intensity = Math.max(0, Math.min(1, getNumberParam(params.intensity, 0.25)))
    const samples = Math.max(4, Math.min(12, Math.round(getNumberParam(params.samples, 8))))

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: inkBleedFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_bleedRadius: { value: bleedRadius, type: 'f32' },
                u_intensity: { value: intensity, type: 'f32' },
                u_samples: { value: samples, type: 'i32' },
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
 * Canvas 2D 版本的 ink-bleed（保留作为 fallback）
 */
function createInkBleedCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现
            console.log('[InkBleedPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Ink Bleed 插件实现
 */
export const inkBleedPlugin: PixiPluginImplementation = {
    id: 'ink-bleed',
    pluginType: 'effect',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createInkBleedShaderRenderer(params)
        } else {
            return createInkBleedCanvasRenderer(params)
        }
    },
}
