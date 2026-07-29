/**
 * 选中文本悬浮工具栏的放置判断；只在选区外有足够空间时返回位置。
 */
export type SelectionToolbarPlacement = 'above' | 'below'

export function resolveSelectionToolbarPlacement({
    selectionTop,
    selectionBottom,
    visibleTop,
    visibleBottom,
    pointerY,
}: {
    selectionTop: number
    selectionBottom: number
    visibleTop: number
    visibleBottom: number
    pointerY?: number
}): SelectionToolbarPlacement | null {
    const canPlaceAbove = selectionTop - visibleTop >= 48
    const canPlaceBelow = visibleBottom - selectionBottom >= 48
    const prefersBelow = pointerY !== undefined && pointerY > (selectionTop + selectionBottom) / 2
    if (prefersBelow) return canPlaceBelow ? 'below' : canPlaceAbove ? 'above' : null
    return canPlaceAbove ? 'above' : canPlaceBelow ? 'below' : null
}
