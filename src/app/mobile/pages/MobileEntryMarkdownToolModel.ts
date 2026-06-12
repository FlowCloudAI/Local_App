export type MobileMarkdownTool = 'heading' | 'bold' | 'italic' | 'quote' | 'list' | 'link' | 'wiki' | 'image'

export const MOBILE_MARKDOWN_TOOLS: Array<{ tool: MobileMarkdownTool; label: string }> = [
    {tool: 'heading', label: '标题'},
    {tool: 'bold', label: '加粗'},
    {tool: 'italic', label: '斜体'},
    {tool: 'quote', label: '引用'},
    {tool: 'list', label: '列表'},
    {tool: 'link', label: '链接'},
    {tool: 'wiki', label: '双链'},
    {tool: 'image', label: '图片'},
]
