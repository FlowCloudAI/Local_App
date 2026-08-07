/**
 * 桌面创作首页的轻量展示模型：统一项目统计文案。
 * 这里只处理纯数据，不读取 Tauri 或 React 状态，页面负责加载和跳转。
 */
const compactNumberFormatter = new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
})

export function formatProjectStatCount(value: number): string {
    return compactNumberFormatter.format(Math.max(0, value))
}
