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
    // 透明度必须由三通道总覆盖度决定，不能用胜者通道：场内异种地形交界是
    // (1,0,0)|(0,1,0) 的单热像素，双线性插值会把每个通道都压到 ~0.5，
    // max 通道随之跌进 smoothstep 低段 → 交界处露出底色白缝；而总和在
    // 线性插值下保持 1，交界处始终完全不透明。
    float total = coverage.r + coverage.g + coverage.b;
    if (total < 0.02) discard;

    // 颜色按通道覆盖度加权：交界处在 1 个场像素内平滑过渡，
    // 与 Canvas 回退（逐 texel 单选色 + drawImage 放大插值）观感一致。
    vec3 color = (coverage.r * uGrassColor + coverage.g * uMountainColor + coverage.b * uDesertColor) / total;

    // 覆盖度→软边：地形场外缘保留了笔画的抗锯齿 fringe（见 terrainField 合并注释），
    // smoothstep 把它压成约 1 场景像素的柔和过渡；内部覆盖度=1 → 完全不透明。
    float alpha = smoothstep(0.30, 0.80, total);
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
