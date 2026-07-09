/**
 * Ink Wash Shader 插件
 *
 * 淡墨浓淡渐变：近岸一圈淡墨晕开，向内陆渐隐。
 * 实现"墨分五色"——通过多层叠加表现墨色的浓淡层次。
 *
 * 核心特性：
 * 1. 近岸淡墨晕开（只在陆地侧）
 * 2. 三层浓淡叠加（墨分五色）
 * 3. 向内陆平滑过渡到留白
 */

import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import type {
    PixiPluginImplementation,
    PluginRenderer,
    ShaderRenderContext,
} from '../types'
import type { MapStyleParameterRecord } from '../../common'
import { getNumberParam, getStringParam } from '../utils'
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
 * Ink Wash Fragment Shader
 *
 * 淡墨渐变：多层叠加实现墨色浓淡
 */
const inkWashFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

// 淡墨参数
uniform float u_washWidth;          // 淡墨带宽度（像素）
uniform vec3 u_lightInk;            // 淡墨颜色
uniform float u_washOpacity;        // 整体透明度
uniform int u_layers;               // 层数（2-4）

varying vec2 vTextureCoord;

void main() {
    float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
    float isLand = texture2D(u_landMask, vTextureCoord).r;

    // 只在陆地侧处理
    if (isLand < 0.5) {
        discard;
    }

    // 超出淡墨带宽，跳过
    if (distToCoast > u_washWidth) {
        discard;
    }

    // 多层浓淡叠加（墨分五色）
    float totalAlpha = 0.0;

    // 第一层：最浓，近岸 30% 范围
    if (u_layers >= 1) {
        float layer1Range = u_washWidth * 0.3;
        float layer1Fade = smoothstep(layer1Range, 0.0, distToCoast);
        totalAlpha += layer1Fade * 0.4;
    }

    // 第二层：中浓，近岸 60% 范围
    if (u_layers >= 2) {
        float layer2Range = u_washWidth * 0.6;
        float layer2Fade = smoothstep(layer2Range, 0.0, distToCoast);
        totalAlpha += layer2Fade * 0.3;
    }

    // 第三层：最淡，整个淡墨带
    if (u_layers >= 3) {
        float layer3Fade = smoothstep(u_washWidth, 0.0, distToCoast);
        totalAlpha += layer3Fade * 0.2;
    }

    // 第四层：极淡外晕（可选）
    if (u_layers >= 4) {
        float layer4Range = u_washWidth * 1.2;
        if (distToCoast < layer4Range) {
            float layer4Fade = smoothstep(layer4Range, 0.0, distToCoast);
            totalAlpha += layer4Fade * 0.1;
        }
    }

    // 应用整体透明度
    totalAlpha *= u_washOpacity;

    if (totalAlpha < 0.01) {
        discard;
    }

    gl_FragColor = vec4(u_lightInk, totalAlpha);
}
`

/**
 * 创建 Ink Wash Shader 渲染器
 */
function createInkWashShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const washWidth = Math.max(10, Math.min(100, getNumberParam(params.washWidth, 35)))
    const washOpacity = Math.max(0, Math.min(1, getNumberParam(params.washOpacity, 0.12)))
    const layers = Math.max(2, Math.min(4, Math.round(getNumberParam(params.layers, 3))))
    const lightInk = parseColorToVec3(
        getStringParam(params.lightInk, '#666666'),
        [102 / 255, 102 / 255, 102 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: inkWashFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_washWidth: { value: washWidth, type: 'f32' },
                u_lightInk: { value: lightInk, type: 'vec3<f32>' },
                u_washOpacity: { value: washOpacity, type: 'f32' },
                u_layers: { value: layers, type: 'i32' },
            }),
        },
    })

    return {
        type: 'shader',
        filter,
        update: (context: ShaderRenderContext) => {
            const uniforms = filter.resources.uniforms.uniforms
            uniforms.u_resolution = [context.scene.canvas.width, context.scene.canvas.height]
            uniforms.u_distanceField = context.distanceField
            uniforms.u_landMask = context.landMask
        },
    }
}

/**
 * Canvas 2D 版本的 ink-wash（保留作为 fallback）
 */
function createInkWashCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现
            console.log('[InkWashPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Ink Wash 插件实现
 */
export const inkWashPlugin: PixiPluginImplementation = {
    id: 'ink-wash',
    pluginType: 'decoration',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createInkWashShaderRenderer(params)
        } else {
            return createInkWashCanvasRenderer(params)
        }
    },
}
