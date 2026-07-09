/**
 * Sea Shader 插件
 *
 * 海洋效果：
 * 1. 海洋深浅渐变（基于距离场）
 * 2. 程序化海浪（噪声网格 + 正弦波）
 *
 * 这是性能瓶颈最大的效果，Canvas 版本需要 ~180ms，Shader 预期 ~2ms（90× 加速）
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
 * Sea Depth + Waves Combined Fragment Shader
 *
 * 将海洋深浅和海浪合并到一个 shader 中，减少 pass 次数
 */
const seaFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

// 深度参数
uniform float u_depthBands;      // 深度层级数
uniform float u_depthGap;        // 每层间隔（像素）
uniform vec3 u_depthColor;       // 深海颜色
uniform float u_depthOpacity;    // 深海不透明度
uniform float u_shallowFade;     // 近岸减淡强度 0-1

// 海浪参数
uniform float u_waveSpacing;     // 网格步长
uniform float u_waveAmplitude;   // 振幅
uniform float u_waveLength;      // 波长
uniform float u_waveWidth;       // 线宽
uniform vec3 u_waveColor;        // 波浪颜色
uniform float u_waveOpacity;     // 不透明度
uniform float u_waveMargin;      // 离岸留白
uniform float u_waveSegLength;   // 每段波浪长度
uniform float u_waveDensity;     // 密度 0-1

varying vec2 vTextureCoord;

// 简单哈希函数（伪随机数生成）
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 pos = vTextureCoord * u_resolution;
  float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
  float isLand = texture2D(u_landMask, vTextureCoord).r;

  // 只处理海洋像素
  if (isLand > 0.5) {
    discard;
  }

  vec3 finalColor = vec3(0.0);
  float finalAlpha = 0.0;

  // ========== 1. 海洋深浅渐变 ==========
  if (u_depthOpacity > 0.0) {
    float maxDepth = u_depthBands * u_depthGap;
    float depth = clamp(distToCoast / maxDepth, 0.0, 1.0);

    // 应用近岸减淡
    float depthFade = 1.0 - (1.0 - depth) * u_shallowFade;
    float depthAlpha = u_depthOpacity * depthFade;

    finalColor += u_depthColor * depthAlpha;
    finalAlpha += depthAlpha;
  }

  // ========== 2. 程序化海浪 ==========
  if (u_waveOpacity > 0.0 && distToCoast > u_waveMargin) {
    // 确定所在网格
    vec2 grid = floor(pos / u_waveSpacing);
    float seed = hash(grid);

    // 密度控制：跳过部分网格
    if (seed < u_waveDensity) {
      vec2 cellCenter = (grid + 0.5) * u_waveSpacing;

      // 随机偏移网格中心
      vec2 jitter = (vec2(hash(grid + vec2(11.1, 0.0)), hash(grid + vec2(0.0, 23.3))) - 0.5) * u_waveSpacing * 1.4;
      vec2 waveCenter = cellCenter + jitter;

      // 波浪参数随机化
      float phase = hash(grid + vec2(5.5, 0.0)) * 6.28318;
      float segLen = u_waveSegLength * (0.55 + hash(grid + vec2(7.7, 0.0)) * 0.9);
      float amp = u_waveAmplitude * (0.55 + hash(grid + vec2(9.9, 0.0)) * 0.9);

      // 计算到波浪的距离
      vec2 delta = pos - waveCenter;
      float halfLen = segLen * 0.5;

      if (abs(delta.x) < halfLen) {
        // 正弦波方程
        float waveY = sin((delta.x / u_waveLength) * 6.28318 + phase) * amp;
        float distToWave = abs(delta.y - waveY);

        if (distToWave < u_waveWidth) {
          // 抗锯齿边缘
          float edgeFade = smoothstep(u_waveWidth, u_waveWidth * 0.5, distToWave);
          float waveAlpha = u_waveOpacity * edgeFade;

          // 混合海浪颜色
          finalColor = mix(finalColor, u_waveColor, waveAlpha);
          finalAlpha = max(finalAlpha, waveAlpha);
        }
      }
    }
  }

  if (finalAlpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(finalColor, finalAlpha);
}
`

/**
 * 创建 Sea Shader 渲染器
 */
function createSeaShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    // 深度参数
    const depthBands = getNumberParam(params.depthBands, 6)
    const depthGap = getNumberParam(params.depthGap, 10)
    const depthColor = parseColorToVec3(
        getStringParam(params.depthColor, '#3f6f8f'),
        [63 / 255, 111 / 255, 143 / 255]
    )
    const depthOpacity = getNumberParam(params.depthOpacity, 0.22)
    const shallowFade = getNumberParam(params.depthShallowFade, 0.9)

    // 海浪参数
    const waveSpacing = getNumberParam(params.waveSpacing, 48)
    const waveAmplitude = getNumberParam(params.waveAmplitude, 2.4)
    const waveLength = getNumberParam(params.waveLength, 9)
    const waveWidth = getNumberParam(params.waveWidth, 1)
    const waveColor = parseColorToVec3(
        getStringParam(params.waveColor, '#345d7a'),
        [52 / 255, 93 / 255, 122 / 255]
    )
    const waveOpacity = getNumberParam(params.waveOpacity, 0.2)
    const waveMargin = getNumberParam(params.waveMargin, 5)
    const waveSegLength = getNumberParam(params.waveSegLength, 24)
    const waveDensity = getNumberParam(params.waveDensity, 0.7)

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: seaFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                // 深度 uniforms
                u_depthBands: { value: depthBands, type: 'f32' },
                u_depthGap: { value: depthGap, type: 'f32' },
                u_depthColor: { value: depthColor, type: 'vec3<f32>' },
                u_depthOpacity: { value: depthOpacity, type: 'f32' },
                u_shallowFade: { value: shallowFade, type: 'f32' },
                // 海浪 uniforms
                u_waveSpacing: { value: waveSpacing, type: 'f32' },
                u_waveAmplitude: { value: waveAmplitude, type: 'f32' },
                u_waveLength: { value: waveLength, type: 'f32' },
                u_waveWidth: { value: waveWidth, type: 'f32' },
                u_waveColor: { value: waveColor, type: 'vec3<f32>' },
                u_waveOpacity: { value: waveOpacity, type: 'f32' },
                u_waveMargin: { value: waveMargin, type: 'f32' },
                u_waveSegLength: { value: waveSegLength, type: 'f32' },
                u_waveDensity: { value: waveDensity, type: 'f32' },
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
 * Canvas 2D 版本的 sea（保留作为 fallback）
 */
function createSeaCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现（引用现有 overlays.tsx 中的逻辑）
            // 这里暂时保留为占位符，实际会调用现有的 drawSeaDepthBands 和 drawSeaWaves
            console.log('[SeaPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Sea 插件实现
 */
export const seaPlugin: PixiPluginImplementation = {
    id: 'sea',
    pluginType: 'decoration',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createSeaShaderRenderer(params)
        } else {
            return createSeaCanvasRenderer(params)
        }
    },
}
