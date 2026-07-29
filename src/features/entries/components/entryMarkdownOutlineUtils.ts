/**
 * 从正文中提取 H1–H3 标题；代码围栏中的井号不参与大纲。
 */
export interface MarkdownOutlineItem {
    level: 1 | 2 | 3
    title: string
    start: number
    end: number
}

export function buildMarkdownOutline(text: string): MarkdownOutlineItem[] {
    const items: MarkdownOutlineItem[] = []
    const lines = text.split('\n')
    let offset = 0
    let fence: {marker: '`' | '~'; length: number} | null = null

    for (const line of lines) {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
        if (fenceMatch) {
            const marker = fenceMatch[1][0] as '`' | '~'
            const length = fenceMatch[1].length
            if (!fence) {
                fence = {marker, length}
            } else if (fence.marker === marker && length >= fence.length) {
                fence = null
            }
        } else if (!fence) {
            const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/)
            const title = heading?.[2].trim()
            if (heading && title) {
                items.push({
                    level: heading[1].length as 1 | 2 | 3,
                    title,
                    start: offset,
                    end: offset + line.length,
                })
            }
        }
        offset += line.length + 1
    }

    return items
}
