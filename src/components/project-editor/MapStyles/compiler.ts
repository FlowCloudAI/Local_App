import {compileDeckFallback} from './deck/compileDeckFallback'
import {compilePixiStyle} from './pixi/compilePixiStyle'
import type {CompiledMapVisualStyle, MapStyleCompileInput} from './types'

export function compileMapVisualStyle(input: MapStyleCompileInput): CompiledMapVisualStyle {
    if (input.renderer === 'pixi') {
        return compilePixiStyle(input)
    }

    return compileDeckFallback(input)
}
