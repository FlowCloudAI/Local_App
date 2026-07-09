/**
 * Brush Stroke 插件（shader）
 *
 * 毛笔笔触边界：沿海岸线陆地侧行笔的墨带，带三个毛笔特征——
 * 1. 提按：笔宽沿边界低频扰动（vnoise）；
 * 2. 飞白：高频噪声在笔画内挖出枯笔断口，越靠外缘越易断；
 * 3. 墨韵：中心浓、外缘淡的衰减。
 * 当前无预设启用，作为水墨风格升级的储备件保持可用。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader, valueNoiseGlsl} from './shared'

const brushStrokeFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uBaseWidth;
uniform float uWidthVariation;
uniform float uDryThreshold;
uniform vec3 uInkColor;
uniform float uInkOpacity;

${coastFieldGlsl}
${valueNoiseGlsl}

void main() {
    vec4 field = texture(uCoastField, vUV);
    if (field.g < 0.5) discard; // 陆地侧行笔

    float dist = coastDistance(field);
    vec2 pos = vUV * uCanvasSize;

    // 提按：低频宽度扰动
    float widthNoise = vnoise(pos / 18.0);
    float strokeWidth = uBaseWidth * (1.0 - uWidthVariation * 0.5 + uWidthVariation * widthNoise);
    if (dist > strokeWidth) discard;

    // 墨韵：中心浓、外缘淡
    float body = 1.0 - smoothstep(strokeWidth * 0.45, strokeWidth, dist);

    // 飞白：高频噪声挖断口，外缘（dist 接近 strokeWidth）更易断
    float dry = vnoise(pos / 3.5);
    float edgeBias = dist / max(strokeWidth, 0.001) * 0.35;
    float keep = smoothstep(uDryThreshold - 0.12, uDryThreshold + 0.12, dry + (0.35 - edgeBias));

    float alpha = uInkOpacity * body * keep;
    if (alpha < 0.004) discard;
    finalColor = vec4(uInkColor * alpha, alpha);
}
`

function createBrushStrokeShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.inkOpacity, 0.5)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-brush-stroke',
        fragment: brushStrokeFragment,
        useCoastField: true,
        uniforms: {
            uBaseWidth: {value: Math.max(1, getNumberParam(params.baseWidth, 8)), type: 'f32'},
            uWidthVariation: {value: Math.max(0, Math.min(1, getNumberParam(params.widthVariation, 0.5))), type: 'f32'},
            uDryThreshold: {value: Math.max(0, Math.min(1, getNumberParam(params.dryBrushThreshold, 0.3))), type: 'f32'},
            uInkColor: {value: parseColorToVec3(getStringParam(params.inkColor, '#121212'), [18 / 255, 18 / 255, 18 / 255]), type: 'vec3<f32>'},
            uInkOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const brushStrokePlugin: PixiPluginImplementation = {
    id: 'brush-stroke',
    pluginType: 'decoration',
    createShaderRenderer: createBrushStrokeShaderRenderer,
}
