import type {CSSProperties, ReactNode} from 'react'
import {formatDashboardNumber} from './ProjectDashboardFormat'

export interface DashboardBarItem {
    key: string
    label: string
    value: number
    tone?: 'warning' | 'muted'
}

export interface DashboardIssueItem {
    key: string
    label: string
    value?: number | null
    hint: string
    severity: 'ok' | 'warn' | 'danger'
}

export interface DashboardKpiItem {
    key: string
    label: string
    value: string
    hint: string
    tone?: 'default' | 'ok' | 'warn' | 'danger'
}

export interface DashboardActionItem {
    key: string
    title: string
    description: string
    tone?: 'relation' | 'timeline' | 'map' | 'contradiction'
    badge?: string
    disabled?: boolean
    icon?: ReactNode
    onClick?: () => void
}

export interface DashboardSignalItem {
    key: string
    label: string
    value: string
    description: string
}

function getBarStyle(value: number, total: number): CSSProperties {
    const percent = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0
    return {'--pe-dashboard-bar-width': `${percent}%`} as CSSProperties
}

const PIE_SEGMENT_COLORS = [
    'var(--fc-color-primary)',
    'var(--fc-color-success)',
    'var(--fc-color-warning)',
    'var(--fc-color-purple, var(--fc-color-info))',
    'var(--fc-color-teal, var(--fc-color-info))',
    'var(--fc-color-orange, var(--fc-color-warning))',
]

function getPieStyle(items: DashboardBarItem[], total: number): CSSProperties {
    let current = 0
    const segments = items.map((item, index) => {
        const start = current
        current += total > 0 ? (item.value / total) * 100 : 0
        const color = getSegmentColor(index, item.tone)
        return `${color} ${start}% ${current}%`
    })
    const fallback = 'color-mix(in srgb, var(--fc-color-border) 54%, transparent)'
    return {
        background: [
            'radial-gradient(circle, var(--fc-color-bg) 48%, transparent 50%)',
            `conic-gradient(${segments.length ? segments.join(', ') : `${fallback} 0 100%`})`,
        ].join(', '),
    }
}

function getSegmentColor(index: number, tone?: DashboardBarItem['tone']): string {
    if (tone === 'warning') return 'var(--fc-color-warning)'
    if (tone === 'muted') return 'var(--fc-color-text-tertiary)'
    return PIE_SEGMENT_COLORS[index % PIE_SEGMENT_COLORS.length]
}

function getPercent(value: number, total: number): number {
    return total > 0 ? Math.round((value / total) * 100) : 0
}

export function DashboardMetric({label, value, hint, muted}: {
    label: string
    value: string
    hint: string
    muted?: boolean
}) {
    return (
        <article className="pe-dashboard-metric" data-muted={muted ? 'true' : undefined}>
            <span className="pe-dashboard-metric__label">{label}</span>
            <strong className="pe-dashboard-metric__value">{value}</strong>
            <span className="pe-dashboard-metric__hint">{hint}</span>
        </article>
    )
}

export function DashboardKpiStrip({items}: { items: DashboardKpiItem[] }) {
    // 不渲染外层包裹，直接作为父级 status-strip 网格的同级单元，便于与健康卡片对齐
    return (
        <>
            {items.map(item => (
                <article
                    key={item.key}
                    className={`pe-dashboard-kpi pe-dashboard-kpi--${item.tone ?? 'default'}`}
                >
                    <span className="pe-dashboard-kpi__label">{item.label}</span>
                    <strong className="pe-dashboard-kpi__value">{item.value}</strong>
                    <span className="pe-dashboard-kpi__hint">{item.hint}</span>
                </article>
            ))}
        </>
    )
}

