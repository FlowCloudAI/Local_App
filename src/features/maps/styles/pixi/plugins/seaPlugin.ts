/**
 * Sea 插件（shader）
 *
 * 海水深浅：以晕线间距为台阶、离岸逐层加深（与 Canvas 版形态学
 * 逐层膨胀累积的台阶语义一致，蓝色以海岸晕线为界一层层加深）。
 *
 * Canvas 版是最重的绘制项（bands+1 次全画布多边形膨胀绘制），
 * shader 版把它变成每像素一次纹理采样。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const seaFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;

uniform float uDepthBands;
uniform float uDepthGap;
uniform vec3 uDepthColor;
uniform float uDepthOpacity;
uniform float uShallowFade;

${coastFieldGlsl}

void main() {
    float sd = coastSd(vUV);
    if (sd <= 0.0) discard; // 只处理海洋侧

    float dist = sd;

    // 海水深浅：已越过 covered 条晕线 → 台阶式加深；近岸按 uShallowFade 减淡
    float covered = clamp(floor(dist / uDepthGap), 0.0, uDepthBands);
    float shallow = 1.0 - covered / uDepthBands; // 近岸=1
    float alpha = uDepthOpacity * (1.0 - uShallowFade * shallow);

    if (alpha < 0.004) discard;
    finalColor = vec4(uDepthColor * alpha, alpha);
}
`

function createSeaShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const depthOpacity = Math.max(0, Math.min(1, getNumberParam(params.depthOpacity, 0.22)))
    if (depthOpacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-sea',
        fragment: seaFragment,
        useCoastField: true,
        uniforms: {
            uDepthBands: {value: Math.max(1, Math.min(24, Math.round(getNumberParam(params.depthBands, 6)))), type: 'f32'},
            uDepthGap: {value: Math.max(1, getNumberParam(params.depthGap, 10)), type: 'f32'},
            uDepthColor: {value: parseColorToVec3(getStringParam(params.depthColor, '#3f6f8f'), [63 / 255, 111 / 255, 143 / 255]), type: 'vec3<f32>'},
            uDepthOpacity: {value: Math.max(0, Math.min(1, depthOpacity)), type: 'f32'},
            uShallowFade: {value: Math.max(0, Math.min(1, getNumberParam(params.depthShallowFade, 0.9))), type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const seaPlugin: PixiPluginImplementation = {
    id: 'sea',
    pluginType: 'decoration',
    createShaderRenderer: createSeaShaderRenderer,
}
