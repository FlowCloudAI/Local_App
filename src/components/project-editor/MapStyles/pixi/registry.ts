import {flatPixiMapStyle} from './presets/flat'
import {inkPixiMapStyle} from './presets/ink'
import {tolkienPixiMapStyle} from './presets/tolkien'
import type {PixiMapStyle} from './types'

const BUILTIN_PIXI_MAP_STYLES: PixiMapStyle[] = [
    flatPixiMapStyle,
    tolkienPixiMapStyle,
    inkPixiMapStyle,
]

export function listPixiMapStyles(): PixiMapStyle[] {
    return BUILTIN_PIXI_MAP_STYLES
}

export function getPixiMapStyle(styleId: string): PixiMapStyle {
    return BUILTIN_PIXI_MAP_STYLES.find(style => style.id === styleId) ?? flatPixiMapStyle
}
