import type {Effect} from '@deck.gl/core'
import {PostProcessEffect} from '@deck.gl/core'

/**
 * 暗角后处理效果——边缘向中心逐渐变暗，模拟古地图/老照片氛围。
 * 降低 amount 至 0.15，避免遮压纹理与装饰元素。
 */
export function createVignetteEffect(): Effect {
    const vignetteModule = {
        name: 'vignette',
        fs: `
            vec4 vignette_filterColor_ext(vec4 color, vec2 texSize, vec2 coord) {
                vec2 center = vec2(0.5, 0.5);
                float dist = distance(coord, center);
                float radius = 0.75;
                float amount = 0.15;
                float mask = smoothstep(radius, radius * 0.30, dist);
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

/**
 * 水墨晕染后处理效果——根据亮度和细微噪声压低墨色边缘的锐利感，
 * 让线条和点位在宣纸底上有轻微渗化效果。
 */
export function createInkBleedEffect(): Effect {
    const inkBleedModule = {
        name: 'inkBleed',
        fs: `
            vec4 inkBleed_filterColor_ext(vec4 color, vec2 texSize, vec2 coord) {
                float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                float ink = smoothstep(0.82, 0.18, lum) * color.a;
                float grainA = fract(sin(dot(coord * texSize, vec2(91.17, 37.43))) * 45758.5453);
                float grainB = fract(sin(dot(coord * texSize + 17.0, vec2(23.19, 71.91))) * 24634.6345);
                float bloom = smoothstep(0.25, 1.0, ink) * (0.55 + grainA * 0.45);

                vec3 paperTone = vec3(0.965, 0.952, 0.915);
                vec3 inkTone = vec3(0.055, 0.055, 0.058);
                color.rgb = mix(color.rgb, inkTone, bloom * 0.055);
                color.rgb = mix(color.rgb, paperTone, (1.0 - ink) * 0.018 * grainB);
                color.a = min(1.0, color.a + bloom * 0.035);
                return color;
            }
        `,
        passes: [{filter: true}],
        defaultUniforms: {},
        uniformTypes: {},
    }
    return new (PostProcessEffect as unknown as new (m: typeof inkBleedModule, p: Record<string, never>) => Effect)(
        inkBleedModule,
        {}
    )
}
