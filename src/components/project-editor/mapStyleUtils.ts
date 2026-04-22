import {PostProcessEffect} from '@deck.gl/core'
import type {Effect} from '@deck.gl/core'
import type {MapDeckShaderInject} from 'flowcloudai-ui'

export type MapStyle = 'flat' | 'tolkien' | 'ink'

export interface MapStyleDeckConfig {
    polygonShaderInject?: MapDeckShaderInject
    polygonLayerProps?: Record<string, unknown>
    scatterplotLayerProps?: Record<string, unknown>
    iconLayerProps?: Record<string, unknown>
    textLayerProps?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckEffects?: any[]
}

// ── Texture Generation ────────────────────────────────────────────────────────

export function createParchmentTexture(width: number, height: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    // 暖黄底色
    ctx.fillStyle = '#e8d5b5'
    ctx.fillRect(0, 0, width, height)

    // 纤维纹理
    for (let i = 0; i < 600; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const len = 20 + Math.random() * 80
        const angle = (Math.random() - 0.5) * Math.PI
        ctx.globalAlpha = 0.03 + Math.random() * 0.06
        ctx.strokeStyle = Math.random() > 0.5 ? '#8b6914' : '#c2a86b'
        ctx.lineWidth = 0.5 + Math.random() * 1.5
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    // 随机斑点（霉斑/岁月痕迹）
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const r = 2 + Math.random() * 8
        ctx.globalAlpha = 0.02 + Math.random() * 0.05
        ctx.fillStyle = Math.random() > 0.5 ? '#6b4c1e' : '#a08050'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
    }

    ctx.globalAlpha = 1
    return canvas.toDataURL('image/png')
}

export function createRicePaperTexture(width: number, height: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    // 米白底色
    ctx.fillStyle = '#f5f3ee'
    ctx.fillRect(0, 0, width, height)

    // 全局噪点
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 12
        data[i] = Math.min(255, Math.max(0, data[i] + noise))
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise))
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    // 纸纤维
    for (let i = 0; i < 400; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const len = 10 + Math.random() * 40
        const angle = (Math.random() - 0.5) * 0.5
        ctx.globalAlpha = 0.04 + Math.random() * 0.08
        ctx.strokeStyle = '#b0a898'
        ctx.lineWidth = 0.3 + Math.random() * 0.8
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    ctx.globalAlpha = 1
    return canvas.toDataURL('image/png')
}

// ── PostProcessEffects ────────────────────────────────────────────────────────

export function createVignetteEffect(): Effect {
    const vignetteModule = {
        name: 'vignette',
        fs: `
            vec4 vignette_filterColor_ext(vec4 color, vec2 texSize, vec2 coord) {
                vec2 center = vec2(0.5, 0.5);
                float dist = distance(coord, center);
                float radius = 0.75;
                float amount = 0.45;
                float mask = smoothstep(radius, radius * 0.35, dist);
                color.rgb *= mix(1.0 - amount, 1.0, mask);
                return color;
            }
        `,
        passes: [{filter: true}],
        defaultUniforms: {},
        uniformTypes: {},
    }
    return new (PostProcessEffect as unknown as new (m: typeof vignetteModule, p: Record<string, never>) => Effect)(
        vignetteModule,
        {}
    )
}

export function createInkBleedEffect(): Effect {
    const inkBleedModule = {
        name: 'inkBleed',
        fs: `
            vec4 inkBleed_sampleColor(sampler2D texSrc, vec2 texSize, vec2 coord) {
                vec2 texel = 1.0 / texSize;
                vec4 center = texture(texSrc, coord);

                // 3x3 加权模糊（近似高斯）
                vec4 sum = center * 4.0;
                sum += texture(texSrc, coord + vec2(-texel.x, -texel.y)) * 2.0;
                sum += texture(texSrc, coord + vec2( texel.x, -texel.y)) * 2.0;
                sum += texture(texSrc, coord + vec2(-texel.x,  texel.y)) * 2.0;
                sum += texture(texSrc, coord + vec2( texel.x,  texel.y)) * 2.0;
                sum += texture(texSrc, coord + vec2(-texel.x, 0.0)) * 1.0;
                sum += texture(texSrc, coord + vec2( texel.x, 0.0)) * 1.0;
                sum += texture(texSrc, coord + vec2(0.0, -texel.y)) * 1.0;
                sum += texture(texSrc, coord + vec2(0.0,  texel.y)) * 1.0;
                vec4 blurred = sum / 16.0;

                float lum = dot(center.rgb, vec3(0.299, 0.587, 0.114));
                float ink = 1.0 - lum;
                float alpha = center.a;

                // 暗色向外晕染
                vec4 result = mix(center, blurred, ink * 0.4 * alpha);
                // 轻微压暗晕染区，增加墨的堆积感
                result.rgb *= (1.0 - ink * 0.08);
                return result;
            }
        `,
        passes: [{sampler: true}],
        defaultUniforms: {},
        uniformTypes: {},
    }
    return new (PostProcessEffect as unknown as new (m: typeof inkBleedModule, p: Record<string, never>) => Effect)(
        inkBleedModule,
        {}
    )
}

