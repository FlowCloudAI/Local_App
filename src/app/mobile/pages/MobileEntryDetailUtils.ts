import {type Entry} from '../../../api'
import {buildTagValueMap} from '../../../features/entries/lib/entryCommon'
import {type EntryImage} from '../../../features/entries/lib/entryImage'
import {type EntryTagRuntimeValue} from '../../../features/entries/components/entryTagUtils'

export type TagValueMap = Record<string, EntryTagRuntimeValue>

/** 保留 schema 标签和桌面端使用的额外标签（如角色语音配置），避免移动端保存时丢字段。 */
export function buildTagDraft(entry: Entry): TagValueMap {
    return buildTagValueMap(entry)
}

export function areImagesEqual(left: EntryImage[], right: EntryImage[]): boolean {
    if (left.length !== right.length) return false
    return left.every((image, index) => {
        const target = right[index]
        return image.path === target.path
            && image.url === target.url
            && image.alt === target.alt
            && image.caption === target.caption
            && Boolean(image.is_cover) === Boolean(target.is_cover)
    })
}

export function escapeMarkdownImageAlt(value: string): string {
    return value.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function getImageLabel(image: EntryImage, index: number): string {
    if (image.alt) return image.alt
    if (image.caption) return image.caption
    const raw = image.path ?? image.url ?? ''
    const fileName = String(raw).split(/[\\/]/).pop()
    return fileName || `图片 ${index + 1}`
}

export function appendImages(current: EntryImage[], incoming: EntryImage[]): EntryImage[] {
    const nextImages = [...current]
    incoming.forEach((image, index) => {
        nextImages.push({
            ...image,
            is_cover: nextImages.length === 0 && index === 0,
        })
    })
    return nextImages
}

function stripMarkdown(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function buildExcerpt(value?: string | null, maxLength = 64): string {
    const normalized = stripMarkdown(value ?? '')
    if (!normalized) return ''
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}
