/**
 * 移动端首页的纯展示组件与筛选常量。
 * 数据校验、分页和导航留在 MobileHome，避免展示层反向依赖页面状态。
 */
/* eslint-disable react-refresh/only-export-components */
import {type ReactNode} from 'react'
import {Button} from 'flowcloudai-ui'
import type {HomeActivityTarget, HomeDashboardData} from '../../../features/home/homeActivity'
import {formatProjectDate, parseProjectDateMs} from '../../../features/projects/projectDisplay'

export type WorldSortMode = 'updated-desc' | 'created-desc' | 'name-asc'
export type WorldDisplayMode = 'card' | 'list'

interface MobileHomeContinueCardProps {
    continueItem: HomeActivityTarget
    projectName?: string | null
    lastOpenedAt?: string | null
    imageSlot?: ReactNode
    onOpenTarget: (target: HomeActivityTarget) => void
}

export function MobileHomeContinueCard({
    continueItem,
    projectName,
    lastOpenedAt,
    imageSlot,
    onOpenTarget,
}: MobileHomeContinueCardProps) {
    const meta = projectName || continueItem.subtitle || '词条'
    return (
        <article className={`mobile-home__continue${imageSlot ? ' mobile-home__continue--with-cover' : ''}`}>
            {imageSlot ? <div className="mobile-home__continue-cover">{imageSlot}</div> : null}
            <span className="mobile-home__eyebrow">继续创作</span>
            <h2 className="mobile-home__continue-title">{continueItem.title}</h2>
            <p className="mobile-home__continue-meta">
                {meta}{lastOpenedAt ? ` · ${formatRelativeTime(lastOpenedAt)}` : ''}
            </p>
            {continueItem.description ? (
                <p className="mobile-home__continue-desc">{continueItem.description}</p>
            ) : null}
            <Button type="button" onClick={() => onOpenTarget(continueItem)}>继续写作</Button>
        </article>
    )
}

export const WORLD_DISPLAY_OPTIONS: Array<{key: WorldDisplayMode; label: string; desc: string}> = [
    {key: 'card', label: '卡片', desc: '两列封面卡片'},
    {key: 'list', label: '列表', desc: '更适合扫标题'},
]

export const WORLD_SORT_OPTIONS: Array<{key: WorldSortMode; label: string}> = [
    {key: 'updated-desc', label: '更新日期'},
    {key: 'created-desc', label: '创建日期'},
    {key: 'name-asc', label: '名称排序'},
]

export const WORLD_SORT_DETAILS: Record<WorldSortMode, string> = {
    'updated-desc': '最新到最旧',
    'created-desc': '新建到较早',
    'name-asc': 'A 到 Z',
}

export function FilterCheckIcon() {
    return <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
        <path d="M5 12.5 9.2 16.7 19 6.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.35"/>
    </svg>
}

function FilterCardIcon() {
    return <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="4" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
        <rect x="13.8" y="4" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
        <rect x="4" y="13.8" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
        <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
    </svg>
}

function FilterListIcon() {
    return <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
        <circle cx="5" cy="6" r="1.25" fill="currentColor"/>
        <circle cx="5" cy="12" r="1.25" fill="currentColor"/>
        <circle cx="5" cy="18" r="1.25" fill="currentColor"/>
        <path d="M9 6h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
        <path d="M9 12h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
        <path d="M9 18h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
    </svg>
}

export function FilterImportIcon() {
    return <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
        <path d="M12 4v10.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
        <path d="M7.8 10.4 12 14.6l4.2-4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"/>
        <path d="M5.8 18.2h12.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
    </svg>
}

export function renderDisplayIcon(mode: WorldDisplayMode) {
    return mode === 'card' ? <FilterCardIcon/> : <FilterListIcon/>
}

export function formatRelativeTime(value?: string | null): string {
    const timestamp = parseProjectDateMs(value)
    if (!timestamp) return '时间未知'
    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    if (diffMs < minute) return '刚刚'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
    return formatProjectDate(value)
}

export function collectDashboardTargets(dashboard: HomeDashboardData) {
    const targets: HomeActivityTarget[] = [...dashboard.recentItems, ...dashboard.pinnedItems]
    if (dashboard.continueItem) targets.push(dashboard.continueItem)
    return targets
}
