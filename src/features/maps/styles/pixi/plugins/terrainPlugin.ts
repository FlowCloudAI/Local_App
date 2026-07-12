import {BufferImageSource, Texture} from 'pixi.js'
import {MAP_TERRAIN_KINDS} from '../../../components/MapShapeEditor'
import type {MapStyleParameterRecord} from '../../common'
import type {PixiPluginImplementation, ShaderRenderer} from '../types'
import {parseColorToVec3} from '../shaderRegistry'
import {coastFieldGlsl, createSceneQuadShader, updateSceneQuadShader, valueNoiseGlsl} from './shared'

const TERRAIN_PATTERN_CODES: Readonly<Record<string, number>> = {
    none: 0,
    'flat-grass': 1,
    'flat-mountain': 2,
    'flat-desert': 3,
    'tolkien-grass': 4,
    'tolkien-desert': 5,
    'ink-grass': 6,
    'ink-desert': 7,
}

const terrainFragment = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec2 uCanvasSize;
uniform sampler2D uTerrainField;
uniform sampler2D uTerrainBasePalette;
uniform sampler2D uTerrainDetailPalette;
uniform sampler2D uTerrainRecipePalette;
uniform float uOrganicStrength;

${coastFieldGlsl}
${valueNoiseGlsl}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h);
}

float bladeGlyph(vec2 local, float width) {
    float left = sdSegment(local, vec2(0.0, 0.35), vec2(-0.16, -0.12));
    float middle = sdSegment(local, vec2(0.0, 0.35), vec2(0.01, -0.28));
    float right = sdSegment(local, vec2(0.0, 0.35), vec2(0.18, -0.08));
    return 1.0 - smoothstep(width, width + 0.035, min(left, min(middle, right)));
}

float chevronGlyph(vec2 local, float width) {
    float left = sdSegment(local, vec2(-0.34, 0.22), vec2(0.0, -0.26));
    float right = sdSegment(local, vec2(0.0, -0.26), vec2(0.34, 0.22));
    float ridge = sdSegment(local, vec2(-0.22, 0.12), vec2(0.22, 0.12));
    return 1.0 - smoothstep(width, width + 0.035, min(min(left, right), ridge));
}

float terrainPattern(float code, vec2 position, float scale) {
    vec2 grid = position / max(scale, 4.0);
    vec2 cell = floor(grid);
    vec2 local = fract(grid) - 0.5;
    float random = hash(cell + vec2(code * 13.7, code * 7.9));
    local += vec2(hash(cell + 17.3), hash(cell + 39.1)) * 0.44 - 0.22;
    float glyphScale = 0.70 + hash(cell + 53.7) * 0.60;
    float glyphAngle = (hash(cell + 71.9) - 0.5) * 0.72;
    float cosine = cos(glyphAngle);
    float sine = sin(glyphAngle);
    vec2 grassLocal = mat2(cosine, -sine, sine, cosine) * local / glyphScale;

    if (code < 0.5) return 0.0;
    if (code < 1.5) {
        return bladeGlyph(grassLocal, 0.045) * step(0.18, random);
    }
    if (code < 2.5) {
        return chevronGlyph(local, 0.045) * step(0.12, random);
    }
    if (code < 3.5) {
        float dotMark = 1.0 - smoothstep(0.065, 0.1, length(local));
        return dotMark * step(0.24, random);
    }
    if (code < 4.5) {
        return bladeGlyph(grassLocal, 0.032) * step(0.46, random);
    }
    if (code < 5.5) {
        float stipple = (1.0 - smoothstep(0.035, 0.07, length(local))) * step(0.32, random);
        float dune = 1.0 - smoothstep(0.025, 0.055, abs(length(local - vec2(0.0, 0.18)) - 0.28));
        dune *= step(0.72, random) * step(local.y, 0.22);
        return max(stipple, dune);
    }
    if (code < 6.5) {
        float stroke = 1.0 - smoothstep(0.028, 0.065, sdSegment(grassLocal, vec2(-0.30, 0.18), vec2(0.28, -0.12)));
        float dry = smoothstep(0.36, 0.62, vnoise(position / 3.4));
        return stroke * dry * step(0.38, random);
    }

    float band = 1.0 - smoothstep(0.035, 0.085, abs(local.y + 0.12 * sin(local.x * 8.0 + random * 5.0)));
    float dry = smoothstep(0.48, 0.70, vnoise(position * vec2(0.10, 0.28)));
    return band * dry * step(0.28, random);
}

