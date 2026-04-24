import type {CSSProperties} from 'react'
import type {
    MapEditorCanvas,
    MapPreviewKeyLocationStyle,
    MapPreviewLabelStyle,
    MapPreviewScene,
    MapPreviewShapeStyle,
    MapRgbaColor,
} from 'flowcloudai-ui'

export type MapStyleParameterValue = string | number | boolean | null
export type MapStyleParameterRecord = Record<string, MapStyleParameterValue | MapStyleParameterValue[]>

export interface MapStylePaintToken {
    color: string
    opacity?: number
}

export interface MapStyleStrokeToken extends MapStylePaintToken {
    width: number
    dashArray?: [number, number]
}

export interface MapStyleBackgroundImageToken {
    kind: 'solid' | 'generated-texture' | 'image'
    color?: string
    texture?: string
    url?: string
    opacity?: number
    fit?: 'fill' | 'cover' | 'contain'
    params?: MapStyleParameterRecord
}

export interface MapStyleCompileContext<Style> {
    style: Style
    canvas: MapEditorCanvas
    scene: MapPreviewScene
}

export interface MapStyleCompiledBase {
    scene: MapPreviewScene
    viewportStyle?: CSSProperties
    shapeStyle?: MapPreviewShapeStyle
    keyLocationStyle?: MapPreviewKeyLocationStyle
    labelStyle?: MapPreviewLabelStyle
}

export type RgbaColorInput = string | MapRgbaColor
