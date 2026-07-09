/**
 * Brush Stroke Shader 插件
 *
 * 毛笔笔触效果：有提按顿挫和飞白的毛笔边界。
 * 这是水墨风格的"命门"——实现变宽、收出锋、带飞白的墨笔。
 *
 * 核心特性：
 * 1. 提按顿挫：转折处笔宽变化（根据边缘曲率）
 * 2. 飞白效果：随机断口（枯笔）
 * 3. 墨色浓淡：边缘浓、外围淡墨晕
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
 * Brush Stroke Fragment Shader
 *
 * 模拟毛笔笔触：提按、飞白、墨韵
 */
const brushStrokeFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

// 毛笔参数
uniform float u_baseWidth;          // 基础笔宽（像素）
uniform float u_widthVariation;     // 宽度变化 0-1
uniform float u_dryBrushThreshold;  // 飞白阈值 0-1
uniform vec3 u_inkColor;            // 墨色
uniform float u_inkOpacity;         // 墨色不透明度

varying vec2 vTextureCoord;

// 简单哈希函数（伪随机数生成）
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// 计算边缘梯度的变化（用于识别转折）
float getEdgeCurvature(vec2 uv, sampler2D distField, vec2 resolution) {
    float center = texture2D(distField, uv).r;

    // 采样周围 4 个点
    float dx = 1.0 / resolution.x;
    float dy = 1.0 / resolution.y;

    float right = texture2D(distField, uv + vec2(dx, 0.0)).r;
    float left = texture2D(distField, uv - vec2(dx, 0.0)).r;
    float top = texture2D(distField, uv + vec2(0.0, dy)).r;
    float bottom = texture2D(distField, uv - vec2(0.0, dy)).r;

    // 二阶导数（曲率近似）
    float curvatureX = abs((right - 2.0 * center + left) / (dx * dx));
    float curvatureY = abs((top - 2.0 * center + bottom) / (dy * dy));

    return (curvatureX + curvatureY) * 0.5;
}

void main() {
    float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
    float isLand = texture2D(u_landMask, vTextureCoord).r;

    // 只在边缘附近处理
    if (distToCoast > u_baseWidth * 3.0) {
        discard;
    }

    // 仅海洋侧绘制墨线
    if (isLand > 0.5) {
        discard;
    }

    vec2 pos = gl_FragCoord.xy;

    // 计算边缘曲率（转折处大）
    float curvature = getEdgeCurvature(vTextureCoord, u_distanceField, u_resolution);

    // 笔压（提按顿挫）：转折处笔压大（笔宽增加）
    float pressure = mix(0.7, 1.4, smoothstep(0.0, 0.3, curvature));

    // 沿边缘的噪声（飞白 + 笔触自然变化）
    float edgeNoise = hash(pos * 0.05);
    float detailNoise = hash(pos * 0.2);

    // 飞白效果：随机断口（枯笔）
    if (edgeNoise < u_dryBrushThreshold) {
        discard;  // 枯笔处不画
    }

    // 笔宽变化（提按 + 随机变化）
    float strokeWidth = u_baseWidth * pressure * (1.0 + (detailNoise - 0.5) * u_widthVariation);

    // 距离到笔触的衰减（平滑边缘）
    float distFade = smoothstep(strokeWidth, strokeWidth * 0.3, distToCoast);

    // 墨色浓淡：边缘浓、外围淡（墨韵）
    float inkDensity = mix(1.0, 0.3, distToCoast / strokeWidth);

    // 最终透明度
    float alpha = distFade * inkDensity * u_inkOpacity;

    if (alpha < 0.01) {
        discard;
    }

    gl_FragColor = vec4(u_inkColor, alpha);
}
`

/**
 * 创建 Brush Stroke Shader 渲染器
 */
function createBrushStrokeShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const baseWidth = Math.max(2, Math.min(8, getNumberParam(params.baseWidth, 3.5)))
    const widthVariation = Math.max(0, Math.min(1, getNumberParam(params.widthVariation, 0.4)))
    const dryBrushThreshold = Math.max(0, Math.min(1, getNumberParam(params.dryBrushThreshold, 0.15)))
    const inkOpacity = Math.max(0, Math.min(1, getNumberParam(params.inkOpacity, 0.85)))
    const inkColor = parseColorToVec3(
        getStringParam(params.inkColor, '#121212'),
        [18 / 255, 18 / 255, 18 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: brushStrokeFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_baseWidth: { value: baseWidth, type: 'f32' },
                u_widthVariation: { value: widthVariation, type: 'f32' },
                u_dryBrushThreshold: { value: dryBrushThreshold, type: 'f32' },
                u_inkColor: { value: inkColor, type: 'vec3<f32>' },
                u_inkOpacity: { value: inkOpacity, type: 'f32' },
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
 * Canvas 2D 版本的 brush-stroke（保留作为 fallback）
 */
function createBrushStrokeCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现（复杂，暂时占位）
            console.log('[BrushStrokePlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Brush Stroke 插件实现
 */
export const brushStrokePlugin: PixiPluginImplementation = {
    id: 'brush-stroke',
    pluginType: 'decoration',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createBrushStrokeShaderRenderer(params)
        } else {
            return createBrushStrokeCanvasRenderer(params)
        }
    },
}
