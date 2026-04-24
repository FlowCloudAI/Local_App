import {memo, useCallback, useEffect, useMemo, useState} from 'react'
import {Button, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_delete_contradiction_report,
    ai_get_contradiction_report_entry,
    ai_list_contradiction_reports,
    ai_start_contradiction_session,
    type ContradictionCategory,
    type ContradictionIssue,
    type ContradictionReport,
    type ContradictionReportHistoryItem,
    type StoredContradictionReport,
} from '../../../api'
import type {ReportConversationContext} from '../../ai-chat/model/AiControllerTypes'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectContradictionPanel.css'

interface ProjectContradictionPanelProps {
    projectId: string
    projectName: string
    aiPluginId?: string | null
    aiModel?: string | null
    onBack: () => void
    onStartDiscussion?: (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => void
}

function formatDateTime(value: string): string {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsed)
}

function severityLabel(severity: ContradictionIssue['severity']): string {
    switch (severity) {
        case 'critical':
            return '严重'
        case 'high':
            return '高'
        case 'medium':
            return '中'
        default:
            return '低'
    }
}

function categoryLabel(category: ContradictionCategory | null | undefined): string {
    switch (category) {
        case 'timeline':
            return '时间线'
        case 'relationship':
            return '人物关系'
        case 'geography':
            return '地理空间'
        case 'ability':
            return '能力规则'
        case 'faction':
            return '阵营立场'
        default:
            return '其他'
    }
}

function reportStatus(report: ContradictionReport): string {
    if (report.issues.some((issue) => issue.severity === 'critical')) return '高风险'
    if (report.issues.some((issue) => issue.severity === 'high')) return '需重点处理'
    if (report.issues.length > 0) return '存在冲突'
    if (report.unresolvedQuestions.length > 0) return '待补证据'
    return '整体稳定'
}

function buildReportConversationContext(record: StoredContradictionReport): ReportConversationContext {
    return {
        reportId: record.reportId,
        projectId: record.projectId,
        projectName: record.projectName,
        scopeSummary: record.scopeSummary,
        sourceEntryIds: record.sourceEntryIds,
        truncated: record.truncated,
        reportJson: JSON.stringify(record.report, null, 2),
    }
}

