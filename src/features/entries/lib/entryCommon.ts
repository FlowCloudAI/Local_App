import {type Category, db_list_entries, type Entry, type EntryBrief,} from '../../../api'

export function normalizeComparableText(value: string): string {
    return value.replace(/\r\n?/g, '\n').trim()
}

export function normalizeComparableContent(value: string): string {
    return value.replace(/\r\n?/g, '\n')
}

export function normalizeComparableType(value?: string | null): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

export function normalizeEntryContent(entry: Entry): string {
    if (typeof entry.content === 'string') return entry.content
    const rawContent = entry['content']
    return typeof rawContent === 'string' ? rawContent : ''
}

export function buildTagValueMap(entry: Entry): Record<string, string | number | boolean | null> {
    return Object.fromEntries((entry.tags ?? []).map((tag) => [tag.schema_id ?? tag.name ?? '', normalizeTagRuntimeValue(tag.value)]))
}

function normalizeTagRuntimeValue(value: unknown): string | number | boolean | null {
    if (value == null) return null
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value
    }
    if (Array.isArray(value)) return null

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean') {
            return record.value
        }
    }

    return null
}

export function getCategoryName(categories: Category[], categoryId?: string | null): string {
    if (!categoryId) return '未分类'
    return categories.find((category) => category.id === categoryId)?.name ?? '未分类'
}

export function buildEntryPath(projectName: string, categories: Category[], categoryId: string | null | undefined, entryTitle: string): string {
    const categoryMap = new Map(categories.map(category => [category.id, category]))
    const path: string[] = [entryTitle]
    let currentId = categoryId ?? null

    while (currentId) {
        const current = categoryMap.get(currentId)
        if (!current) break
        path.unshift(current.name)
        currentId = current.parent_id ?? null
    }

    path.unshift(projectName)
    return path.join('-')
}

export async function findCategoryDuplicatedEntry(
    projectId: string,
    categoryId: string | null | undefined,
    title: string,
    excludeEntryId?: string,
): Promise<EntryBrief | null> {
    const entries = await db_list_entries({
        projectId,
        categoryId: categoryId ?? null,
        limit: 1000,
        offset: 0,
    })
    const normalizedTitle = normalizeComparableText(title)
    return entries.find((item) => (
        item.id !== excludeEntryId
        && normalizeComparableText(item.title) === normalizedTitle
    )) ?? null
}

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
})

export function parseDateValue(value?: string | null): number {
    if (!value) return 0
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const timestamp = new Date(withTimezone).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
}

export function formatDate(value?: string | null): string {
    const timestamp = parseDateValue(value)
    if (!timestamp) return '未知'
    return DATE_FORMATTER.format(timestamp)
}

export function normalizeEntryLookupTitle(value?: string | null): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function getTextareaCaretOffset(textarea: HTMLTextAreaElement, cursor: number): {
    left: number;
    top: number;
    lineHeight: number
} {
    const styles = window.getComputedStyle(textarea)
    const mirror = document.createElement('div')
    const marker = document.createElement('span')

    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.top = '0'
    mirror.style.left = '0'
    mirror.style.boxSizing = styles.boxSizing
    mirror.style.width = `${textarea.clientWidth}px`
    mirror.style.padding = styles.padding
    mirror.style.border = styles.border
    mirror.style.font = styles.font
    mirror.style.lineHeight = styles.lineHeight
    mirror.style.letterSpacing = styles.letterSpacing
    mirror.style.textTransform = styles.textTransform
    mirror.style.textIndent = styles.textIndent
    mirror.style.textAlign = styles.textAlign as 'start'
    mirror.style.tabSize = styles.tabSize
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordBreak = 'break-word'
    mirror.style.overflowWrap = 'break-word'

    mirror.textContent = textarea.value.slice(0, cursor)
    marker.textContent = textarea.value.slice(cursor, cursor + 1) || '\u200b'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)

    const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.4 || 20
    const left = marker.offsetLeft - textarea.scrollLeft
    const top = marker.offsetTop - textarea.scrollTop

    document.body.removeChild(mirror)

    return {left, top, lineHeight}
}

export function replaceRange(value: string, start: number, end: number, nextText: string): string {
    return `${value.slice(0, start)}${nextText}${value.slice(end)}`
}

export function resolveActiveWikiDraft(value: string, cursor: number | null): {
    start: number;
    end: number;
    query: string
} | null {
    if (cursor == null) return null
    const beforeCursor = value.slice(0, cursor)
    const start = beforeCursor.lastIndexOf('[[')
    if (start === -1) return null
    const tail = beforeCursor.slice(start + 2)
    if (tail.includes(']]') || /[\r\n]/.test(tail)) return null
    return {
        start,
        end: cursor,
        query: tail,
    }
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
