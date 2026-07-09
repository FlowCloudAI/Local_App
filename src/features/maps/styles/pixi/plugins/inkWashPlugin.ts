/**
 * Ink Wash 插件（shader）
 *
 * 淡墨浓淡渐变：近岸一圈淡墨晕开、向内陆渐隐，多层叠加表现"墨分五色"。
 * 只作用于陆地侧。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const inkWashFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uWashWidth;
uniform vec3 uLightInk;
uniform float uWashOpacity;
uniform float uLayers;

${coastFieldGlsl}

void main() {
    vec4 field = texture(uCoastField, vUV);
    if (field.g < 0.5) discard; // 只在陆地侧

    float dist = coastDistance(field);
    if (dist > uWashWidth * 1.2) discard;

    float totalAlpha = 0.0;

    // 第一层：最浓，近岸 30% 范围
    totalAlpha += smoothstep(uWashWidth * 0.3, 0.0, dist) * 0.4;

    // 第二层：中浓，近岸 60% 范围
    if (uLayers >= 2.0) {
        totalAlpha += smoothstep(uWashWidth * 0.6, 0.0, dist) * 0.3;
    }

    // 第三层：最淡，整个淡墨带
    if (uLayers >= 3.0) {
        totalAlpha += smoothstep(uWashWidth, 0.0, dist) * 0.2;
    }

    // 第四层：极淡外晕
    if (uLayers >= 4.0) {
        totalAlpha += smoothstep(uWashWidth * 1.2, 0.0, dist) * 0.1;
    }

    float alpha = totalAlpha * uWashOpacity;
    if (alpha < 0.004) discard;
    finalColor = vec4(uLightInk * alpha, alpha);
}
`

function createInkWashShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const washOpacity = Math.max(0, Math.min(1, getNumberParam(params.washOpacity, 0.12)))
    if (washOpacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-ink-wash',
        fragment: inkWashFragment,
        useCoastField: true,
        uniforms: {
            uWashWidth: {value: Math.max(10, Math.min(100, getNumberParam(params.washWidth, 35))), type: 'f32'},
            uLightInk: {value: parseColorToVec3(getStringParam(params.lightInk, '#666666'), [102 / 255, 102 / 255, 102 / 255]), type: 'vec3<f32>'},
            uWashOpacity: {value: washOpacity, type: 'f32'},
            uLayers: {value: Math.max(2, Math.min(4, Math.round(getNumberParam(params.layers, 3)))), type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const inkWashPlugin: PixiPluginImplementation = {
    id: 'ink-wash',
    pluginType: 'decoration',
    createShaderRenderer: createInkWashShaderRenderer,
}
