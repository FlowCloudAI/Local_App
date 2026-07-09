/**
 * Chromatic Ageing Shader 插件
 *
 * 色度老化效果：复古色调偏移，模拟老旧纸张的泛黄和褪色。
 * 通过色调偏移和饱和度调整实现。
 */

import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import type {
    PixiPluginImplementation,
    PluginRenderer,
    ShaderRenderContext,
} from '../types'
import type { MapStyleParameterRecord } from '../../common'
import { getNumberParam } from '../utils'
import { parseColorToVec3 } from '../shaderRegistry'

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
 * Chromatic Ageing Fragment Shader
 *
 * 色调偏移：向暖色调（黄、棕）偏移，降低饱和度
 */
const chromaticAgeingFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform vec3 u_tint;            // 泛黄色调
uniform float u_intensity;      // 效果强度 0-1
uniform float u_desaturation;   // 降低饱和度 0-1

varying vec2 vTextureCoord;

// RGB 转 HSV
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV 转 RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec4 texColor = texture2D(uTexture, vTextureCoord);

    // 跳过透明像素
    if (texColor.a < 0.01) {
        discard;
    }

    vec3 color = texColor.rgb;

    // 转换到 HSV 空间
    vec3 hsv = rgb2hsv(color);

    // 降低饱和度（老化效果）
    hsv.y *= (1.0 - u_desaturation);

    // 转回 RGB
    color = hsv2rgb(hsv);

    // 叠加泛黄色调
    color = mix(color, color * u_tint, u_intensity);

    gl_FragColor = vec4(color, texColor.a);
}
`

/**
 * 创建 Chromatic Ageing Shader 渲染器
 */
function createChromaticAgeingShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const intensity = Math.max(0, Math.min(1, getNumberParam(params.intensity, 0.15)))
    const desaturation = Math.max(0, Math.min(1, getNumberParam(params.desaturation, 0.2)))
    const tint = parseColorToVec3(
        params.tint as string ?? '#f4e4c1',
        [244 / 255, 228 / 255, 193 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: chromaticAgeingFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_tint: { value: tint, type: 'vec3<f32>' },
                u_intensity: { value: intensity, type: 'f32' },
                u_desaturation: { value: desaturation, type: 'f32' },
            }),
        },
    })

    return {
        type: 'shader',
        filter,
        update: (_context: ShaderRenderContext) => {
            // 无需更新，参数固定
        },
    }
}

/**
 * Canvas 2D 版本的 chromatic-ageing（保留作为 fallback）
 */
function createChromaticAgeingCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现
            console.log('[ChromaticAgeingPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Chromatic Ageing 插件实现
 */
export const chromaticAgeingPlugin: PixiPluginImplementation = {
    id: 'chromatic-ageing',
    pluginType: 'effect',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createChromaticAgeingShaderRenderer(params)
        } else {
            return createChromaticAgeingCanvasRenderer(params)
        }
    },
}
