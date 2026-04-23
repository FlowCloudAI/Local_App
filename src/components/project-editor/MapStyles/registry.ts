import {flatMapVisualStyle} from './presets/flat'
import type {MapVisualStyle} from './types'

const BUILTIN_MAP_VISUAL_STYLES: MapVisualStyle[] = [
    flatMapVisualStyle,
]

const fallbackStyle = flatMapVisualStyle

export function listMapVisualStyles(): MapVisualStyle[] {
    return BUILTIN_MAP_VISUAL_STYLES
}

export function getMapVisualStyle(styleId: string): MapVisualStyle {
    return BUILTIN_MAP_VISUAL_STYLES.find(style => style.id === styleId) ?? fallbackStyle
}
