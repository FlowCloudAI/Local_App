import type {Shader} from 'pixi.js'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {parseColorToVec3} from '../shaderRegistry'
import {getNumberParam, getStringParam} from '../utils'
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
uniform float uOpacity;

${coastFieldGlsl}

void main() {
    if (coastSd(vUV) >= 0.0) discard;

    vec3 coverage = texture(uTerrainField, vUV).rgb;
    float total = coverage.r + coverage.g + coverage.b;
    float alpha = max(max(coverage.r, coverage.g), coverage.b) * uOpacity;
    if (total < 0.004 || alpha < 0.004) discard;

    vec3 color = (
        uGrassColor * coverage.r
        + uMountainColor * coverage.g
        + uDesertColor * coverage.b
    ) / total;
    finalColor = vec4(color * alpha, alpha);
}
`

function createTerrainShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const opacity = Math.max(0, Math.min(1, getNumberParam(params.opacity, 0.46)))
    if (opacity <= 0) return null

    const shader = createSceneQuadShader({
        name: 'map-terrain',
        fragment: terrainFragment,
        useCoastField: true,
        useTerrainField: true,
        uniforms: {
            uGrassColor: {value: parseColorToVec3(getStringParam(params.grassColor, '#82b45f'), [130 / 255, 180 / 255, 95 / 255]), type: 'vec3<f32>'},
            uMountainColor: {value: parseColorToVec3(getStringParam(params.mountainColor, '#8a7868'), [138 / 255, 120 / 255, 104 / 255]), type: 'vec3<f32>'},
            uDesertColor: {value: parseColorToVec3(getStringParam(params.desertColor, '#d8b067'), [216 / 255, 176 / 255, 103 / 255]), type: 'vec3<f32>'},
            uOpacity: {value: opacity, type: 'f32'},
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
