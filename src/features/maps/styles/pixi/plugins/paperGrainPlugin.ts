/**
 * Paper Grain Shader 插件
 *
 * 纸张颗粒效果：在画布上随机生成深浅颗粒点，模拟纸张纤维质感。
 * 这是第一个完整的 shader 实现，用于验证整个架构的可行性。
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
 * Paper Grain Fragment Shader
 */
const paperGrainFragmentShader = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_density;         // 颗粒密度（点数 / 100万像素）
uniform vec3 u_darkColor;        // 深色颗粒
uniform vec3 u_lightColor;       // 亮色颗粒
uniform float u_opacity;         // 整体不透明度

varying vec2 vTextureCoord;

// 简单哈希函数（伪随机数生成）
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 pos = gl_FragCoord.xy;
  float noise = hash(pos);

  // 密度控制：density=1600 → 每像素 0.00016 概率
  float threshold = u_density / 10000.0;

  if (noise < threshold) {
    // 颗粒颜色随机（深浅混合）
    float colorNoise = hash(pos + vec2(271.8, 0.0));
    vec3 grainColor = mix(u_darkColor, u_lightColor, colorNoise);
    gl_FragColor = vec4(grainColor, u_opacity);
  } else {
    discard;
  }
}
`

/**
 * 创建 Paper Grain Shader 渲染器
 */
function createPaperGrainShaderRenderer(params: MapStyleParameterRecord): PluginRenderer {
    const density = getNumberParam(params.density, 1600)
    const opacity = getNumberParam(params.opacity, 0.08)
    const darkColor = parseColorToVec3(
        getStringParam(params.darkColor, 'rgba(96, 60, 20, 1)'),
        [96 / 255, 60 / 255, 20 / 255]
    )
    const lightColor = parseColorToVec3(
        getStringParam(params.lightColor, 'rgba(255, 246, 212, 1)'),
        [1.0, 246 / 255, 212 / 255]
    )

    const filter = new Filter({
        glProgram: GlProgram.from({
            vertex: `
                in vec2 aPosition;
                out vec2 vTextureCoord;

                uniform mat3 uProjectionMatrix;
                uniform mat3 uTextureMatrix;

                void main() {
                    gl_Position = vec4((uProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
                    vTextureCoord = (uTextureMatrix * vec3(aPosition, 1.0)).xy;
                }
            `,
            fragment: paperGrainFragmentShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [800, 600], type: 'vec2<f32>' },
                u_density: { value: density, type: 'f32' },
                u_darkColor: { value: darkColor, type: 'vec3<f32>' },
                u_lightColor: { value: lightColor, type: 'vec3<f32>' },
                u_opacity: { value: opacity, type: 'f32' },
            }),
        },
    })

    return {
        type: 'shader',
        filter,
        update: (context: ShaderRenderContext) => {
            // 更新分辨率 uniform
            const uniforms = filter.resources.uniforms.uniforms
            uniforms.u_resolution = [context.scene.canvas.width, context.scene.canvas.height]
        },
    }
}

/**
 * Canvas 2D 版本的 paper-grain（保留作为 fallback）
 */
function createPaperGrainCanvasRenderer(params: MapStyleParameterRecord): PluginRenderer {
    return {
        type: 'canvas',
        render: (ctx: CanvasRenderingContext2D, context: ShaderRenderContext) => {
            const density = getNumberParam(params.density, 1600)
            const opacity = getNumberParam(params.opacity, 0.08)
            const darkColorStr = getStringParam(params.darkColor, 'rgba(96, 60, 20, 1)')
            const lightColorStr = getStringParam(params.lightColor, 'rgba(255, 246, 212, 1)')

            const width = context.scene.canvas.width
            const height = context.scene.canvas.height
            const threshold = density / 10000.0

            ctx.save()
            ctx.globalAlpha = opacity

            // 简单的随机点生成（Canvas 版本）
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const noise = Math.random()
                    if (noise < threshold) {
                        const colorNoise = Math.random()
                        ctx.fillStyle = colorNoise > 0.5 ? lightColorStr : darkColorStr
                        ctx.fillRect(x, y, 1, 1)
                    }
                }
            }

            ctx.restore()
        },
    }
}

/**
 * Paper Grain 插件实现
 */
export const paperGrainPlugin: PixiPluginImplementation = {
    id: 'paper-grain',
    pluginType: 'effect',
    defaultImplementation: 'shader',
    createRenderer: (params: MapStyleParameterRecord, impl: 'canvas' | 'shader'): PluginRenderer => {
        if (impl === 'shader') {
            return createPaperGrainShaderRenderer(params)
        } else {
            return createPaperGrainCanvasRenderer(params)
        }
    },
}
