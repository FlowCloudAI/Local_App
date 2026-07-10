import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {parseColorToVec3} from '../shaderRegistry'
import {getStringParam} from '../utils'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const terrainFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform sampler2D uTerrainField;
uniform vec3 uGrassColor;
uniform vec3 uMountainColor;
uniform vec3 uDesertColor;

${coastFieldGlsl}

void main() {
    if (coastSd(vUV) >= 0.0) discard;

    vec3 coverage = texture(uTerrainField, vUV).rgb;
    float top = max(coverage.r, max(coverage.g, coverage.b));
    if (top < 0.02) discard;

    vec3 color = coverage.r >= coverage.g && coverage.r >= coverage.b
        ? uGrassColor
        : coverage.g >= coverage.b ? uMountainColor : uDesertColor;

    // 覆盖度→软边：地形场保留了笔画的抗锯齿 fringe（见 terrainField 合并注释），
    // smoothstep 把它压成约 1 场景像素的柔和过渡；内部覆盖度=1 → 完全不透明。
    float alpha = smoothstep(0.30, 0.80, top);
    if (alpha < 0.004) discard;
    finalColor = vec4(color * alpha, alpha);
}
`

function createTerrainShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const shader = createSceneQuadShader({
        name: 'map-terrain',
        fragment: terrainFragment,
        useCoastField: true,
        useTerrainField: true,
        uniforms: {
            uGrassColor: {value: parseColorToVec3(getStringParam(params.grassColor, '#82b45f'), [130 / 255, 180 / 255, 95 / 255]), type: 'vec3<f32>'},
            uMountainColor: {value: parseColorToVec3(getStringParam(params.mountainColor, '#8a7868'), [138 / 255, 120 / 255, 104 / 255]), type: 'vec3<f32>'},
            uDesertColor: {value: parseColorToVec3(getStringParam(params.desertColor, '#d8b067'), [216 / 255, 176 / 255, 103 / 255]), type: 'vec3<f32>'},
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => (shader as Shader).destroy(),
    }
}

export const terrainPlugin: PixiPluginImplementation = {
    id: 'terrain',
    pluginType: 'decoration',
    createShaderRenderer: createTerrainShaderRenderer,
}