void main() {
    if (coastSd(vUV) >= 0.0) discard;

    vec2 scenePosition = vUV * uCanvasSize;
    vec2 fieldWarp = (vec2(
        vnoise(scenePosition / 23.0),
        vnoise((scenePosition + vec2(47.0, 113.0)) / 23.0)
    ) - 0.5) * 4.0 * uOrganicStrength;
    vec2 fieldPosition = scenePosition + fieldWarp - 0.5;
    vec2 fieldBase = floor(fieldPosition);
    vec2 fieldMix = fract(fieldPosition);
    vec4 terrain = vec4(0.0);
    float baseOpacitySum = 0.0;

    for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
            vec2 texel = clamp(fieldBase + vec2(float(x), float(y)), vec2(0.0), uCanvasSize - 1.0);
            vec2 encoded = texture(uTerrainField, (texel + 0.5) / uCanvasSize).rg;
            float typeIndex = floor(encoded.r * 255.0 + 0.5);
            float weight = mix(1.0 - fieldMix.x, fieldMix.x, float(x))
                * mix(1.0 - fieldMix.y, fieldMix.y, float(y));
            vec4 base = texture(uTerrainBasePalette, vec2((typeIndex + 0.5) / 256.0, 0.5));
            terrain += vec4(base.rgb * encoded.g, encoded.g) * weight;
            baseOpacitySum += base.a * encoded.g * weight;
        }
    }

    float total = terrain.a;
    if (total < 0.02) discard;

    float broadNoise = vnoise(scenePosition / 68.0);
    float edgeNoise = vnoise(scenePosition / 7.0);
    float organicCoverage = total + (edgeNoise - 0.5) * 0.25 * uOrganicStrength;
    float edgeAlpha = smoothstep(0.30, 0.80, organicCoverage);
    float washVariation = mix(1.0, 0.70 + broadNoise * 0.30, uOrganicStrength);
    vec2 edgeProbe = 3.0 / uCanvasSize;
    float nearbyCoverage = min(
        min(texture(uTerrainField, vUV - vec2(edgeProbe.x, 0.0)).g,
            texture(uTerrainField, vUV + vec2(edgeProbe.x, 0.0)).g),
        min(texture(uTerrainField, vUV - vec2(0.0, edgeProbe.y)).g,
            texture(uTerrainField, vUV + vec2(0.0, edgeProbe.y)).g)
    );
    float sediment = uOrganicStrength * edgeAlpha * (1.0 - nearbyCoverage);

    vec2 centerTexel = clamp(floor(fieldPosition + 0.5), vec2(0.0), uCanvasSize - 1.0);
    vec2 centerEncoded = texture(uTerrainField, (centerTexel + 0.5) / uCanvasSize).rg;
    float centerIndex = floor(centerEncoded.r * 255.0 + 0.5);
    vec4 detail = texture(uTerrainDetailPalette, vec2((centerIndex + 0.5) / 256.0, 0.5));
    vec4 recipe = texture(uTerrainRecipePalette, vec2((centerIndex + 0.5) / 256.0, 0.5));
    float patternCode = floor(recipe.r * 255.0 + 0.5);
    float patternScale = max(4.0, recipe.g * 128.0);
    float pattern = terrainPattern(patternCode, vUV * uCanvasSize, patternScale);
    float detailAlpha = edgeAlpha * detail.a * pattern;

    vec3 baseColor = mix(terrain.rgb / total, detail.rgb, sediment * 0.24);
    float baseAlpha = edgeAlpha * clamp(baseOpacitySum / total, 0.0, 1.0)
        * washVariation * (1.0 + sediment * 0.18);

    float alpha = detailAlpha + baseAlpha * (1.0 - detailAlpha);
    if (alpha < 0.004) discard;
    vec3 premultiplied = detail.rgb * detailAlpha + baseColor * baseAlpha * (1.0 - detailAlpha);
    finalColor = vec4(premultiplied, alpha);
}
`

function getTerrainKindConfig(params: MapStyleParameterRecord, kind: string): MapStyleParameterRecord | null {
    const configured = params.terrainKinds
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return null
    const value = configured[kind]
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function getNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

function createPaletteTexture(
    label: string,
    writeDefinition: (data: Uint8Array, offset: number, definition: (typeof MAP_TERRAIN_KINDS)[number]) => void,
): Texture {
    const data = new Uint8Array(256 * 4)
    for (let index = 0; index < 256; index++) data[index * 4 + 3] = 255
    for (const definition of MAP_TERRAIN_KINDS) {
        writeDefinition(data, definition.order * 4, definition)
    }
    return new Texture({
        source: new BufferImageSource({
            resource: data,
            width: 256,
            height: 1,
            format: 'rgba8unorm',
            alphaMode: 'no-premultiply-alpha',
            scaleMode: 'nearest',
            label,
        }),
    })
}

function writeColor(data: Uint8Array, offset: number, color: [number, number, number]): void {
    data[offset] = Math.round(color[0] * 255)
    data[offset + 1] = Math.round(color[1] * 255)
    data[offset + 2] = Math.round(color[2] * 255)
}

function createTerrainShaderRenderer(params: MapStyleParameterRecord): ShaderRenderer | null {
    const basePalette = createPaletteTexture('map-terrain-base-palette', (data, offset, definition) => {
        const config = getTerrainKindConfig(params, definition.id)
        writeColor(data, offset, parseColorToVec3(
            getString(config?.color, definition.semanticColor),
            parseColorToVec3(definition.semanticColor),
        ))
        data[offset + 3] = Math.round(Math.max(0, Math.min(1, getNumber(config?.baseOpacity, 1))) * 255)
    })
    const detailPalette = createPaletteTexture('map-terrain-detail-palette', (data, offset, definition) => {
        const config = getTerrainKindConfig(params, definition.id)
        const fallbackColor = parseColorToVec3(definition.semanticColor)
        writeColor(data, offset, parseColorToVec3(getString(config?.detailColor, definition.semanticColor), fallbackColor))
        data[offset + 3] = Math.round(Math.max(0, Math.min(1, getNumber(config?.patternOpacity, 0))) * 255)
    })
    const recipePalette = createPaletteTexture('map-terrain-recipe-palette', (data, offset, definition) => {
        const config = getTerrainKindConfig(params, definition.id)
        const pattern = TERRAIN_PATTERN_CODES[getString(config?.pattern, 'none')] ?? 0
        data[offset] = pattern
        data[offset + 1] = Math.round(Math.max(4, Math.min(128, getNumber(config?.patternScale, 24))) / 128 * 255)
        data[offset + 2] = 0
    })
    const shader = createSceneQuadShader({
        name: 'map-terrain',
        fragment: terrainFragment,
        useCoastField: true,
        useTerrainField: true,
        textureResources: {
            uTerrainBasePalette: basePalette.source,
            uTerrainDetailPalette: detailPalette.source,
            uTerrainRecipePalette: recipePalette.source,
        },
        uniforms: {
            uOrganicStrength: {
                value: Math.max(0, Math.min(1, getNumber(params.organicStrength, 0))),
                type: 'f32',
            },
        },
    })

    return {
        type: 'shader',
        shader,
        update: context => updateSceneQuadShader(shader, context),
        destroy: () => {
            shader.destroy()
            basePalette.destroy(true)
            detailPalette.destroy(true)
            recipePalette.destroy(true)
        },
    }
}

export const terrainPlugin: PixiPluginImplementation = {
    id: 'terrain',
    pluginType: 'decoration',
    createShaderRenderer: createTerrainShaderRenderer,
}