// ── Style Configuration Builder ───────────────────────────────────────────────

export function buildDeckStyleConfig(style: MapStyle): MapStyleDeckConfig {
    switch (style) {
        case 'flat':
            return buildFlatConfig()
        case 'tolkien':
            return buildTolkienConfig()
        case 'ink':
            return buildInkConfig()
        default:
            return buildFlatConfig()
    }
}

function buildFlatConfig(): MapStyleDeckConfig {
    return {
        polygonShaderInject: {},
        polygonLayerProps: {
            lineWidthMinPixels: 2,
            getFillColor: () => [255, 255, 255, 255] as [number, number, number, number],
        },
        scatterplotLayerProps: {
            getRadius: 8,
            radiusMaxPixels: 18,
            stroked: true,
            getLineColor: () => [255, 255, 255, 255] as [number, number, number, number],
            lineWidthMinPixels: 2,
        },
        iconLayerProps: undefined,
        textLayerProps: {
            getSize: 13,
            getColor: () => [38, 43, 56, 255] as [number, number, number, number],
            fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        },
        deckEffects: undefined,
    }
}

function buildTolkienConfig(): MapStyleDeckConfig {
    const tolkienInject: MapDeckShaderInject = {
        'fs:DECKGL_FILTER_COLOR': `
            float lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
            color.r = min(lum * 1.40 + 0.13, 1.0);
            color.g = min(lum * 1.12 + 0.07, 1.0);
            color.b = min(lum * 0.68, 1.0);
            color.a *= 0.88;
            // 细微噪点抖动，模拟墨水在羊皮纸上的不均匀沉积
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
            color.rgb *= (0.96 + n * 0.08);
        `,
    }

    return {
        polygonShaderInject: tolkienInject,
        polygonLayerProps: {
            lineWidthMinPixels: 2.5,
        },
        scatterplotLayerProps: {
            getRadius: 7,
            radiusMaxPixels: 16,
            stroked: true,
            getLineColor: () => [245, 232, 199, 255] as [number, number, number, number],
            lineWidthMinPixels: 2,
        },
        iconLayerProps: {
            getSize: 30,
        },
        textLayerProps: {
            getSize: 15,
            getColor: () => [92, 59, 34, 255] as [number, number, number, number],
            fontFamily: '"Georgia", "Times New Roman", "STSong", serif',
        },
        deckEffects: [createVignetteEffect()],
    }
}

function buildInkConfig(): MapStyleDeckConfig {
    const inkInject: MapDeckShaderInject = {
        'fs:DECKGL_FILTER_COLOR': `
            float lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
            float darkness = 1.0 - lum;
            color.r = lum;
            color.g = lum;
            color.b = lum * 0.94;
            color.a *= 0.4 + darkness * 0.55;
            // 向墨色偏移
            color.rgb = mix(color.rgb, vec3(0.05, 0.05, 0.06), 0.15);
        `,
    }

    return {
        polygonShaderInject: inkInject,
        polygonLayerProps: {
            lineWidthMinPixels: 8,
            getLineColor: () => [20, 20, 20, 110] as [number, number, number, number],
            getFillColor: (s: {fillColor: [number, number, number, number]}) =>
                [s.fillColor[0], s.fillColor[1], s.fillColor[2], 60] as [number, number, number, number],
        },
        scatterplotLayerProps: {
            getRadius: 6,
            radiusMaxPixels: 14,
            stroked: true,
            getLineColor: () => [255, 255, 255, 235] as [number, number, number, number],
            lineWidthMinPixels: 1.5,
        },
        iconLayerProps: {
            getSize: 28,
        },
        textLayerProps: {
            getSize: 14,
            getColor: () => [15, 15, 15, 240] as [number, number, number, number],
            fontFamily: '"STKaiti", "KaiTi", "FangSong", serif',
        },
        deckEffects: [createInkBleedEffect()],
    }
}
