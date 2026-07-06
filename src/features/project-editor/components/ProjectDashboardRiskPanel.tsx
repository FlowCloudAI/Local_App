import {useState} from 'react'
import type {ProjectStats} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import type {ProjectRiskSummary} from './ProjectOverview.types'
import {DashboardIssueList, type DashboardIssueItem} from './ProjectDashboardParts'

interface ProjectDashboardRiskPanelProps {
    projectStats?: ProjectStats | null
    riskSummary?: ProjectRiskSummary | null
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function severityOf(value: number | null | undefined, dangerAt = 1): DashboardIssueItem['severity'] {
    if (!value) return 'ok'
    return value >= dangerAt ? 'danger' : 'warn'
}

function ProjectDashboardRiskPanel({projectStats, riskSummary, onOpenEntry}: ProjectDashboardRiskPanelProps) {
    const [entryPanelOpen, setEntryPanelOpen] = useState(false)
    const qualityItems: DashboardIssueItem[] = [
        {
            key: 'uncategorized',
            label: '未分类',
            value: projectStats?.uncategorizedEntryCount,
            hint: '还没有放进分类',
            severity: severityOf(projectStats?.uncategorizedEntryCount, 5),
        },
        {
            key: 'empty',
            label: '空正文',
            value: projectStats?.emptyContentEntryCount,
            hint: '设定内容为空',
            severity: severityOf(projectStats?.emptyContentEntryCount),
        },
        {
            key: 'summary',
            label: '缺摘要',
            value: projectStats?.missingSummaryEntryCount,
            hint: '不利于快速检索',
            severity: severityOf(projectStats?.missingSummaryEntryCount, 8),
        },
        {
            key: 'isolated',
            label: '孤立词条',
            value: projectStats?.isolatedEntryCount,
            hint: '没有关系或内链',
            severity: severityOf(projectStats?.isolatedEntryCount, 5),
        },
        {
            key: 'short',
            label: '短正文',
            value: projectStats?.shortContentEntryCount,
            hint: '正文少于 100 字',
            severity: severityOf(projectStats?.shortContentEntryCount, 8),
        },
        {
            key: 'contradiction',
            label: '矛盾问题',
            value: riskSummary?.issueCount,
            hint: 'AI 质检累计问题',
            severity: severityOf(riskSummary?.issueCount),
        },
        {
            key: 'unresolved',
            label: '待补证据',
            value: riskSummary?.unresolvedCount,
            hint: '需要人工确认',
            severity: severityOf(riskSummary?.unresolvedCount, 3),
        },
    ]
    const issueTotal = qualityItems.reduce((sum, item) => sum + (item.value ?? 0), 0)
    const relatedEntries = riskSummary?.relatedEntries ?? []
    const openRelatedEntries = () => setEntryPanelOpen(true)

    return (
        <>
            <article
                className="pe-dashboard-panel pe-dashboard-panel--quality pe-dashboard-panel--clickable"
                role="button"
                tabIndex={0}
                onClick={openRelatedEntries}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openRelatedEntries()
                    }
                }}
            >
                <div className="pe-dashboard-panel__header">
                    <h3>待处理问题</h3>
                    <span>{issueTotal > 0 ? `${issueTotal} 项待处理` : '状态正常'}</span>
                </div>
                <DashboardIssueList items={qualityItems}/>
                {riskSummary?.latestOverview && (
                    <p className="pe-dashboard-empty">{riskSummary.latestOverview}</p>
                )}
            </article>
            <FloatingPanel
                open={entryPanelOpen}
                onClose={() => setEntryPanelOpen(false)}
                title="相关词条"
                ariaLabel="待处理问题相关词条"
                className="pe-risk-entry-panel"
            >
                <div className="pe-risk-entry-list">
                    {relatedEntries.length > 0 ? relatedEntries.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            className="pe-risk-entry-link"
                            onClick={() => {
                                setEntryPanelOpen(false)
                                onOpenEntry?.(entry)
                            }}
                        >
                            {entry.title}
                        </button>
                    )) : (
                        <p className="pe-dashboard-empty">暂无相关词条</p>
                    )}
                </div>
            </FloatingPanel>
        </>
    )
}

export default ProjectDashboardRiskPanel
