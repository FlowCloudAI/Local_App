/**
 * Ink Bleed 插件（shader）
 *
 * 墨迹晕染：以边界为中心向两侧柔和洇开的墨晕（Canvas 版是 blur 宽描边）。
 * 水墨风格的边界柔化层。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const inkBleedFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uBleedWidth;
uniform float uBleedBlur;
uniform vec3 uInkColor;
uniform float uInkOpacity;

${coastFieldGlsl}

void main() {
    vec4 field = texture(uCoastField, vUV);
    float dist = coastDistance(field);

    // 中心浓、向外柔和衰减；总有效半径 = 半宽 + 晕开距离
    float radius = uBleedWidth * 0.5 + uBleedBlur;
    float alpha = uInkOpacity * (1.0 - smoothstep(0.0, radius, dist));
    if (alpha < 0.004) discard;
    finalColor = vec4(uInkColor * alpha, alpha);
}
`

function createInkBleedShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.16)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-ink-bleed',
        fragment: inkBleedFragment,
        useCoastField: true,
        uniforms: {
            uBleedWidth: {value: Math.max(0.5, getNumberParam(params.width, 10)), type: 'f32'},
            uBleedBlur: {value: Math.max(0, getNumberParam(params.blur, 5)), type: 'f32'},
            uInkColor: {value: parseColorToVec3(getStringParam(params.color, 'rgba(16, 16, 16, 1)'), [16 / 255, 16 / 255, 16 / 255]), type: 'vec3<f32>'},
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

export const inkBleedPlugin: PixiPluginImplementation = {
    id: 'ink-bleed',
    pluginType: 'effect',
    createShaderRenderer: createInkBleedShaderRenderer,
}
