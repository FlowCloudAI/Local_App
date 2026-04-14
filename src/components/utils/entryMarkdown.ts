import {openUrl} from '@tauri-apps/plugin-opener'

const INTERNAL_ENTRY_HREF_PREFIX = 'entry://'
const LEGACY_ENTRY_HREF_PREFIX = 'entry-title://'

export type InternalEntryLink = {
    entryId: string | null
    title: string
}

export function buildInternalEntryHref(entryId: string): string {
    return `${INTERNAL_ENTRY_HREF_PREFIX}${encodeURIComponent(entryId)}`
}

export function buildLegacyEntryHref(title: string): string {
    return `${LEGACY_ENTRY_HREF_PREFIX}${encodeURIComponent(title)}`
}

export function buildInternalEntryMarkdown(title: string, entryId: string): string {
    return `[${title}](${buildInternalEntryHref(entryId)})`
}

export function parseInternalEntryLinks(content?: string | null): InternalEntryLink[] {
    if (!content) return []

    const links: InternalEntryLink[] = []
    const markdownMatches = content.matchAll(/\[([^\]\n]+?)]\(entry:\/\/([^)]+)\)/g)
    for (const match of markdownMatches) {
        const title = String(match[1] ?? '').trim()
        const entryId = decodeURIComponent(String(match[2] ?? '').trim())
        if (!title || !entryId) continue
        links.push({title, entryId})
    }

    const wikiMatches = content.matchAll(/\[\[([^[\]\n]+?)]]/g)
    for (const match of wikiMatches) {
        const title = String(match[1] ?? '').trim()
        if (!title) continue
        links.push({title, entryId: null})
    }

    return links
}

export function buildMarkdownPreviewSource(content: string): string {
    return content.replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
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

export function parseInternalEntryHref(href: string, fallbackTitle = ''): InternalEntryLink | null {
    if (href.startsWith(INTERNAL_ENTRY_HREF_PREFIX)) {
        const entryId = decodeURIComponent(href.slice(INTERNAL_ENTRY_HREF_PREFIX.length)).trim()
        if (!entryId) return null
        return {
            entryId,
            title: fallbackTitle.trim(),
        }
    }

    if (href.startsWith(LEGACY_ENTRY_HREF_PREFIX)) {
        const title = decodeURIComponent(href.slice(LEGACY_ENTRY_HREF_PREFIX.length)).trim()
        if (!title) return null
        return {
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
