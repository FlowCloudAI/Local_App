import {type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'

export interface MarkdownTransformResult {
    value: string
    selectionStart: number
    selectionEnd: number
}

function replaceSelection(
    value: string,
    start: number,
    end: number,
    nextValue: string,
    nextSelectionStart: number,
    nextSelectionEnd = nextSelectionStart,
): MarkdownTransformResult {
    return {
        value: `${value.slice(0, start)}${nextValue}${value.slice(end)}`,
        selectionStart: nextSelectionStart,
        selectionEnd: nextSelectionEnd,
    }
}

function transformInlineMarkdown(
    value: string,
    start: number,
    end: number,
    before: string,
    after: string,
    placeholder: string,
): MarkdownTransformResult {
    const selected = value.slice(start, end) || placeholder
    const nextValue = `${before}${selected}${after}`
    const selectionStart = start + before.length
    return replaceSelection(value, start, end, nextValue, selectionStart, selectionStart + selected.length)
}

function transformMarkdownLines(
    value: string,
    start: number,
    end: number,
    lineMapper: (line: string) => string,
): MarkdownTransformResult {
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const nextLineBreak = value.indexOf('\n', end)
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
    const target = value.slice(lineStart, lineEnd)
    const mapped = target.split('\n').map(lineMapper).join('\n')
    return replaceSelection(value, lineStart, lineEnd, mapped, lineStart, lineStart + mapped.length)
}

export function transformMarkdownContent(
    tool: Exclude<MobileMarkdownTool, 'image'>,
    value: string,
    start: number,
    end: number,
): MarkdownTransformResult {
    switch (tool) {
        case 'heading':
            return transformMarkdownLines(value, start, end, line => line.replace(/^#{1,6}\s+/, '').replace(/^/, '## '))
        case 'bold':
            return transformInlineMarkdown(value, start, end, '**', '**', '加粗文字')
        case 'italic':
            return transformInlineMarkdown(value, start, end, '*', '*', '斜体文字')
        case 'quote':
            return transformMarkdownLines(value, start, end, line => line.startsWith('> ') ? line : `> ${line}`)
        case 'list':
            return transformMarkdownLines(value, start, end, line => /^[-*]\s+/.test(line) ? line : `- ${line}`)
        case 'link': {
            const selected = value.slice(start, end) || '链接文本'
            const nextValue = `[${selected}]()`
            const cursor = start + nextValue.length - 1
            return replaceSelection(value, start, end, nextValue, cursor)
        }
        case 'wiki': {
            const selected = value.slice(start, end)
            const nextValue = selected ? `[[${selected}]]` : '[['
            const cursor = start + nextValue.length
            return replaceSelection(value, start, end, nextValue, cursor)
        }
    }
}
