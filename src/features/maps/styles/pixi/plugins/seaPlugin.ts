/**
 * Sea 插件（shader）
 *
 * 海洋效果，只作用于海洋侧：
 * 1. 海水深浅：以晕线间距为台阶、离岸逐层加深（与 Canvas 版形态学
 *    逐层膨胀累积的台阶语义一致，蓝色以海岸晕线为界一层层加深）；
 * 2. 程序化海浪：抖动网格撒短正弦段，离岸留白（margin 内不画）。
 *
 * Canvas 版是最重的绘制项（bands+1 次全画布多边形膨胀绘制），
 * shader 版把它变成每像素一次纹理采样。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, hashGlsl, updateSceneQuadShader} from './shared'

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

uniform float uWaveSpacing;
uniform float uWaveAmplitude;
uniform float uWaveLength;
uniform float uWaveWidth;
uniform vec3 uWaveColor;
uniform float uWaveOpacity;
uniform float uWaveMargin;
uniform float uWaveSegLength;
uniform float uWaveDensity;

${coastFieldGlsl}
${hashGlsl}

void main() {
    float sd = coastSd(vUV);
    if (sd <= 0.0) discard; // 只处理海洋侧

    float dist = sd;
    vec2 pos = vUV * uCanvasSize;

    // 1) 海水深浅：已越过 covered 条晕线 → 台阶式加深；近岸按 uShallowFade 减淡
    vec4 acc = vec4(0.0);
    if (uDepthOpacity > 0.0) {
        float covered = clamp(floor(dist / uDepthGap), 0.0, uDepthBands);
        float shallow = 1.0 - covered / uDepthBands; // 近岸=1
        float depthAlpha = uDepthOpacity * (1.0 - uShallowFade * shallow);
        acc = vec4(uDepthColor * depthAlpha, depthAlpha);
    }

    // 2) 程序化海浪：每格一段随机相位/长度/振幅的短正弦
    if (uWaveOpacity > 0.0 && dist > uWaveMargin) {
        vec2 grid = floor(pos / uWaveSpacing);
        if (hash(grid + vec2(3.1, 1.7)) < uWaveDensity) {
            vec2 cellCenter = (grid + 0.5) * uWaveSpacing;
            vec2 jitter = (vec2(hash(grid + vec2(11.1, 0.0)), hash(grid + vec2(0.0, 23.3))) - 0.5) * uWaveSpacing * 1.4;
            vec2 waveCenter = cellCenter + jitter;

            float phase = hash(grid + vec2(5.5, 0.0)) * 6.28318;
            float segLen = uWaveSegLength * (0.55 + hash(grid + vec2(7.7, 0.0)) * 0.9);
            float amp = uWaveAmplitude * (0.55 + hash(grid + vec2(9.9, 0.0)) * 0.9);

            vec2 delta = pos - waveCenter;
            if (abs(delta.x) < segLen * 0.5) {
                float waveY = sin((delta.x / uWaveLength) * 6.28318 + phase) * amp;
                float distToWave = abs(delta.y - waveY);
                float halfW = uWaveWidth * 0.5;
                float waveAlpha = uWaveOpacity * (1.0 - smoothstep(halfW, halfW + 0.9, distToWave));
                if (waveAlpha > 0.0) {
                    vec4 wave = vec4(uWaveColor * waveAlpha, waveAlpha);
                    acc = wave + acc * (1.0 - wave.a); // 预乘 over 合成
                }
            }
        }
    }

    if (acc.a < 0.004) discard;
    finalColor = acc;
}
`

function createSeaShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const depthOpacity = getNumberParam(params.depthOpacity, 0.22)
    const waveOpacity = getNumberParam(params.waveOpacity, 0.2)
    if (depthOpacity <= 0 && waveOpacity <= 0) return null

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
            uWaveSpacing: {value: Math.max(6, getNumberParam(params.waveSpacing, 24)), type: 'f32'},
            uWaveAmplitude: {value: Math.max(0, getNumberParam(params.waveAmplitude, 2.4)), type: 'f32'},
            uWaveLength: {value: Math.max(4, getNumberParam(params.waveLength, 9)), type: 'f32'},
            uWaveWidth: {value: Math.max(0.4, getNumberParam(params.waveWidth, 1)), type: 'f32'},
            uWaveColor: {value: parseColorToVec3(getStringParam(params.waveColor, '#345d7a'), [52 / 255, 93 / 255, 122 / 255]), type: 'vec3<f32>'},
            uWaveOpacity: {value: Math.max(0, Math.min(1, waveOpacity)), type: 'f32'},
            uWaveMargin: {value: Math.max(0, getNumberParam(params.waveMargin, 4)), type: 'f32'},
            uWaveSegLength: {value: Math.max(6, getNumberParam(params.waveSegLength, 22)), type: 'f32'},
            uWaveDensity: {value: Math.max(0, Math.min(1, getNumberParam(params.waveDensity, 0.6))), type: 'f32'},
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
