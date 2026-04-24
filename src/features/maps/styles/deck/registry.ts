import {readableDeckMapStyle} from './presets/readable'
import type {DeckMapStyle} from './types'

const BUILTIN_DECK_MAP_STYLES: DeckMapStyle[] = [
    readableDeckMapStyle,
]

export function listDeckMapStyles(): DeckMapStyle[] {
    return BUILTIN_DECK_MAP_STYLES
}

export function getDeckMapStyle(styleId: string): DeckMapStyle {
    return BUILTIN_DECK_MAP_STYLES.find(style => style.id === styleId) ?? readableDeckMapStyle
}
