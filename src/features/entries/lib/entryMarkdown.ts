import {openUrl} from '../../../api/opener'
import type {FCImage} from '../../../api'
import {resolveEntryImageByMarkdownRef, toEntryImageSrc} from './entryImage'

const INTERNAL_ENTRY_HREF_PREFIX = 'fc://'
const LEGACY_INTERNAL_ENTRY_HREF_PREFIX = 'entry://'
const LEGACY_ENTRY_HREF_PREFIX = 'entry-title://'
const SELF_PROJECT_ID = 'self'

export type InternalEntryLink = {
    projectId: string | null
    entryId: string | null
    title: string
    isSelfProject?: boolean
}

export function buildInternalEntryHref(entryId: string, projectId?: string | null): string {
    if (projectId) {
        return `${INTERNAL_ENTRY_HREF_PREFIX}${SELF_PROJECT_ID}/entry/${encodeURIComponent(entryId)}`
    }
    return `${LEGACY_INTERNAL_ENTRY_HREF_PREFIX}${encodeURIComponent(entryId)}`
}

export function buildLegacyEntryHref(title: string): string {
    return `${LEGACY_ENTRY_HREF_PREFIX}${encodeURIComponent(title)}`
}

export function buildInternalEntryMarkdown(title: string, entryId: string, projectId?: string | null): string {
    return `[${title}](${buildInternalEntryHref(entryId, projectId)})`
}

export function parseInternalEntryLinks(content?: string | null): InternalEntryLink[] {
    if (!content) return []

    const links: InternalEntryLink[] = []
    const markdownMatches = content.matchAll(/\[([^\]\n]+?)]\(((?:fc|entry):\/\/[^)]+)\)/g)
    for (const match of markdownMatches) {
        const title = String(match[1] ?? '').trim()
        const link = parseInternalEntryHref(String(match[2] ?? '').trim(), title)
        if (!title || !link?.entryId) continue
        links.push(link)
    }

    const wikiMatches = content.matchAll(/\[\[([^[\]\n]+?)]]/g)
    for (const match of wikiMatches) {
        const title = String(match[1] ?? '').trim()
        if (!title) continue
        links.push({title, projectId: null, entryId: null})
    }

    return links
}

function encodeMarkdownUrl(value: string): string {
    return value.replace(/[\s()]/g, (char) => encodeURIComponent(char))
}

function buildImagePreviewSource(content: string, images: FCImage[]): string {
    if (!images.length || !/!\[[^\]\n]*]\((?:fcimg:|fc:\/\/[^)\s]+\/image\/)/i.test(content)) return content

    return content.replace(/!\[([^\]\n]*)]\(((?:fcimg:|fc:\/\/[^)\s]+\/image\/)[^)]+)\)/gi, (match, alt, rawSrc) => {
        const image = resolveEntryImageByMarkdownRef(String(rawSrc).trim(), images)
        const src = toEntryImageSrc(image)
        if (!src) return match
        return `![${alt}](${encodeMarkdownUrl(src)})`
    })
}

export function buildMarkdownPreviewSource(content: string, images: FCImage[] = []): string {
    const withImages = buildImagePreviewSource(content, images)
    return withImages.replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
        const title = String(rawTitle).trim()
        return `[${title}](${buildLegacyEntryHref(title)})`
    })
}

export function stripMarkdown(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function buildExcerpt(value?: string | null, maxLength = 120): string {
    const normalized = stripMarkdown(value ?? '')
    if (!normalized) return '暂无正文'
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

export function resolveMarkdownAnchor(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null
    return target.closest('a') as HTMLAnchorElement | null
}

export function isSafeExternalHref(href: string): boolean {
    return /^(https?:|mailto:|tel:)/i.test(href)
}

export function resolveInternalEntryProjectId(
    link: { projectId?: string | null; isSelfProject?: boolean },
    currentProjectId?: string | null,
): string | null {
    return link.isSelfProject ? (currentProjectId?.trim() || null) : (link.projectId ?? null)
}

export function parseInternalEntryHref(href: string, fallbackTitle = ''): InternalEntryLink | null {
    if (href.startsWith(INTERNAL_ENTRY_HREF_PREFIX)) {
        const value = href.slice(INTERNAL_ENTRY_HREF_PREFIX.length).trim()
        const parts = value.split('/')
        const projectId = decodeURIComponent(parts[0] ?? '').trim()
        if (parts.length !== 3 || parts[1] !== 'entry' || !projectId) return null
        const entryId = decodeURIComponent(parts[2] ?? '').trim()
        if (!entryId) return null
        const isSelfProject = projectId.toLowerCase() === SELF_PROJECT_ID
        return {
            projectId: isSelfProject ? null : projectId,
            entryId,
            title: fallbackTitle.trim(),
            isSelfProject,
        }
    }

    if (href.startsWith(LEGACY_INTERNAL_ENTRY_HREF_PREFIX)) {
        const value = href.slice(LEGACY_INTERNAL_ENTRY_HREF_PREFIX.length).trim()
        const separatorIndex = value.indexOf('/')
        const projectId = separatorIndex >= 0
            ? decodeURIComponent(value.slice(0, separatorIndex)).trim()
            : null
        const entryId = decodeURIComponent(separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value).trim()
        if (!entryId) return null
        return {
            projectId: projectId || null,
            entryId,
            title: fallbackTitle.trim(),
        }
    }

    if (href.startsWith(LEGACY_ENTRY_HREF_PREFIX)) {
        const title = decodeURIComponent(href.slice(LEGACY_ENTRY_HREF_PREFIX.length)).trim()
        if (!title) return null
        return {
            projectId: null,
            entryId: null,
            title,
        }
    }

    return null
}

export function openExternalLink(href: string): void {
    if (isSafeExternalHref(href)) {
        void openUrl(href)
    }
}
