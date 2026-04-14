import {convertFileSrc} from '@tauri-apps/api/core'
import type {FCImage} from '../../api'

export type EntryImage = FCImage & {
    is_cover?: boolean
}

export function normalizeEntryImages(images?: FCImage[] | null): EntryImage[] {
    if (!images?.length) return []

    const normalized = images.map((image) => ({
        ...image,
        is_cover: Boolean((image as EntryImage).is_cover),
    }))

    if (!normalized.some((image) => image.is_cover)) {
        normalized[0] = {
            ...normalized[0],
            is_cover: true,
        }
    }

    return normalized
}

export function toEntryImageSrc(image?: FCImage | null): string | undefined {
    const raw = image?.url || image?.path
    if (!raw) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(raw)) return raw
    return convertFileSrc(String(raw), 'fcimg')
}

export function getCoverImage(images: EntryImage[]): EntryImage | null {
    return images.find((image) => image.is_cover) || images[0] || null
}
