/**
 * Vignette 插件（shader）
 *
 * 暗角：场景中心向边缘的径向渐暗。参数与 Canvas 版 drawVignetteEffect 对齐
 * （color / inner / opacity；旧 shader 实现用的是 intensity/radius/softness，
 * 与预设声明的参数完全对不上，属于从未接通的痕迹）。
 */

import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {getNumberParam, getStringParam} from '../utils'
import {parseColorToVec3} from '../shaderRegistry'
import {createSceneQuadShader, updateSceneQuadShader} from './shared'

const vignetteFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform vec3 uVignetteColor;
uniform float uInner;
uniform float uVignetteOpacity;

void main() {
    vec2 pos = vUV * uCanvasSize;
    // 与 Canvas 版一致：径向渐变圆心略偏上（0.5, 0.48），半径 = 最长边 * 0.72
    vec2 center = vec2(uCanvasSize.x * 0.5, uCanvasSize.y * 0.48);
    float radius = max(uCanvasSize.x, uCanvasSize.y) * 0.72;

    float innerRadius = radius * uInner;
    float t = clamp((length(pos - center) - innerRadius) / max(radius - innerRadius, 1.0), 0.0, 1.0);
    float alpha = uVignetteOpacity * t;
    if (alpha < 0.004) discard;
    finalColor = vec4(uVignetteColor * alpha, alpha);
}
`

function createVignetteShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.18)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-vignette',
        fragment: vignetteFragment,
        uniforms: {
            uVignetteColor: {value: parseColorToVec3(getStringParam(params.color, 'rgba(72, 42, 14, 1)'), [72 / 255, 42 / 255, 14 / 255]), type: 'vec3<f32>'},
            uInner: {value: Math.max(0, Math.min(1, getNumberParam(params.inner, 0.38))), type: 'f32'},
            uVignetteOpacity: {value: opacity, type: 'f32'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const vignettePlugin: PixiPluginImplementation = {
    id: 'vignette',
    pluginType: 'effect',
    createShaderRenderer: createVignetteShaderRenderer,
}
