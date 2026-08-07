/**
 * 桌面创作首页的轻量展示模型：统一项目统计文案与世界卡提示优先级。
 * 这里只处理纯数据，不读取 Tauri 或 React 状态，页面负责加载和跳转。
 */
import type {ProjectStats} from '../api'

export interface ProjectHomeNudge {
    key: 'empty' | 'uncategorized' | 'isolated'
    label: string
}

const compactNumberFormatter = new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
})

export function formatProjectStatCount(value: number): string {
    return compactNumberFormatter.format(Math.max(0, value))
}

export function getProjectHomeNudge(stats?: ProjectStats | null): ProjectHomeNudge | null {
    if (!stats) return null
    if (stats.emptyContentEntryCount > 0) {
        return {key: 'empty', label: `${stats.emptyContentEntryCount} 个词条内容为空`}
    }
    if (stats.uncategorizedEntryCount > 0) {
        return {key: 'uncategorized', label: `${stats.uncategorizedEntryCount} 个词条尚未分类`}
    }
    if (stats.isolatedEntryCount > 0) {
        return {key: 'isolated', label: `${stats.isolatedEntryCount} 个词条尚未建立关联`}
    }
    return null
}
