import {convertFileSrc} from '@tauri-apps/api/core'
import type {FCImage} from '../../../api'

export type EntryImage = FCImage & {
    is_cover?: boolean
}

const FCIMG_REF_PREFIX = 'fcimg:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function normalizePathSeparators(value: string): string {
    return value.replace(/\\/g, '/')
}

function getFileName(value?: string | null): string | null {
    if (!value) return null
    const normalized = normalizePathSeparators(String(value).split(/[?#]/, 1)[0] ?? '')
    const fileName = normalized.split('/').filter(Boolean).pop()
    return fileName?.trim() || null
}

function getFileStem(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.')
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
}

export function getEntryImageUuid(image?: FCImage | null): string | null {
    const fileName = getFileName(image?.path ? String(image.path) : image?.url ?? null)
    if (!fileName) return null
    const stem = getFileStem(fileName)
    return UUID_PATTERN.test(stem) ? stem : null
}

export function buildEntryImageMarkdownRef(image?: FCImage | null): string | null {
    const uuid = getEntryImageUuid(image)
    return uuid ? `${FCIMG_REF_PREFIX}${uuid}` : null
}

function normalizeFcimgRef(value: string): string | null {
    if (!value.toLowerCase().startsWith(FCIMG_REF_PREFIX)) return null
    const raw = value
        .slice(FCIMG_REF_PREFIX.length)
        .replace(/^\/+/, '')
        .split(/[?#]/, 1)[0]
        .trim()
    if (!raw) return null
    try {
        return decodeURIComponent(raw).toLowerCase()
    } catch {
        return raw.toLowerCase()
    }
}

function buildImageRefCandidates(image: FCImage): string[] {
    const raw = image.path ? String(image.path) : image.url ?? ''
    const fileName = getFileName(raw)
    if (!fileName) return []
    const stem = getFileStem(fileName)
    return [stem, fileName].map((item) => item.toLowerCase())
}

export function resolveEntryImageByFcimgRef(value: string, images: FCImage[]): FCImage | null {
    const normalizedRef = normalizeFcimgRef(value)
    if (!normalizedRef) return null
    return images.find((image) => buildImageRefCandidates(image).includes(normalizedRef)) ?? null
}

export function getCoverImage(images: EntryImage[]): EntryImage | null {
    return images.find((image) => image.is_cover) || images[0] || null
}
