/**
 * 正文查找替换的纯文本逻辑；UI 只负责选择匹配项和恢复光标。
 */
export interface MarkdownTextMatch {
    start: number
    end: number
}

function buildLiteralPattern(query: string): RegExp | null {
    if (!query) return null
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'giu')
}

export function findMarkdownTextMatches(text: string, query: string): MarkdownTextMatch[] {
    const pattern = buildLiteralPattern(query)
    if (!pattern) return []
    return Array.from(text.matchAll(pattern), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }))
}

export function replaceMarkdownTextMatch(
    text: string,
    match: MarkdownTextMatch,
    replacement: string,
): string {
    return `${text.slice(0, match.start)}${replacement}${text.slice(match.end)}`
}

export function replaceMarkdownTextMatches(
    text: string,
    matches: MarkdownTextMatch[],
    replacement: string,
): string {
    return matches.reduceRight(
        (current, match) => replaceMarkdownTextMatch(current, match, replacement),
        text,
    )
}
