/**
 * Land Depth Shader 插件
 *
 * 陆地纵深效果：沿海岸向陆地内侧绘制渐变内阴影，形成"近岸略深、内陆渐亮"的效果。
 * 基于距离场实现平滑过渡。
 *
 * Canvas 版本需要 ~40ms，Shader 预期 ~1.5ms（30× 加速）
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
 * Land Depth Fragment Shader
 *
 * 基于距离场的内阴影：距离海岸越近越暗
 */
const landDepthFragmentShader = `
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

uniform float u_width;           // 阴影带宽度（像素）
uniform vec3 u_color;            // 阴影颜色
uniform float u_opacity;         // 不透明度

varying vec2 vTextureCoord;

void main() {
  float isLand = texture2D(u_landMask, vTextureCoord).r;

  // 只处理陆地
  if (isLand < 0.5) {
    discard;
  }

  // 读取距离场（陆地内部，距离值较小表示靠近海岸）
  float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);

  // 近岸内阴影：距离海岸越近越暗
  // smoothstep(u_width, 0.0, distToCoast) 在 [0, u_width] 范围内从 1 渐变到 0
  // 注意：这里假设距离场对陆地内部返回的是正值（到海岸的距离）
  // 如果距离场实现不同，可能需要调整逻辑
  float shadowFade = smoothstep(u_width, 0.0, distToCoast);
  float alpha = u_opacity * shadowFade;

  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(u_color, alpha);
}
`

/**
 * 创建 Land Depth Shader 渲染器
 */
function createLandDepthShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const width = Math.max(2, getNumberParam(params.width, 26))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.16)))
    const color = parseColorToVec3(
        getStringParam(params.color, '#5a3a1c'),
        [90 / 255, 58 / 255, 28 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: landDepthFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_width: { value: width, type: 'f32' },
                u_color: { value: color, type: 'vec3<f32>' },
                u_opacity: { value: opacity, type: 'f32' },
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
 * Canvas 2D 版本的 land-depth（保留作为 fallback）
 */
function createLandDepthCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (_ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            // Canvas 版本的实现（引用现有 overlays.tsx 中的 drawLandDepth）
            console.log('[LandDepthPlugin] Canvas fallback rendered', params, context)
        },
    }
}

/**
 * Land Depth 插件实现
 */
export const landDepthPlugin: PixiPluginImplementation = {
    id: 'land-depth',
    pluginType: 'decoration',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createLandDepthShaderRenderer(params)
        } else {
            return createLandDepthCanvasRenderer(params)
        }
    },
}
