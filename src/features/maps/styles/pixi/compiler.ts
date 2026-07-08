import {log_message} from '../../../../api'
import type {MapStyleCompileContext} from '../common'
import {isMapDebugLogEnabled, makeSolidBackgroundDataUrl, mapRenderScale, paintToRgbaColor, strokeToRgbaColor,} from '../common'
import type {CompiledPixiMapStyle, PixiLocationColorRule, PixiLocationIconRule, PixiMapStyle} from './types'
import {buildPixiLocationIconAsset, createPixiPaperTextureAsset} from './assets'
import {createPixiOverlayRenderer} from './overlays'

function pixiLog(msg: string) {
    if (!isMapDebugLogEnabled()) return
    void log_message('info', `[PixiCompiler] ${msg}`)
}

function colorToHexString(color: [number, number, number, number]): string {
    return `#${color.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function matchLocationTypeRule(type: string, rule: Pick<PixiLocationColorRule | PixiLocationIconRule, 'typePattern' | 'typeIncludes'>): boolean {
    if (rule.typeIncludes?.some(token => type.includes(token))) return true
    if (!rule.typePattern) return false

    try {
        return new RegExp(rule.typePattern).test(type)
    } catch {
        return false
    }
}

function resolveLocationColor(type: string, style: PixiMapStyle): [number, number, number, number] {
    const rule = style.locations.colorRules?.find(item => matchLocationTypeRule(type, item))
    return paintToRgbaColor({
        color: rule?.color ?? style.locations.marker.color,
        opacity: rule?.opacity ?? 1,
    })
}

function resolveLocationIconRule(type: string, style: PixiMapStyle): PixiLocationIconRule | undefined {
    return style.locations.iconRules?.find(rule => matchLocationTypeRule(type, rule))
}

function resolvePixiBackgroundImage({style, canvas}: MapStyleCompileContext<PixiMapStyle>) {
    const background = style.background

    if (background.kind === 'image' && background.url) {
        return {
            url: background.url,
            opacity: background.opacity ?? 1,
            fit: background.fit ?? 'cover',
        }
    }

    if (background.kind === 'generated-texture') {
        // 超采样生成，再按场景尺寸显示 → 放大时纸纹更锐利。
        const scale = mapRenderScale(canvas.width, canvas.height)
        const textureUrl = createPixiPaperTextureAsset(
            background.texture,
            Math.round(canvas.width * scale),
            Math.round(canvas.height * scale),
        )

        if (textureUrl) {
            return {
                url: textureUrl,
                opacity: background.opacity ?? 1,
                fit: 'fill' as const,
            }
        }
    }

    return {
        url: makeSolidBackgroundDataUrl(background.color ?? style.palette.ocean),
        opacity: background.opacity ?? 1,
        fit: 'fill' as const,
    }
}

export function compilePixiMapStyle(context: MapStyleCompileContext<PixiMapStyle>): CompiledPixiMapStyle {
    try {
        const {style, scene} = context
        pixiLog(`compile enter: styleId=${style.id} shapes=${scene.shapes.length} keyLocs=${scene.keyLocations.length} bgKind=${style.background.kind}`)

        const markerStroke = style.locations.marker.stroke
        const bgResult = resolvePixiBackgroundImage(context)
        pixiLog(`background resolved: fit=${bgResult.fit} urlLen=${bgResult.url.length} urlPrefix=${bgResult.url.slice(0, 60)}`)

        const compiledScene = {
            ...scene,
            backgroundImage: bgResult,
            shapes: scene.shapes.map(shape => ({
                ...shape,
                fillColor: paintToRgbaColor(style.regions.fill),
                lineColor: strokeToRgbaColor(style.regions.stroke),
            })),
            keyLocations: scene.keyLocations.map(location => {
                const color = resolveLocationColor(location.type, style)
                const iconRule = resolveLocationIconRule(location.type, style)
                const iconSet = iconRule?.iconSet ?? style.locations.iconSet
                const iconColor = iconRule?.color ?? colorToHexString(color)
                const icon = iconSet
                    ? buildPixiLocationIconAsset({
                        iconSet,
                        asset: iconRule?.asset,
                        type: location.type,
                        color: iconColor,
                    })
                    : undefined

                return {
                    ...location,
                    color,
                    icon,
                    iconSize: icon ? iconRule?.iconSize ?? style.locations.marker.iconSize : undefined,
                }
            }),
        }

        const overlayRenderer = createPixiOverlayRenderer(style)
        pixiLog(`overlayRenderer: ${overlayRenderer ? 'present' : 'undefined'}`)

        const result: CompiledPixiMapStyle = {
            renderer: 'pixi',
            scene: compiledScene,
            viewportStyle: {
                backgroundColor: style.background.color ?? style.palette.ocean,
            },
            shapeStyle: {
                lineWidth: style.regions.stroke.width,
            },
            keyLocationStyle: {
                renderMode: style.locations.renderMode,
                radius: style.locations.marker.radius,
                strokeColor: markerStroke ? strokeToRgbaColor(markerStroke) : undefined,
                strokeWidth: markerStroke?.width,
                showStroke: Boolean(markerStroke),
                iconSize: style.locations.marker.iconSize,
            },
            labelStyle: {
                fontSize: style.labels.fontSize,
                color: paintToRgbaColor({
                    color: style.labels.color,
                    opacity: 1,
                }),
                fontFamily: style.labels.fontFamily,
                fontWeight: style.labels.fontWeight,
            },
            pixiProps: {
                style: {
                    backgroundColor: style.background.color ?? style.palette.ocean,
                },
                showLabels: style.labels.show && style.labels.renderer !== 'overlay',
                keyLocationRenderMode: style.locations.renderMode,
                emptyHint: '当前 Pixi 风格暂无可渲染的场景。',
                renderOverlay: overlayRenderer,
            },
        }

        pixiLog(`compile ok: sceneShapes=${result.scene.shapes.length} sceneKeyLocs=${result.scene.keyLocations.length} showLabels=${result.pixiProps.showLabels}`)
        return result
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        pixiLog(`compile FAILED: ${errMsg}`)
        throw e
    }
}
