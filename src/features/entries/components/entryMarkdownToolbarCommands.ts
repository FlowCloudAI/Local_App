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