export function DashboardBarList({items}: { items: DashboardBarItem[] }) {
    const total = items.reduce((sum, item) => sum + item.value, 0)

    if (items.length === 0) {
        return <p className="pe-dashboard-empty">暂无可统计数据</p>
    }

    return (
        <div className="pe-dashboard-bars">
            {items.map((item, index) => (
                <div className="pe-dashboard-bar-row" key={item.key} data-tone={item.tone}>
                    <div className="pe-dashboard-bar-row__topline">
                        <span className="pe-dashboard-bar-row__rank">{index + 1}</span>
                        <span className="pe-dashboard-bar-row__label">{item.label}</span>
                        <span>{formatDashboardNumber(item.value)}</span>
                    </div>
                    <div className="pe-dashboard-bar-track">
                        <span
                            className="pe-dashboard-bar-fill"
                            style={{
                                ...getBarStyle(item.value, total),
                                background: getSegmentColor(index, item.tone),
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function DashboardStackedDistribution({items}: { items: DashboardBarItem[] }) {
    const total = items.reduce((sum, item) => sum + item.value, 0)

    if (items.length === 0 || total <= 0) {
        return <p className="pe-dashboard-empty">暂无可统计数据</p>
    }

    return (
        <div className="pe-dashboard-stacked">
            <div className="pe-dashboard-stacked__bar" aria-hidden="true">
                {items.map((item, index) => (
                    <span
                        key={item.key}
                        className="pe-dashboard-stacked__segment"
                        style={{
                            flexBasis: `${(item.value / total) * 100}%`,
                            background: getSegmentColor(index, item.tone),
                        }}
                    />
                ))}
            </div>
            <div className="pe-dashboard-stacked__legend">
                {items.map((item, index) => (
                    <div className="pe-dashboard-stacked__legend-row" key={item.key}>
                        <span
                            className="pe-dashboard-pie-chart__swatch"
                            style={{backgroundColor: getSegmentColor(index, item.tone)}}
                            aria-hidden="true"
                        />
                        <span className="pe-dashboard-stacked__label">{item.label}</span>
                        <strong>{formatDashboardNumber(item.value)}</strong>
                        <span>{getPercent(item.value, total)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export function DashboardPieChart({items}: { items: DashboardBarItem[] }) {
    const total = items.reduce((sum, item) => sum + item.value, 0)

    if (items.length === 0 || total <= 0) {
        return <p className="pe-dashboard-empty">暂无可统计数据</p>
    }

    return (
        <div className="pe-dashboard-pie-chart">
            <div className="pe-dashboard-pie-chart__shape" style={getPieStyle(items, total)} aria-hidden="true"/>
            <div className="pe-dashboard-pie-chart__legend">
                {items.map((item, index) => {
                    const color = getSegmentColor(index, item.tone)
                    return (
                        <div className="pe-dashboard-pie-chart__legend-row" key={item.key}>
                            <span
                                className="pe-dashboard-pie-chart__swatch"
                                style={{backgroundColor: color}}
                                aria-hidden="true"
                            />
                            <span className="pe-dashboard-pie-chart__label">{item.label}</span>
                            <strong>{formatDashboardNumber(item.value)}</strong>
                            <span>{getPercent(item.value, total)}%</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export function DashboardIssueList({items}: { items: DashboardIssueItem[] }) {
    return (
        <div className="pe-dashboard-issue-list">
            {items.map(item => (
                <div
                    key={item.key}
                    className={`pe-dashboard-issue-row pe-dashboard-issue-row--${item.severity}`}
                >
                    <span className="pe-dashboard-issue-row__label">{item.label}</span>
                    <strong>{formatDashboardNumber(item.value)}</strong>
                    <span className="pe-dashboard-issue-row__hint">{item.hint}</span>
                </div>
            ))}
        </div>
    )
}

export function DashboardActionList({items}: { items: DashboardActionItem[] }) {
    return (
        <div className="pe-dashboard-action-list">
            {items.map(item => (
                <button
                    key={item.key}
                    type="button"
                    className={`pe-dashboard-action pe-dashboard-action--${item.tone ?? item.key}`}
                    onClick={item.onClick}
                    disabled={item.disabled}
                >
                    {item.icon && (
                        <span className="pe-dashboard-action__icon" aria-hidden="true">
                            {item.icon}
                        </span>
                    )}
                    <span className="pe-dashboard-action__body">
                        <span className="pe-dashboard-action__topline">
                            <span className="pe-dashboard-action__title">{item.title}</span>
                            {item.badge && <span className="pe-dashboard-action__badge">{item.badge}</span>}
                        </span>
                        <span className="pe-dashboard-action__desc">{item.description}</span>
                    </span>
                </button>
            ))}
        </div>
    )
}

export function DashboardSignalList({items}: { items: DashboardSignalItem[] }) {
    return (
        <dl className="pe-dashboard-signal-list">
            {items.map(item => (
                <div className="pe-dashboard-signal-row" key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>
                        <strong>{item.value}</strong>
                        <span>{item.description}</span>
                    </dd>
                </div>
            ))}
        </dl>
    )
}

export function HealthMeter({score}: { score: number }) {
    const status = score >= 80 ? '结构稳定' : score >= 55 ? '仍需补强' : '基础偏弱'
    return (
        <div className="pe-dashboard-health">
            <div className="pe-dashboard-health__ring" style={getBarStyle(score, 100)}>
                <span>{score}</span>
            </div>
            <div className="pe-dashboard-health__body">
                <span className="pe-dashboard-health__label">世界观结构化评分</span>
                <strong>{status}</strong>
                <span>基于分类、词条类型、标签体系、内容体量和平均字数估算。</span>
            </div>
        </div>
    )
}
