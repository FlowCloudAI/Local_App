/**
 * 极简 rehype 插件：清洗 markdown 中内嵌的原始 HTML。
 *
 * 词条正文可能来自导入的 `.fcworld` 或 AI 生成，属于不可信内容；而
 * `@uiw/react-markdown-preview` 与 `@uiw/react-md-editor` 的预览在管线里
 * **硬编码**了 rehype-raw（把原始 HTML 解析成真实 DOM），且默认不带任何
 * sanitizer、还把 urlTransform 改成了恒等（禁用了 javascript: 过滤）。
 *
 * 本插件作为额外 rehypePlugin 传入，会在硬编码的 rehype-raw **之后**运行，去掉：
 *   - 可脚本化 / 可注入的元素（script/style/iframe/object/embed/form/svg 等）；
 *   - 事件处理器属性（on*）与内联 style（内联 style 可做整屏 UI 覆盖钓鱼）；
 *   - href/src 上的 javascript:/vbscript: 危险协议。
 *
 * 保留 className、图片（含 data:/fcimg:）与常规 markdown 结构，尽量不影响渲染。
 * 注意：当前 CSP 的 script-src 不含 'unsafe-inline'，注入脚本本就无法执行；本插件
 * 主要消除“可用的 HTML/CSS 注入（钓鱼/UI 覆盖）”与“一旦 CSP 放宽即成完整 XSS”的隐患。
 */

const DROP_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'title',
    'form',
    'svg',
    'math',
])

const DANGEROUS_URL = /^\s*(javascript|vbscript):/i

interface HastNode {
    type: string
    tagName?: string
    properties?: Record<string, unknown>
    children?: HastNode[]
}

function cleanNode(node: HastNode): void {
    if (!node.children) return
    node.children = node.children.filter(child => {
        if (child.type !== 'element') return true
        if (child.tagName && DROP_TAGS.has(child.tagName.toLowerCase())) return false
        const props = child.properties
        if (props) {
            for (const key of Object.keys(props)) {
                const lower = key.toLowerCase()
                // 去掉事件处理器与内联样式
                if (lower.startsWith('on') || lower === 'style') {
                    delete props[key]
                }
            }
            // 去掉 href/src 上的可执行伪协议（保留 data:/fcimg: 供图片使用）
            for (const attr of ['href', 'src'] as const) {
                const value = props[attr]
                if (typeof value === 'string' && DANGEROUS_URL.test(value)) {
                    delete props[attr]
                }
            }
        }
        return true
    })
    for (const child of node.children) cleanNode(child)
}

/** 供 react-markdown / @uiw 预览的 `rehypePlugins` 使用。 */
export function rehypeSanitizeRawHtml() {
    return (tree: HastNode) => {
        cleanNode(tree)
        return tree
    }
}
