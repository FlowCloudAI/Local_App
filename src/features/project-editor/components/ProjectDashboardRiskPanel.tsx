import type {ProjectStats} from '../../../api'
import type {ProjectRiskSummary} from './ProjectOverview.types'
import {DashboardIssueGrid, type DashboardIssueItem} from './ProjectDashboardParts'

interface ProjectDashboardRiskPanelProps {
    projectStats?: ProjectStats | null
    riskSummary?: ProjectRiskSummary | null
}

function severityOf(value: number | null | undefined, dangerAt = 1): DashboardIssueItem['severity'] {
    if (!value) return 'ok'
    return value >= dangerAt ? 'danger' : 'warn'
}

function ProjectDashboardRiskPanel({projectStats, riskSummary}: ProjectDashboardRiskPanelProps) {
    const qualityItems: DashboardIssueItem[] = [
        {
            key: 'uncategorized',
            label: '未分类',
            value: projectStats?.uncategorizedEntryCount,
            hint: '缺少管理归属',
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

    return (
        <article className="pe-dashboard-panel pe-dashboard-panel--quality">
            <div className="pe-dashboard-panel__header">
                <h3>质量监控</h3>
                <span>{riskSummary?.reportCount ? `${riskSummary.reportCount} 份报告` : '异常指标'}</span>
            </div>
            <DashboardIssueGrid items={qualityItems}/>
            {riskSummary?.latestOverview && (
                <p className="pe-dashboard-empty">{riskSummary.latestOverview}</p>
            )}
        </article>
    )
}

export default ProjectDashboardRiskPanel
