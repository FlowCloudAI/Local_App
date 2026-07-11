import {BufferImageSource, Texture} from 'pixi.js'
import {MAP_TERRAIN_KINDS} from '../../../components/MapShapeEditor'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader} from './shared'

const terrainFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform sampler2D uTerrainField;
uniform sampler2D uTerrainPalette;

${coastFieldGlsl}

void main() {
    if (coastSd(vUV) >= 0.0) discard;

    vec2 fieldPosition = vUV * uCanvasSize - 0.5;
    vec2 fieldBase = floor(fieldPosition);
    vec2 fieldMix = fract(fieldPosition);
    vec4 terrain = vec4(0.0);

    for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
            vec2 texel = clamp(fieldBase + vec2(float(x), float(y)), vec2(0.0), uCanvasSize - 1.0);
            vec2 encoded = texture(uTerrainField, (texel + 0.5) / uCanvasSize).rg;
            float typeIndex = floor(encoded.r * 255.0 + 0.5);
            float weight = mix(1.0 - fieldMix.x, fieldMix.x, float(x))
                * mix(1.0 - fieldMix.y, fieldMix.y, float(y));
            vec3 color = texture(uTerrainPalette, vec2((typeIndex + 0.5) / 256.0, 0.5)).rgb;
            terrain += vec4(color * encoded.g, encoded.g) * weight;
        }
    }

    float total = terrain.a;
    if (total < 0.02) discard;

    // 类型索引本身不能线性插值；先取四邻域各自的调色板颜色，再手工混色。
    vec3 color = terrain.rgb / total;

    // 覆盖度→软边：地形场外缘保留了笔画的抗锯齿 fringe（见 terrainField 合并注释），
    // smoothstep 把它压成约 1 场景像素的柔和过渡；内部覆盖度=1 → 完全不透明。
    float alpha = smoothstep(0.30, 0.80, total);
    if (alpha < 0.004) discard;
    finalColor = vec4(color * alpha, alpha);
}
`

function createTerrainPalette(params: MapStyleParameterRecord): Texture {
    const configured = params.terrainKinds
    const data = new Uint8Array(256 * 4)
    for (let index = 0; index < 256; index++) data[index * 4 + 3] = 255
    for (const definition of MAP_TERRAIN_KINDS) {
        const fallback = parseColorToVec3(definition.semanticColor, [0, 0, 0])
        const kindConfig = configured && typeof configured === 'object' && !Array.isArray(configured)
            ? configured[definition.id]
            : null
        const configuredColor = kindConfig && typeof kindConfig === 'object' && !Array.isArray(kindConfig)
            ? kindConfig.color
            : null
        const color = parseColorToVec3(
            typeof configuredColor === 'string' ? configuredColor : definition.semanticColor,
            fallback,
        )
        const offset = definition.order * 4
        data[offset] = Math.round(color[0] * 255)
        data[offset + 1] = Math.round(color[1] * 255)
        data[offset + 2] = Math.round(color[2] * 255)
    }
    return new Texture({
        source: new BufferImageSource({
            resource: data,
            width: 256,
            height: 1,
            format: 'rgba8unorm',
            alphaMode: 'no-premultiply-alpha',
            scaleMode: 'nearest',
            label: 'map-terrain-palette',
        }),
    })
}

function createTerrainShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const palette = createTerrainPalette(params)
    const shader = createSceneQuadShader({
        name: 'map-terrain',
        fragment: terrainFragment,
        useCoastField: true,
        useTerrainField: true,
        textureResources: {uTerrainPalette: palette.source},
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => {
            shader.destroy()
            palette.destroy(true)
        },
    }
}

export const terrainPlugin: PixiPluginImplementation = {
    id: 'terrain',
    pluginType: 'decoration',
    createShaderRenderer: createTerrainShaderRenderer,
}
