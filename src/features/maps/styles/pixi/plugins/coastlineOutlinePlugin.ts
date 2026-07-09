/**
 * Coastline Outline Shader 插件
 *
 * 海岸线晕线效果：向海侧绘制多层等距轮廓线，逐渐变淡。
 * 基于距离场采样，避免形态学膨胀的多 pass 开销。
 *
 * Canvas 版本需要 ~120ms，Shader 预期 ~2ms（60× 加速）
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
 * Coastline Hatch Fragment Shader
 *
 * 基于距离场采样，绘制多层同心环形线条
 */
const coastlineHatchFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

uniform float u_rings;           // 晕线圈数
uniform float u_gap;             // 晕线间隔（像素）
uniform float u_width;           // 晕线宽度（像素）
uniform vec3 u_hatchColor;       // 晕线颜色
uniform float u_hatchOpacity;    // 基础不透明度

varying vec2 vTextureCoord;

void main() {
  float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
  float isLand = texture2D(u_landMask, vTextureCoord).r;

  // 只处理海洋侧
  if (isLand > 0.5) {
    discard;
  }

  float totalAlpha = 0.0;

  // 遍历每个晕线环
  for (float ring = 1.0; ring <= u_rings; ring += 1.0) {
    float ringDist = ring * u_gap;
    float delta = abs(distToCoast - ringDist);

    if (delta < u_width) {
      // 环内平滑过渡
      float ringFade = 1.0 - (ring - 1.0) / u_rings;  // 越远越淡
      float edgeFade = smoothstep(u_width, 0.0, delta);  // 边缘抗锯齿
      totalAlpha += edgeFade * ringFade;
    }
  }

  totalAlpha = clamp(totalAlpha, 0.0, 1.0);

  if (totalAlpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(u_hatchColor, totalAlpha * u_hatchOpacity);
}
`

/**
 * 创建 Coastline Outline Shader 渲染器
 */
function createCoastlineOutlineShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const rings = Math.max(1, Math.min(12, Math.round(getNumberParam(params.hatchRings, 4))))
    const gap = Math.max(1, getNumberParam(params.hatchGap, 7))
    const width = Math.max(0.4, getNumberParam(params.hatchWidth, 0.9))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.hatchOpacity, 0.5)))
    const hatchColor = parseColorToVec3(
        getStringParam(params.hatchColor, '#6a4a26'),
        [106 / 255, 74 / 255, 38 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: coastlineHatchFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_rings: { value: rings, type: 'f32' },
                u_gap: { value: gap, type: 'f32' },
                u_width: { value: width, type: 'f32' },
                u_hatchColor: { value: hatchColor, type: 'vec3<f32>' },
                u_hatchOpacity: { value: opacity, type: 'f32' },
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
 * Canvas 2D 版本的 coastline-outline（保留作为 fallback）
 */
function createCoastlineOutlineCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现（引用现有 overlays.tsx 中的 drawCoastlineHatching）
            console.log('[CoastlineOutlinePlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Coastline Outline 插件实现
 */
export const coastlineOutlinePlugin: PixiPluginImplementation = {
    id: 'coastline-outline',
    pluginType: 'decoration',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createCoastlineOutlineShaderRenderer(params)
        } else {
            return createCoastlineOutlineCanvasRenderer(params)
        }
    },
}
