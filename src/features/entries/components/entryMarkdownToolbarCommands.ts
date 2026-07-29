/**
 * 正文工具栏的纯文本变换；与 UI 和编辑器命令调度解耦，便于验证选区边界。
 */
interface TextRange {
    start: number
    end: number
}

export interface MarkdownTextEdit {
    start: number
    end: number
    replacement: string
    selection: TextRange
}

export function buildBlockStyleEdit(
    text: string,
    selection: TextRange,
    prefix: string,
): MarkdownTextEdit {
    const lineStart = text.lastIndexOf('\n', selection.start - 1) + 1
    const lineEnd = `${text}\n`.indexOf('\n', selection.end)
    const line = text.slice(lineStart, lineEnd)
    const replacement = `${prefix}${line.replace(/^#{1,6}\s+/, '')}`
    const offset = replacement.length - line.length

    return {
        start: lineStart,
        end: lineEnd,
        replacement,
        selection: {
            start: Math.max(lineStart + prefix.length, selection.start + offset),
            end: Math.max(lineStart + prefix.length, selection.end + offset),
        },
    }
}

export function buildWikiLinkEdit(selectedText: string, selectionStart: number): MarkdownTextEdit {
    return {
        start: selectionStart,
        end: selectionStart + selectedText.length,
        replacement: `[[${selectedText}]]`,
        selection: {
            start: selectionStart + 2,
            end: selectionStart + 2 + selectedText.length,
        },
    }
}

export function buildListEnterEdit(
    text: string,
    selection: TextRange,
): MarkdownTextEdit | null {
    if (selection.start !== selection.end) return null

    const lineStart = text.lastIndexOf('\n', selection.start - 1) + 1
    const nextLineBreak = text.indexOf('\n', selection.start)
    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak
    const line = text.slice(lineStart, lineEnd)
    const task = line.match(/^(\s*)([-+*])\s+\[[ xX]\]\s+(.*)$/)
    const ordered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/)
    const unordered = line.match(/^(\s*)([-+*])\s+(.*)$/)

    const content = task?.[3] ?? ordered?.[4] ?? unordered?.[3]
    if (content === undefined) return null
    if (content.trim() === '') {
        return {
            start: lineStart,
            end: lineEnd,
            replacement: '',
            selection: {start: lineStart, end: lineStart},
        }
    }

    const marker = task
        ? `${task[1]}${task[2]} [ ] `
        : ordered
            ? `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `
            : `${unordered![1]}${unordered![2]} `
    const contentStart = lineEnd - content.length
    if (selection.start < contentStart) return null

    const replacement = `\n${marker}`
    const caret = selection.start + replacement.length
    return {
        start: selection.start,
        end: selection.end,
        replacement,
        selection: {start: caret, end: caret},
    }
}
