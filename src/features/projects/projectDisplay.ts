import {convertFileSrc} from '../../api/assets'

const PROJECT_COVER_SCHEME_RE = /^(https?:|data:|blob:|asset:|fcimg:)/i

const PROJECT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}

const PROJECT_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
    ...PROJECT_DATE_FORMAT,
    hour: '2-digit',
    minute: '2-digit',
}

export function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (PROJECT_COVER_SCHEME_RE.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

export function buildProjectExportFileName(projectName: string): string {
    const safeName = projectName
        .split('')
        .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    return `${safeName || '世界观'}.fcworld`
}

export function parseProjectDateMs(value?: string | null): number {
    if (!value) return 0
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const time = new Date(withTimezone).getTime()
    return Number.isNaN(time) ? 0 : time
}

export function formatProjectDate(
    value?: string | null,
    options: {fallback?: string; includeTime?: boolean} = {},
): string {
    const timestamp = parseProjectDateMs(value)
    if (!timestamp) return options.fallback ?? '时间未知'
    return new Intl.DateTimeFormat(
        'zh-CN',
        options.includeTime ? PROJECT_DATE_TIME_FORMAT : PROJECT_DATE_FORMAT,
    ).format(timestamp)
}
