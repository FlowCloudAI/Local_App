/**
 * Shader 插件公共基建
 *
 * 渲染模型：每个插件是一个覆盖整个场景的 Mesh 四边形（不是 Filter）。
 * - aPosition 用场景坐标，随场景容器一起平移缩放，天然与 Canvas 叠加层对齐；
 * - aUV 即场景归一化坐标，直接用于采样海岸场纹理，完全绕开 Filter 的
 *   屏幕空间 frame/padding 数学；
 * - 各插件四边形作为兄弟节点按序排列，靠普通 alpha 混合合成——
 *   Filter 堆叠方案里后一个 pass 的 discard 会清掉前一个 pass 的输出，
 *   这是旧架构的根本缺陷。
 *
 * GLSL 约定（Pixi v8 预处理器负责版本兼容）：
 * - 顶点用 in/out，片元用 in + finalColor + texture()，不写 #version；
 * - 片元显式声明 precision highp float（hash 函数在 mediump 下会碎）；
 * - 输出预乘 alpha：finalColor = vec4(color * alpha, alpha)。
 */

import {GlProgram, Shader, Texture, UniformGroup} from 'pixi.js'
import {COAST_FIELD_RANGE_PX} from '../utils'
import type {ShaderRenderContext} from '../types'

/** 场景四边形顶点着色器。uProjection/uWorldTransform 由 Pixi 全局组注入，uTransform 为 Mesh 本地组。 */
export const sceneQuadVertex = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}
`

/** 伪随机哈希，与 Canvas 端 pointNoise 同源，保证两条路径的随机分布风格一致。 */
export const hashGlsl = `
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`

/** 平滑值噪声（双线性插值哈希），用于笔触宽度扰动等低频扰动。 */
export const valueNoiseGlsl = `
${hashGlsl}
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`

/** 海岸场采样声明：dist 单位为场景像素，isLand 为 0/1（边界处线性过渡）。 */
export const coastFieldGlsl = `
uniform sampler2D uCoastField;
uniform float uDfRange;

float coastDistance(vec4 field) {
    return field.r * uDfRange;
}
`

export interface SceneQuadUniformRecord {
    [name: string]: { value: number | number[] | Float32Array; type: string }
}

export interface SceneQuadShaderOptions {
    /** 程序名（进 Pixi 程序缓存 key 与调试信息） */
    name: string
    fragment: string
    /** 插件自有 uniform；uCanvasSize / uDfRange 自动注入 */
    uniforms?: SceneQuadUniformRecord
    /** 声明使用海岸场纹理（fragment 里需引入 coastFieldGlsl） */
    useCoastField?: boolean
}

/**
 * 创建场景四边形 Shader。
 * 纹理必须以 resources 键绑定（v8 中 sampler 不能进 UniformGroup——
 * 旧实现把纹理塞进 uniforms 记录导致从未绑定成功）。
 */
export function createSceneQuadShader({name, fragment, uniforms, useCoastField}: SceneQuadShaderOptions): Shader {
    const resources: Record<string, unknown> = {
        styleUniforms: new UniformGroup({
            uCanvasSize: {value: [1, 1], type: 'vec2<f32>'},
            uDfRange: {value: COAST_FIELD_RANGE_PX, type: 'f32'},
            ...(uniforms ?? {}),
        }),
    }
    if (useCoastField) {
        // 占位纹理，update 时换绑真正的海岸场
        resources.uCoastField = Texture.WHITE.source
    }

    return new Shader({
        glProgram: GlProgram.from({
            vertex: sceneQuadVertex,
            fragment,
            name,
        }),
        resources,
    })
}

/** 同步画布尺寸与海岸场纹理。插件的 update 默认实现。 */
export function updateSceneQuadShader(shader: Shader, context: ShaderRenderContext): void {
    const group = shader.resources.styleUniforms as UniformGroup
    const uniforms = group.uniforms as Record<string, unknown>
    uniforms.uCanvasSize = [context.scene.canvas.width, context.scene.canvas.height]

    const coastField = context.coastField as Texture | undefined
    if (coastField && 'uCoastField' in shader.resources) {
        shader.resources.uCoastField = coastField.source
    }
}
