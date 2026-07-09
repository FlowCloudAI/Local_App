/**
 * Land Depth 插件（shader）
 *
 * 陆地纵深：沿海岸向陆地内侧的柔和内阴影，近岸略深、内陆渐亮，
 * 让陆地不再是纯色剪纸。只作用于陆地侧。
 * Canvas 版用 clip + blur 宽描边实现；shader 版用距离场平滑衰减，观感一致。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const landDepthFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uBandWidth;
uniform vec3 uShadowColor;
uniform float uShadowOpacity;

${coastFieldGlsl}

void main() {
    float sd = coastSd(vUV);
    if (sd >= 0.0) discard; // 只在陆地侧

    float dist = -sd;
    if (dist > uBandWidth) discard;

    float alpha = uShadowOpacity * (1.0 - smoothstep(0.0, uBandWidth, dist));
    if (alpha < 0.004) discard;
    finalColor = vec4(uShadowColor * alpha, alpha);
}
`

function createLandDepthShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.16)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-land-depth',
        fragment: landDepthFragment,
        useCoastField: true,
        uniforms: {
            uBandWidth: {value: Math.max(2, getNumberParam(params.width, 26)), type: 'f32'},
            uShadowColor: {value: parseColorToVec3(getStringParam(params.color, '#5a3a1c'), [90 / 255, 58 / 255, 28 / 255]), type: 'vec3<f32>'},
            uShadowOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const landDepthPlugin: PixiPluginImplementation = {
    id: 'land-depth',
    pluginType: 'decoration',
    createShaderRenderer: createLandDepthShaderRenderer,
}
