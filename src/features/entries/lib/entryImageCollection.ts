/**
 * 词条图片集合操作：统一桌面端与移动端删除图片后的主图修复规则。
 */

export function removeEntryImages<T extends {is_cover?: boolean}>(images: T[], indices: readonly number[]): T[] {
    const removed = new Set(indices)
    const nextImages = images.filter((_, index) => !removed.has(index))
    if (nextImages.length > 0 && !nextImages.some(image => image.is_cover)) {
        nextImages[0] = {...nextImages[0], is_cover: true}
    }
    return nextImages
}
