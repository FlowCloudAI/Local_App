/**
 * Paper Grain 插件（shader）
 *
 * 纸张颗粒：按场景像素格撒深浅颗粒点，模拟纸面 tooth。
 * 关键点：
 * - 以 floor(场景坐标) 为哈希单元 → 颗粒钉在"纸面"上，缩放平移不游移；
 *   （旧实现用 gl_FragCoord 屏幕坐标，颗粒会贴着屏幕漂）
 * - density 语义与 Canvas 版一致：整幅画布上的颗粒总数，
 *   换算为每像素概率 density / (w*h)。（旧实现按 density/10000 每像素概率，
 *   比 Canvas 版多出两个数量级。）
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {createSceneQuadShader, hashGlsl, updateSceneQuadShader} from './shared'

const paperGrainFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uDfRange;
uniform float uDensity;
uniform vec3 uDarkColor;
uniform vec3 uLightColor;
uniform float uGrainOpacity;

${hashGlsl}

void main() {
    vec2 cell = floor(vUV * uCanvasSize);
    float threshold = uDensity / max(uCanvasSize.x * uCanvasSize.y, 1.0);
    if (hash(cell) >= threshold) discard;

    // 与 Canvas 版一致：58% 概率暗色颗粒，透明度随机浮动
    vec3 grain = mix(uDarkColor, uLightColor, step(0.58, hash(cell + vec2(271.8, 0.0))));
    float alpha = uGrainOpacity * (0.35 + 0.65 * hash(cell + vec2(97.3, 41.1)));
    finalColor = vec4(grain * alpha, alpha);
}
`

function createPaperGrainShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.08)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-paper-grain',
        fragment: paperGrainFragment,
        uniforms: {
            uDensity: {value: Math.max(80, Math.min(20000, getNumberParam(params.density, 1300))), type: 'f32'},
            uDarkColor: {value: parseColorToVec3(getStringParam(params.darkColor, 'rgba(70, 45, 22, 1)'), [70 / 255, 45 / 255, 22 / 255]), type: 'vec3<f32>'},
            uLightColor: {value: parseColorToVec3(getStringParam(params.lightColor, 'rgba(255, 248, 220, 1)'), [1.0, 248 / 255, 220 / 255]), type: 'vec3<f32>'},
            uGrainOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const paperGrainPlugin: PixiPluginImplementation = {
    id: 'paper-grain',
    pluginType: 'effect',
    createShaderRenderer: createPaperGrainShaderRenderer,
}
