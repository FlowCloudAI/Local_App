import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, RollingBox, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_delete_contradiction_report,
    ai_get_contradiction_report_entry,
    ai_list_contradiction_reports,
    ai_list_plugins,
    ai_start_contradiction_session,
    db_get_entry,
    type ContradictionCategory,
    type ContradictionIssue,
    type ContradictionReport,
    type ContradictionReportHistoryItem,
    type PluginInfo,
    type StoredContradictionReport,
} from '../../../api'
import {listen} from '@tauri-apps/api/event'
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
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function BackArrow() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 16, height: 16}}>
            <path
                d="M8.6 3.25L4.1 7.75L8.6 12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M4.5 7.75H12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
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
                                       onOpenEntry,
                                   }: ProjectContradictionPanelProps) {
    const {showAlert} = useAlert()

    // ── 插件 & 模型选择 ──
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [localPluginId, setLocalPluginId] = useState<string | null>(null)
    const [localModel, setLocalModel] = useState<string | null>(null)

    const effectivePluginId = localPluginId ?? aiPluginId
    const effectiveModel = localModel ?? aiModel
    const selectedPluginInfo = plugins.find((p) => p.id === effectivePluginId)

    useEffect(() => {
        ai_list_plugins('llm')
            .then((list) => setPlugins(list))
            .catch((err) => console.warn('[ContradictionPanel] 获取插件列表失败', err))
    }, [])

    const [historyItems, setHistoryItems] = useState<ContradictionReportHistoryItem[]>([])
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
    const [activeRecord, setActiveRecord] = useState<StoredContradictionReport | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [progressMessage, setProgressMessage] = useState<string | null>(null)
    const debugRawRef = useRef<string | null>(null)

    // 监听进度报告事件
    useEffect(() => {
        let unlistenFn: (() => void) | null = null
        listen('ai:contradiction_progress', (event) => {
            const payload = event.payload as Record<string, unknown>
            const msg = String(payload?.message ?? '')
            if (msg) {
                setProgressMessage(msg)
                console.log('[ContradictionPanel] 进度:', msg)
            }
        }).then((fn) => {
            unlistenFn = fn
        })
        return () => {
            unlistenFn?.()
        }
    }, [])

    // 监听 Rust 端发出的原始 AI 响应，用于调试
    useEffect(() => {
        let unlistenFn: (() => void) | null = null
        listen('ai:debug_raw_response', (event) => {
            const payload = event.payload as Record<string, unknown>
            const text = String(payload?.text ?? '')
            debugRawRef.current = text
            console.log('[ContradictionPanel] 原始 AI 响应（完整）:', text)
            const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/{[\s\S]*"overview"[\s\S]*}/)
            if (jsonMatch) {
                console.log('[ContradictionPanel] 提取的 JSON 候选:', jsonMatch[1] ?? jsonMatch[0])
            }
        }).then((fn) => {
            unlistenFn = fn
        })
        return () => {
            unlistenFn?.()
        }
    }, [])

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
        if (!effectivePluginId || !effectiveModel) {
            await showAlert('请先选择 AI 插件和模型。', 'warning', 'toast', 2200)
            return
        }

        setGenerating(true)
        setProgressMessage(null)
        try {
            const startInput = {
                sessionId: `contradiction_${Date.now()}`,
                pluginId: effectivePluginId,
                model: effectiveModel,
                projectId,
            }
            console.log('[ProjectContradictionPanel] start contradiction session', startInput)
            const result = await ai_start_contradiction_session(startInput)
            console.log('[ProjectContradictionPanel] 矛盾检测原始返回（完整）:', JSON.stringify(result, null, 2))
            console.log('[ProjectContradictionPanel] report 字段:', JSON.stringify(result.report, null, 2))
            const record = await ai_get_contradiction_report_entry(result.reportId)
            console.log('[ProjectContradictionPanel] 持久化报告记录（完整）:', JSON.stringify(record, null, 2))
            if (debugRawRef.current) {
                console.log('[ProjectContradictionPanel] 本次检测的原始 AI 输出:', debugRawRef.current)
            }
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
                    model: result.model ?? effectiveModel,
                    reportContext: buildReportConversationContext(record),
                })
            }
            await showAlert('矛盾检测完成，右侧已为这份报告新建讨论对话。', 'success', 'toast', 2200)
        } catch (error) {
            console.error('[ProjectContradictionPanel] 生成矛盾检测报告失败', {
                error,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                effectivePluginId,
                effectiveModel,
                projectId,
            })
            const errorMsg = error instanceof Error ? error.message : String(error)
            const userFriendly = errorMsg === 'error decoding response body'
                ? 'AI 返回的内容格式异常，无法生成矛盾报告。请检查 AI 模型返回是否符合预期格式，或换一个模型重试。'
                : `生成矛盾检测报告失败：${errorMsg}`
            await showAlert(userFriendly, 'error', 'toast', 3000)
        } finally {
            setGenerating(false)
        }
    }, [effectiveModel, effectivePluginId, loadHistory, onStartDiscussion, projectId, projectName, showAlert])

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
        const model = activeRecord.model ?? effectiveModel
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
    }, [activeRecord, effectiveModel, onStartDiscussion, showAlert])

    const [entryTitleMap, setEntryTitleMap] = useState<Record<string, string>>({})

    useEffect(() => {
        if (!activeRecord) {
            setEntryTitleMap({})
            return
        }
        const ids = new Set<string>()
        for (const issue of activeRecord.report.issues) {
            for (const id of issue.relatedEntryIds) ids.add(id)
        }
        if (ids.size === 0) return
        const idList = [...ids]
        Promise.allSettled(idList.map((id) => db_get_entry(id))).then((results) => {
            const map: Record<string, string> = {}
            idList.forEach((id, i) => {
                const r = results[i]
                map[id] = r.status === 'fulfilled' ? r.value.title : id
            })
            setEntryTitleMap(map)
        }).catch(() => {})
    }, [activeRecord])

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
            <div className="pe-contradiction-toolbar fc-op-header">
                <div className="pe-contradiction-toolbar__left">
                    <button type="button" className="fc-op-back-btn" onClick={onBack}>
                        <BackArrow/>返回
                    </button>
                    <div className="fc-op-header__title-block">
                        <h2 className="pe-contradiction-title fc-op-header__title">设定矛盾检测</h2>
                        <p className="pe-contradiction-desc fc-op-header__subtitle">生成结构化报告，保留历史记录，并可在右侧聊天区继续讨论这份报告。</p>
                    </div>
                </div>
                <div className="pe-contradiction-toolbar__actions fc-op-header__actions">
                    <div className="pe-contradiction-model-selectors">
                        <Select
                            options={plugins.map((p) => ({value: p.id, label: p.name}))}
                            value={effectivePluginId ?? ''}
                            onChange={(v) => {
                                setLocalPluginId(String(v))
                                setLocalModel(null)
                            }}
                            placeholder="选择插件"
                            radius="md"
                            triggerBackground="var(--fc-color-bg)"
                            triggerBorderColor="var(--fc-color-border)"
                            selectedColor="var(--fc-color-primary)"
                            selectedBackground="var(--fc-color-primary-subtle)"
                        />
                        {selectedPluginInfo && (
                            <Select
                                options={(selectedPluginInfo.models ?? []).map((m) => ({value: m, label: m}))}
                                value={effectiveModel ?? ''}
                                onChange={(v) => setLocalModel(String(v))}
                                placeholder="选择模型"
                                radius="md"
                                triggerBackground="var(--fc-color-bg)"
                                triggerBorderColor="var(--fc-color-border)"
                                selectedColor="var(--fc-color-primary)"
                                selectedBackground="var(--fc-color-primary-subtle)"
                            />
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void loadHistory()}
                            disabled={historyLoading || generating}>
                        刷新历史
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => void handleGenerate()} disabled={generating}>
                        {generating ? (
                            <span>{progressMessage ?? '检测中…'}</span>
                        ) : '生成新报告'}
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
                                    className={`pe-contradiction-history__item fc-op-item${item.reportId === selectedReportId ? ' is-active' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className="fc-op-item__content"
                                        onClick={() => setSelectedReportId(item.reportId)}
                                    >
                                        <div className="pe-contradiction-history__topline">
                                            <span
                                                className="fc-op-item__meta">{formatDateTime(item.createdAt)}</span>
                                            <span
                                                className="fc-op-count">{item.issueCount} 个冲突</span>
                                        </div>
                                        <div className="fc-op-item__title">{item.overview}</div>
                                        <div className="fc-op-item__meta">
                                            <span>{item.scopeSummary}</span>
                                            {item.truncated &&
                                                <span className="fc-op-hint--error">已裁剪</span>}
                                        </div>
                                    </button>
                                    <div className="fc-op-item__actions">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handleDelete(item.reportId)}
                                        >
                                            删除
                                        </Button>
                                    </div>
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
                                        <div className="pe-contradiction-report__hero-main">
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
                                                            <span className="pe-contradiction-chip-list__label">相关词条</span>
                                                            {issue.relatedEntryIds.map((entryId) => (
                                                                <button
                                                                    key={`${issue.issueId}-${entryId}`}
                                                                    type="button"
                                                                    className="pe-contradiction-chip pe-contradiction-chip--entry"
                                                                    onClick={() => onOpenEntry?.({
                                                                        id: entryId,
                                                                        title: entryTitleMap[entryId] ?? entryId,
                                                                    })}
                                                                >
                                                                    {entryTitleMap[entryId] ?? entryId}
                                                                </button>
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
