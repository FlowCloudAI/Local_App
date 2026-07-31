/**
 * 决定词条编辑器何时向 Markdown 预览层提供源码，避免纯编辑状态执行无用解析。
 */
export function resolveMarkdownPreviewSourceContent(
    mode: 'edit' | 'browse',
    splitView: boolean,
    content: string,
    debouncedContent: string,
): string | null {
    if (mode === 'browse') return content
    return splitView ? debouncedContent : null
}
