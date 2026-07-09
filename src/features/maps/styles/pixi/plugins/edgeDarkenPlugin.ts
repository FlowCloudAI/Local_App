/**
 * Edge Darken 插件（shader）
 *
 * 边缘加深：以海岸线为中心、横跨两侧的窄暗带（Canvas 版是沿多边形路径的
 * 宽描边），给边界一点厚度感。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const edgeDarkenFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform float uEdgeWidth;
uniform vec3 uEdgeColor;
uniform float uEdgeOpacity;

${coastFieldGlsl}

void main() {
    float dist = abs(coastSd(vUV)); // 两侧皆为到海岸线的无符号距离

    float halfW = uEdgeWidth * 0.5;
    float alpha = uEdgeOpacity * (1.0 - smoothstep(halfW - 0.75, halfW + 0.75, dist));
    if (alpha < 0.004) discard;
    finalColor = vec4(uEdgeColor * alpha, alpha);
}
`

function createEdgeDarkenShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.12)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-edge-darken',
        fragment: edgeDarkenFragment,
        useCoastField: true,
        uniforms: {
            uEdgeWidth: {value: Math.max(0.5, getNumberParam(params.width, 18)), type: 'f32'},
            uEdgeColor: {value: parseColorToVec3(getStringParam(params.color, 'rgba(50, 28, 12, 1)'), [50 / 255, 28 / 255, 12 / 255]), type: 'vec3<f32>'},
            uEdgeOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const edgeDarkenPlugin: PixiPluginImplementation = {
    id: 'edge-darken',
    pluginType: 'effect',
    createShaderRenderer: createEdgeDarkenShaderRenderer,
}