function ProjectContradictionPanel({
                                       projectId,
                                       projectName,
                                       aiPluginId = null,
                                       aiModel = null,
                                       onBack,
                                       onStartDiscussion,
                                   }: ProjectContradictionPanelProps) {
    const {showAlert} = useAlert()
    const [historyItems, setHistoryItems] = useState<ContradictionReportHistoryItem[]>([])
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
    const [activeRecord, setActiveRecord] = useState<StoredContradictionReport | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [generating, setGenerating] = useState(false)

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true)
        try {
            const items = await ai_list_contradiction_reports(projectId)
            setHistoryItems(items)
            setSelectedReportId((current) => {
                if (current && items.some((item) => item.reportId === current)) return current
                return items[0]?.reportId ?? null
            })
            if (items.length === 0) {
                setActiveRecord(null)
            }
        } catch (error) {
            console.error('加载矛盾检测历史失败', error)
            await showAlert(`加载矛盾检测历史失败：${String(error)}`, 'error', 'toast', 2600)
        } finally {
            setHistoryLoading(false)
        }
    }, [projectId, showAlert])

    useEffect(() => {
        void loadHistory()
    }, [loadHistory])

    useEffect(() => {
        if (!selectedReportId) return
        let cancelled = false
        setDetailLoading(true)
        ai_get_contradiction_report_entry(selectedReportId)
            .then((record) => {
                if (cancelled) return
                setActiveRecord(record)
            })
            .catch(async (error) => {
                if (cancelled) return
                console.error('加载矛盾检测报告失败', error)
                await showAlert(`加载报告失败：${String(error)}`, 'error', 'toast', 2600)
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [selectedReportId, showAlert])

    const handleGenerate = useCallback(async () => {
        if (!aiPluginId || !aiModel) {
            await showAlert('当前 AI 插件或模型尚未准备好，请稍后重试。', 'warning', 'toast', 2200)
            return
        }

        setGenerating(true)
        try {
            const result = await ai_start_contradiction_session({
                sessionId: `contradiction_${Date.now()}`,
                pluginId: aiPluginId,
                model: aiModel,
                projectId,
            })
            const record = await ai_get_contradiction_report_entry(result.reportId)
            if (!record) {
                throw new Error('新生成的矛盾报告未能写入历史记录')
            }
            await loadHistory()
            setSelectedReportId(record.reportId)
            setActiveRecord(record)
            if (onStartDiscussion) {
                onStartDiscussion({
                    title: `设定矛盾检测：${projectName}`,
                    pluginId: result.pluginId,
                    model: result.model ?? aiModel,
                    reportContext: buildReportConversationContext(record),
                })
            }
            await showAlert('矛盾检测完成，右侧已为这份报告新建讨论对话。', 'success', 'toast', 2200)
        } catch (error) {
            console.error('生成矛盾检测报告失败', error)
            await showAlert(`生成矛盾检测报告失败：${String(error)}`, 'error', 'toast', 3000)
        } finally {
            setGenerating(false)
        }
    }, [aiModel, aiPluginId, loadHistory, onStartDiscussion, projectId, projectName, showAlert])

    const handleDelete = useCallback(async (reportId: string) => {
        const confirmed = await showAlert('删除后将无法在历史中恢复这份报告。是否继续？', 'warning', 'confirm')
        if (confirmed !== 'yes') return
        try {
            await ai_delete_contradiction_report(reportId)
            setHistoryItems((prev) => prev.filter((item) => item.reportId !== reportId))
            if (selectedReportId === reportId) {
                const next = historyItems.find((item) => item.reportId !== reportId)
                setSelectedReportId(next?.reportId ?? null)
                if (!next) {
                    setActiveRecord(null)
                }
            }
            await showAlert('报告已删除。', 'success', 'toast', 1600)
        } catch (error) {
            console.error('删除矛盾检测报告失败', error)
            await showAlert(`删除报告失败：${String(error)}`, 'error', 'toast', 2600)
        }
    }, [historyItems, selectedReportId, showAlert])

    const handleStartDiscussion = useCallback(async () => {
        if (!activeRecord || !onStartDiscussion) return
        const model = activeRecord.model ?? aiModel
        if (!model) {
            await showAlert('当前缺少可用模型，无法创建报告讨论对话。', 'warning', 'toast', 2200)
            return
        }
        onStartDiscussion({
            title: `设定矛盾检测：${activeRecord.projectName}`,
            pluginId: activeRecord.pluginId,
            model,
            reportContext: buildReportConversationContext(activeRecord),
        })
    }, [activeRecord, aiModel, onStartDiscussion, showAlert])

    const summary = useMemo(() => {
        if (!activeRecord) return null
        const issues = activeRecord.report.issues
        return {
            issueCount: issues.length,
            unresolvedCount: activeRecord.report.unresolvedQuestions.length,
            status: reportStatus(activeRecord.report),
            severityDist: {
                critical: issues.filter((i) => i.severity === 'critical').length,
                high: issues.filter((i) => i.severity === 'high').length,
                medium: issues.filter((i) => i.severity === 'medium').length,
                low: issues.filter((i) => i.severity === 'low').length,
            },
        }
    }, [activeRecord])

    return (
        <div className="pe-contradiction-panel">
            <div className="pe-contradiction-toolbar">
                <div className="pe-contradiction-toolbar__left">
                    <Button variant="ghost" size="sm" onClick={onBack}>返回概览</Button>
                    <div className="fc-page-title-block">
                        <h2 className="pe-contradiction-title fc-page-title">设定矛盾检测</h2>
                        <p className="pe-contradiction-desc fc-page-subtitle">生成结构化报告，保留历史记录，并可在右侧聊天区继续讨论这份报告。</p>
                    </div>
                </div>
                <div className="pe-contradiction-toolbar__actions fc-page-header-actions">
                    <Button variant="outline" size="sm" onClick={() => void loadHistory()}
                            disabled={historyLoading || generating}>
                        刷新历史
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => void handleGenerate()} disabled={generating}>
                        {generating ? '检测中…' : '生成新报告'}
                    </Button>
                </div>
            </div>

            <div className="pe-contradiction-layout">
                <section className="pe-contradiction-history">
                    <div className="pe-contradiction-section__header">
                        <h3 className="pe-contradiction-section__title fc-section-title">历史报告</h3>
                        <span className="pe-contradiction-section__meta">{historyItems.length} 份</span>
                    </div>
                    <RollingBox className="pe-contradiction-history__scroll" thumbSize="thin">
                        <div className="pe-contradiction-history__list">
                            {historyLoading && historyItems.length === 0 ? (
                                <div className="pe-contradiction-empty">正在加载历史报告…</div>
                            ) : historyItems.length === 0 ? (
                                <div className="pe-contradiction-empty">还没有生成过矛盾检测报告。</div>
                            ) : historyItems.map((item) => (
                                <article
                                    key={item.reportId}
                                    className={`pe-contradiction-history__item${item.reportId === selectedReportId ? ' is-active' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className="pe-contradiction-history__button"
                                        onClick={() => setSelectedReportId(item.reportId)}
                                    >
                                        <div className="pe-contradiction-history__topline">
                                            <span
                                                className="pe-contradiction-history__time">{formatDateTime(item.createdAt)}</span>
                                            <span
                                                className="pe-contradiction-history__badge">{item.issueCount} 个冲突</span>
                                        </div>
                                        <div className="pe-contradiction-history__summary">{item.overview}</div>
                                        <div className="pe-contradiction-history__meta">
                                            <span>{item.scopeSummary}</span>
                                            {item.truncated &&
                                                <span className="pe-contradiction-history__warning">已裁剪</span>}
                                        </div>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handleDelete(item.reportId)}
                                    >
                                        删除
                                    </Button>
                                </article>
                            ))}
                        </div>
                    </RollingBox>
                </section>

                <section className="pe-contradiction-report">
                    {!activeRecord ? (
                        <div className="pe-contradiction-empty pe-contradiction-empty--large">
                            请选择一份历史报告，或直接生成新的矛盾检测结果。
                        </div>
                    ) : detailLoading ? (
                        <div className="pe-contradiction-empty pe-contradiction-empty--large">
                            正在加载报告详情…
                        </div>
                    ) : (
                        <div className="pe-contradiction-report__body">
                            <RollingBox className="pe-contradiction-report__scroll" thumbSize="thin">
                                <div className="pe-contradiction-report__content">
                                    <div className="pe-contradiction-report__hero">
                                        <div>
                                            <div className="pe-contradiction-report__meta">
                                                <span>{formatDateTime(activeRecord.createdAt)}</span>
                                                <span>范围：{activeRecord.scopeSummary}</span>
                                                {activeRecord.truncated && <span
                                                    className="pe-contradiction-report__warning">本次资料已裁剪</span>}
                                            </div>
                                            <h3 className="pe-contradiction-report__title">{summary?.status}</h3>
                                            <p className="pe-contradiction-report__overview">{activeRecord.report.overview}</p>
                                        </div>
                                        <div className="pe-contradiction-report__hero-actions">
                                            <Button variant="outline" size="sm"
                                                    onClick={() => void handleStartDiscussion()}>
                                                在右侧继续讨论
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="pe-contradiction-stats">
                                        <div className="pe-contradiction-stat-card">
                                        <span
                                            className="pe-contradiction-stat-card__value">{summary?.issueCount ?? 0}</span>
                                            <span className="pe-contradiction-stat-card__label">冲突条目</span>
                                            {(summary?.issueCount ?? 0) > 0 && (
                                                <div className="pe-contradiction-severity-dist">
                                                    {summary!.severityDist.critical > 0 && (
                                                        <span
                                                            className="pe-contradiction-severity-pill is-critical">{summary!.severityDist.critical} 严重</span>
                                                    )}
                                                    {summary!.severityDist.high > 0 && (
                                                        <span
                                                            className="pe-contradiction-severity-pill is-high">{summary!.severityDist.high} 高</span>
                                                    )}
                                                    {summary!.severityDist.medium > 0 && (
                                                        <span
                                                            className="pe-contradiction-severity-pill is-medium">{summary!.severityDist.medium} 中</span>
                                                    )}
                                                    {summary!.severityDist.low > 0 && (
                                                        <span
                                                            className="pe-contradiction-severity-pill is-low">{summary!.severityDist.low} 低</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="pe-contradiction-stat-card">
                                        <span
                                            className="pe-contradiction-stat-card__value">{summary?.unresolvedCount ?? 0}</span>
                                            <span className="pe-contradiction-stat-card__label">待确认问题</span>
                                        </div>
                                        <div className="pe-contradiction-stat-card">
                                        <span
                                            className="pe-contradiction-stat-card__value">{activeRecord.sourceEntryIds.length}</span>
                                            <span className="pe-contradiction-stat-card__label">来源词条</span>
                                        </div>
                                    </div>

                                    <section className="pe-contradiction-report__section">
                                        <div className="pe-contradiction-section__header">
                                            <h4 className="pe-contradiction-section__title fc-section-title">冲突清单</h4>
                                            <span
                                                className="pe-contradiction-section__meta">{activeRecord.report.issues.length} 项</span>
                                        </div>
                                        <div className="pe-contradiction-issue-list">
                                            {activeRecord.report.issues.length === 0 ? (
                                                <div
                                                    className="pe-contradiction-empty">当前范围内没有发现明确冲突。</div>
                                            ) : activeRecord.report.issues.map((issue) => (
                                                <article key={issue.issueId}
                                                         className={`pe-contradiction-issue-card is-severity-${issue.severity}`}>
                                                    <div className="pe-contradiction-issue-card__header">
                                                        <div className="pe-contradiction-issue-card__title-group">
                                                        <span
                                                            className={`pe-contradiction-issue-card__severity is-${issue.severity}`}>
                                                            {severityLabel(issue.severity)}
                                                        </span>
                                                            {issue.category && (
                                                                <span className="pe-contradiction-issue-card__category">
                                                                {categoryLabel(issue.category)}
                                                            </span>
                                                            )}
                                                            <h5 className="pe-contradiction-issue-card__title">{issue.title}</h5>
                                                        </div>
                                                        <span
                                                            className="pe-contradiction-issue-card__id">{issue.issueId}</span>
                                                    </div>
                                                    <p className="pe-contradiction-issue-card__desc">{issue.description}</p>
                                                    {issue.relatedEntryIds.length > 0 && (
                                                        <div className="pe-contradiction-chip-list">
                                                        <span
                                                            className="pe-contradiction-chip-list__label">相关词条</span>
                                                            {issue.relatedEntryIds.map((entryId) => (
                                                                <span key={`${issue.issueId}-${entryId}`}
                                                                      className="pe-contradiction-chip">
                                                                {entryId}
                                                            </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="pe-contradiction-evidence-list">
                                                        {issue.evidence.map((evidence, index) => (
                                                            <div key={`${issue.issueId}-${index}`}
                                                                 className="pe-contradiction-evidence-card">
                                                                <div
                                                                    className="pe-contradiction-evidence-card__title">{evidence.entryTitle}</div>
                                                                <div
                                                                    className="pe-contradiction-evidence-card__quote">“{evidence.quote}”
                                                                </div>
                                                                {evidence.note && (
                                                                    <div
                                                                        className="pe-contradiction-evidence-card__note">{evidence.note}</div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {issue.recommendation && (
                                                        <div className="pe-contradiction-issue-card__recommendation">
                                                            <strong>建议：</strong>{issue.recommendation}
                                                        </div>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    </section>

                                    <div className="pe-contradiction-report__grid">
                                        <section className="pe-contradiction-report__section">
                                            <div className="pe-contradiction-section__header">
                                                <h4 className="pe-contradiction-section__title fc-section-title">待确认问题</h4>
                                                <span
                                                    className="pe-contradiction-section__meta">{activeRecord.report.unresolvedQuestions.length} 项</span>
                                            </div>
                                            {activeRecord.report.unresolvedQuestions.length === 0 ? (
                                                <div className="pe-contradiction-empty">没有待确认问题。</div>
                                            ) : (
                                                <div className="pe-contradiction-list">
                                                    {activeRecord.report.unresolvedQuestions.map((question, index) => (
                                                        <div key={`${activeRecord.reportId}-question-${index}`}
                                                             className="pe-contradiction-list__item">
                                                            {question}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>

                                        <section className="pe-contradiction-report__section">
                                            <div className="pe-contradiction-section__header">
                                                <h4 className="pe-contradiction-section__title fc-section-title">修订建议</h4>
                                                <span
                                                    className="pe-contradiction-section__meta">{activeRecord.report.suggestions.length} 条</span>
                                            </div>
                                            {activeRecord.report.suggestions.length === 0 ? (
                                                <div className="pe-contradiction-empty">当前没有额外修订建议。</div>
                                            ) : (
                                                <div className="pe-contradiction-list">
                                                    {activeRecord.report.suggestions.map((suggestion, index) => (
                                                        <div key={`${activeRecord.reportId}-suggestion-${index}`}
                                                             className="pe-contradiction-list__item">
                                                            {suggestion}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    </div>
                                </div>
                            </RollingBox>
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}

export default memo(ProjectContradictionPanel)
