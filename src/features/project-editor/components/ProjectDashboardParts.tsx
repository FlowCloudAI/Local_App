import type {CSSProperties} from 'react'
import {formatDashboardNumber} from './ProjectDashboardFormat'

export interface DashboardBarItem {
    key: string
    label: string
    value: number
}

function getBarStyle(value: number, total: number): CSSProperties {
    const percent = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0
    return {'--pe-dashboard-bar-width': `${percent}%`} as CSSProperties
}

export function DashboardMetric({label, value, hint}: { label: string; value: string; hint: string }) {
    return (
        <article className="pe-dashboard-metric">
            <span className="pe-dashboard-metric__label">{label}</span>
            <strong className="pe-dashboard-metric__value">{value}</strong>
            <span className="pe-dashboard-metric__hint">{hint}</span>
        </article>
    )
}

export function DashboardBarList({items}: { items: DashboardBarItem[] }) {
    const total = items.reduce((sum, item) => sum + item.value, 0)

    if (items.length === 0) {
        return <p className="pe-dashboard-empty">暂无可统计数据</p>
    }

    return (
        <div className="pe-dashboard-bars">
            {items.map(item => (
                <div className="pe-dashboard-bar-row" key={item.key}>
                    <div className="pe-dashboard-bar-row__topline">
                        <span>{item.label}</span>
                        <span>{formatDashboardNumber(item.value)}</span>
                    </div>
                    <div className="pe-dashboard-bar-track">
                        <span className="pe-dashboard-bar-fill" style={getBarStyle(item.value, total)}/>
                    </div>
                </div>
            ))}
        </div>
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
