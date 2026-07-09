/**
 * Coastline Outline 插件（shader）
 *
 * 海岸线晕线：向海侧的多圈等距轮廓线，越远越淡（古地图/托尔金标志元素）。
 * 距离场等值线与 Canvas 版圆形结构元形态学膨胀边界在数学上等价，视觉一致。
 * 注意：海岸线本体描边（style.coastline.layers 的抖动笔画）与罗盘不在此处——
 * 它们是矢量线稿，由 overlays 的 linework Canvas 位图绘制并叠在所有 shader 效果之上。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const hatchFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uRings;
uniform float uGap;
uniform float uWidth;
uniform vec3 uHatchColor;
uniform float uHatchOpacity;

${coastFieldGlsl}

void main() {
    vec4 field = texture(uCoastField, vUV);
    if (field.g > 0.5) discard; // 只画海洋侧

    float dist = coastDistance(field);
    float ring = floor(dist / uGap + 0.5); // 最近的晕线序号
    if (ring < 1.0 || ring > uRings) discard;

    float delta = abs(dist - ring * uGap);
    float halfW = uWidth * 0.5;
    float edge = 1.0 - smoothstep(halfW, halfW + 0.75, delta);
    float ringFade = 1.0 - (ring - 1.0) / uRings; // 与 Canvas 版一致的线性衰减
    float alpha = uHatchOpacity * ringFade * edge;

    if (alpha < 0.004) discard;
    finalColor = vec4(uHatchColor * alpha, alpha);
}
`

function createCoastlineOutlineShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const rings = Math.max(0, Math.min(12, Math.round(getNumberParam(params.hatchRings, 4))))
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.hatchOpacity, 0.5)))
    if (rings <= 0 || opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-coastline-hatch',
        fragment: hatchFragment,
        useCoastField: true,
        uniforms: {
            uRings: {value: rings, type: 'f32'},
            uGap: {value: Math.max(1, getNumberParam(params.hatchGap, 7)), type: 'f32'},
            uWidth: {value: Math.max(0.4, getNumberParam(params.hatchWidth, 0.9)), type: 'f32'},
            uHatchColor: {value: parseColorToVec3(getStringParam(params.hatchColor, '#6a4a26'), [106 / 255, 74 / 255, 38 / 255]), type: 'vec3<f32>'},
            uHatchOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const coastlineOutlinePlugin: PixiPluginImplementation = {
    id: 'coastline-outline',
    pluginType: 'decoration',
    createShaderRenderer: createCoastlineOutlineShaderRenderer,
}
