import {logger} from '../../../shared/logger'
import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, RollingBox, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_delete_world_check_report,
    ai_get_world_check_report_entry,
    ai_list_world_check_reports,
    ai_list_plugins,
    ai_start_world_check_session,
    db_list_entries,
    db_get_entry,
    type EntryBrief,
    type PluginInfo,
    type StoredWorldCheckReport,
    type WorldCheckFinding,
    type WorldCheckKind,
    type WorldCheckReport,
    type WorldCheckReportHistoryItem,
} from '../../../api'
import {listen} from '../../../api/events'
import type {ReportConversationContext} from '../../ai-chat/model/AiControllerTypes'
import {normalizeEntryLookupTitle} from '../../entries/lib/entryCommon'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectContradictionPanel.css'

interface ProjectContradictionPanelProps {
    projectId: string
    projectName: string
    aiPluginId?: string | null
    aiModel?: string | null
    activeEntryId?: string | null
    activeEntryTitle?: string | null
    onBack: () => void
    onStartDiscussion?: (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

const CHECK_KIND_OPTIONS: Array<{ value: WorldCheckKind; label: string }> = [
    {value: 'contradiction', label: '矛盾检测'},
    {value: 'entry_alignment', label: '单词条契合度'},
    {value: 'publication_risk', label: '出版风险'},
]

function checkKindLabel(kind: WorldCheckKind): string {
    return CHECK_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? '设定检测'
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

function CloseIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
                d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75"
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

function severityLabel(severity: WorldCheckFinding['severity']): string {
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

function categoryLabel(category: string | null | undefined): string {
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
        case 'rule_mismatch':
            return '规则契合'
        case 'timeline_fit':
            return '时间契合'
        case 'relationship_context':
            return '关系上下文'
        case 'geography_fit':
            return '地理契合'
        case 'terminology':
            return '术语体系'
        case 'tone_style':
            return '风格语气'
        case 'missing_context':
            return '待补上下文'
        case 'copyright_similarity':
            return '版权相似'
        case 'trademark_brand':
            return '商标品牌'
        case 'real_person_org':
            return '现实指涉'
        case 'defamation_privacy':
            return '名誉隐私'
        case 'sensitive_content':
            return '敏感内容'
        case 'age_rating':
            return '分级风险'
        case 'legal_compliance':
            return '合规风险'
        case 'platform_policy':
            return '平台审核'
        default:
            return '其他'
    }
}

function reportStatus(report: WorldCheckReport, kind: WorldCheckKind): string {
    if (kind === 'entry_alignment' && typeof report.score === 'number') return `契合度 ${Math.round(report.score)}`
    if (kind === 'publication_risk' && typeof report.score === 'number') return `风险指数 ${Math.round(report.score)}`
    if (report.findings.some((finding) => finding.severity === 'critical')) return '高风险'
    if (report.findings.some((finding) => finding.severity === 'high')) return '需重点处理'
    if (report.findings.length > 0) return '存在问题'
    if (report.unresolvedQuestions.length > 0) return '待补证据'
    return '整体稳定'
}

function buildReportConversationContext(record: StoredWorldCheckReport): ReportConversationContext {
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
                                        activeEntryId = null,
                                        activeEntryTitle = null,
                                        onBack,
                                        onStartDiscussion,
                                        onOpenEntry,
                                    }: ProjectContradictionPanelProps) {
    const {showAlert} = useAlert()
    const [checkKind, setCheckKind] = useState<WorldCheckKind>('contradiction')
    const [targetEntryId, setTargetEntryId] = useState('')
    const [targetEntryQuery, setTargetEntryQuery] = useState(activeEntryTitle ?? '')
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entriesLoading, setEntriesLoading] = useState(false)

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
            .catch((err) => logger.warn('[ContradictionPanel] 获取插件列表失败', err))
    }, [])

    const [historyItems, setHistoryItems] = useState<WorldCheckReportHistoryItem[]>([])
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
    const [activeRecord, setActiveRecord] = useState<StoredWorldCheckReport | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
    const [progressMessage, setProgressMessage] = useState<string | null>(null)
    const debugRawRef = useRef<string | null>(null)

    const selectedTargetEntry = useMemo(
        () => projectEntries.find((entry) => entry.id === targetEntryId) ?? null,
        [projectEntries, targetEntryId],
    )

    const targetEntryOptions = useMemo(() => {
        const query = normalizeEntryLookupTitle(targetEntryQuery)
        const entries = query
            ? projectEntries.filter((entry) => normalizeEntryLookupTitle(entry.title).startsWith(query))
            : projectEntries
        return entries.slice(0, 3)
    }, [projectEntries, targetEntryQuery])

    // 监听进度报告事件
    useEffect(() => {
        let unlistenFn: (() => void) | null = null
        listen('ai:world_check_progress', (event) => {
            const payload = event.payload as Record<string, unknown>
            const msg = String(payload?.message ?? '')
            if (msg) {
                setProgressMessage(msg)
                logger.log('[WorldCheckPanel] 进度:', msg)
            }
        }).then((fn) => {
            unlistenFn = fn
        })
        return () => {
            unlistenFn?.()
        }
    }, [])

    useEffect(() => {
        if (checkKind === 'entry_alignment' && !targetEntryId && activeEntryId) {
            setTargetEntryId(activeEntryId)
            setTargetEntryQuery(activeEntryTitle ?? '')
        }
    }, [activeEntryId, activeEntryTitle, checkKind, targetEntryId])

    useEffect(() => {
        if (!generateDialogOpen || checkKind !== 'entry_alignment' || projectEntries.length > 0) return
        let cancelled = false
        setEntriesLoading(true)
        db_list_entries({projectId, limit: 1000, offset: 0})
            .then((entries) => {
                if (cancelled) return
                setProjectEntries(entries)
            })
            .catch(async (error) => {
                if (cancelled) return
                logger.error('加载词条候选失败', error)
                await showAlert(`加载词条候选失败：${String(error)}`, 'error', 'nonInvasive', 2400)
            })
            .finally(() => {
                if (!cancelled) setEntriesLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [checkKind, generateDialogOpen, projectEntries.length, projectId, showAlert])

    useEffect(() => {
        setProjectEntries([])
    }, [projectId])

    useEffect(() => {
        if (!selectedTargetEntry) return
        if (targetEntryQuery.trim()) return
        setTargetEntryQuery(selectedTargetEntry.title)
    }, [selectedTargetEntry, targetEntryQuery])

    // 监听 Rust 端发出的原始 AI 响应，用于调试
    useEffect(() => {
        let unlistenFn: (() => void) | null = null
        listen('ai:debug_raw_response', (event) => {
            const payload = event.payload as Record<string, unknown>
            const text = String(payload?.text ?? '')
            debugRawRef.current = text
            logger.log('[ContradictionPanel] 原始 AI 响应（完整）:', text)
            const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/{[\s\S]*"overview"[\s\S]*}/)
            if (jsonMatch) {
                logger.log('[ContradictionPanel] 提取的 JSON 候选:', jsonMatch[1] ?? jsonMatch[0])
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
            const items = await ai_list_world_check_reports(projectId, null)
            setHistoryItems(items)
            setSelectedReportId((current) => {
                if (current && items.some((item) => item.reportId === current)) return current
                return items[0]?.reportId ?? null
            })
            if (items.length === 0) {
                setActiveRecord(null)
            }
        } catch (error) {
            logger.error('加载设定检测历史失败', error)
            await showAlert(`加载设定检测历史失败：${String(error)}`, 'error', 'nonInvasive', 2600)
        } finally {
            setHistoryLoading(false)
        }
    }, [projectId, showAlert, setSelectedReportId])

    useEffect(() => {
        void loadHistory()
    }, [loadHistory])

    useEffect(() => {
        if (!selectedReportId) return
        let cancelled = false
        setDetailLoading(true)
        ai_get_world_check_report_entry(selectedReportId)
            .then((record) => {
                if (cancelled) return
                setActiveRecord(record)
            })
            .catch(async (error) => {
                if (cancelled) return
                logger.error('加载设定检测报告失败', error)
                await showAlert(`加载报告失败：${String(error)}`, 'error', 'nonInvasive', 2600)
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
            await showAlert('请先选择 AI 插件和模型。', 'warning', 'nonInvasive', 2200)
            return
        }
        const resolvedTargetEntryId = targetEntryId.trim()
        if (checkKind === 'entry_alignment' && !resolvedTargetEntryId) {
            await showAlert('单词条契合度检测需要先选择目标词条。', 'warning', 'nonInvasive', 2400)
            return
        }

        setGenerating(true)
        setProgressMessage(null)
        try {
            const startInput = {
                sessionId: `world_check_${checkKind}_${Date.now()}`,
                pluginId: effectivePluginId,
                model: effectiveModel,
                projectId,
                checkKind,
                targetEntryId: checkKind === 'entry_alignment' ? resolvedTargetEntryId : null,
            }
            logger.log('[ProjectContradictionPanel] start world check session', startInput)
            const result = await ai_start_world_check_session(startInput)
            logger.log('[ProjectContradictionPanel] 设定检测原始返回（完整）:', JSON.stringify(result, null, 2))
            logger.log('[ProjectContradictionPanel] report 字段:', JSON.stringify(result.report, null, 2))
            const record = await ai_get_world_check_report_entry(result.reportId)
            logger.log('[ProjectContradictionPanel] 持久化报告记录（完整）:', JSON.stringify(record, null, 2))
            if (debugRawRef.current) {
                logger.log('[ProjectContradictionPanel] 本次检测的原始 AI 输出:', debugRawRef.current)
            }
            if (!record) {
                throw new Error('新生成的检测报告未能写入历史记录')
            }
            await loadHistory()
            setSelectedReportId(record.reportId)
            setActiveRecord(record)
            if (onStartDiscussion) {
                onStartDiscussion({
                    title: `${checkKindLabel(checkKind)}：${projectName}`,
                    pluginId: result.pluginId,
                    model: result.model ?? effectiveModel,
                    reportContext: buildReportConversationContext(record),
                })
            }
            setGenerateDialogOpen(false)
            await showAlert('设定检测完成，右侧已为这份报告新建讨论对话。', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('[ProjectContradictionPanel] 生成设定检测报告失败', {
                error,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                effectivePluginId,
                effectiveModel,
                projectId,
                checkKind,
            })
            const errorMsg = error instanceof Error ? error.message : String(error)
            const userFriendly = errorMsg === 'error decoding response body'
                ? 'AI 返回的内容格式异常，无法生成检测报告。请检查 AI 模型返回是否符合预期格式，或换一个模型重试。'
                : `生成设定检测报告失败：${errorMsg}`
            await showAlert(userFriendly, 'error', 'nonInvasive', 3000)
        } finally {
            setGenerating(false)
        }
    }, [checkKind, effectiveModel, effectivePluginId, loadHistory, onStartDiscussion, projectId, projectName, showAlert, setSelectedReportId, targetEntryId])

    const handleDelete = useCallback(async (reportId: string) => {
        const confirmed = await showAlert('删除后将无法在历史中恢复这份报告。是否继续？', 'warning', 'confirm')
        if (confirmed !== 'yes') return
        try {
            await ai_delete_world_check_report(reportId)
            setHistoryItems((prev) => prev.filter((item) => item.reportId !== reportId))
            if (selectedReportId === reportId) {
                const next = historyItems.find((item) => item.reportId !== reportId)
                setSelectedReportId(next?.reportId ?? null)
                if (!next) {
                    setActiveRecord(null)
                }
            }
            await showAlert('报告已删除。', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('删除设定检测报告失败', error)
            await showAlert(`删除报告失败：${String(error)}`, 'error', 'nonInvasive', 2600)
        }
    }, [historyItems, selectedReportId, showAlert, setSelectedReportId])

    const handleStartDiscussion = useCallback(async () => {
        if (!activeRecord || !onStartDiscussion) return
        const model = activeRecord.model ?? effectiveModel
        if (!model) {
            await showAlert('当前缺少可用模型，无法创建报告讨论对话。', 'warning', 'nonInvasive', 2200)
            return
        }
        onStartDiscussion({
            title: `${checkKindLabel(activeRecord.checkKind)}：${activeRecord.projectName}`,
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
        for (const finding of activeRecord.report.findings) {
            for (const id of finding.relatedEntryIds) ids.add(id)
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
        const findings = activeRecord.report.findings
        return {
            findingCount: findings.length,
            unresolvedCount: activeRecord.report.unresolvedQuestions.length,
            status: reportStatus(activeRecord.report, activeRecord.checkKind),
            severityDist: {
                critical: findings.filter((i) => i.severity === 'critical').length,
                high: findings.filter((i) => i.severity === 'high').length,
                medium: findings.filter((i) => i.severity === 'medium').length,
                low: findings.filter((i) => i.severity === 'low').length,
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
                        <h2 className="pe-contradiction-title fc-op-header__title">设定检测</h2>
                        <p className="pe-contradiction-desc fc-op-header__subtitle">生成结构化检测报告，保留历史记录，并可在右侧聊天区继续讨论这份报告。</p>
                    </div>
                </div>
                <div className="pe-contradiction-toolbar__actions fc-op-header__actions">
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadHistory()}
                            disabled={historyLoading || generating}>
                        刷新历史
                    </Button>
                    <Button type="button" variant="primary" size="sm" onClick={() => setGenerateDialogOpen(true)} disabled={generating}>
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
                    <RollingBox axis="y" className="pe-contradiction-history__scroll" thumbSize="thin">
                        <div className="pe-contradiction-history__list">
                            {historyLoading && historyItems.length === 0 ? (
                                <div className="pe-contradiction-empty">正在加载历史报告…</div>
                            ) : historyItems.length === 0 ? (
                                <div className="pe-contradiction-empty">还没有生成过检测报告。</div>
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
                                                className="fc-op-count">{item.findingCount} 个问题</span>
                                            <span className="fc-op-count">{checkKindLabel(item.checkKind)}</span>
                                        </div>
                                        <div className="fc-op-item__title">{item.overview}</div>
                                        <div className="fc-op-item__meta">
                                            <span>{item.scopeSummary}</span>
                                            {item.truncated &&
                                                <span className="fc-op-hint--error">已裁剪</span>}
                                        </div>
                                    </button>
                                    <div className="fc-op-item__actions">
                                        <Button type="button"
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
                            请选择一份历史报告，或直接生成新的检测结果。
                        </div>
                    ) : detailLoading ? (
                        <div className="pe-contradiction-empty pe-contradiction-empty--large">
                            正在加载报告详情…
                        </div>
                    ) : (
                        <div className="pe-contradiction-report__body">
                            <RollingBox axis="y" className="pe-contradiction-report__scroll" thumbSize="thin">
                                <div className="pe-contradiction-report__content">
                                    <div className="pe-contradiction-report__hero">
                                        <div className="pe-contradiction-report__hero-main">
                                            <div className="pe-contradiction-report__meta">
                                                <span>{formatDateTime(activeRecord.createdAt)}</span>
                                                <span>{checkKindLabel(activeRecord.checkKind)}</span>
                                                <span>范围：{activeRecord.scopeSummary}</span>
                                                {activeRecord.truncated && <span
                                                    className="pe-contradiction-report__warning">本次资料已裁剪</span>}
                                            </div>
                                            <h3 className="pe-contradiction-report__title">{summary?.status}</h3>
                                            <p className="pe-contradiction-report__overview">{activeRecord.report.overview}</p>
                                        </div>
                                        <div className="pe-contradiction-report__hero-actions">
                                            <Button type="button" variant="outline" size="sm"
                                                    onClick={() => void handleStartDiscussion()}>
                                                在右侧继续讨论
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="pe-contradiction-stats">
                                        <div className="pe-contradiction-stat-card">
                                            <span
                                                className="pe-contradiction-stat-card__value">{summary?.findingCount ?? 0}</span>
                                            <span className="pe-contradiction-stat-card__label">问题条目</span>
                                            {(summary?.findingCount ?? 0) > 0 && (
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
                                            <h4 className="pe-contradiction-section__title fc-section-title">问题清单</h4>
                                            <span
                                                className="pe-contradiction-section__meta">{activeRecord.report.findings.length} 项</span>
                                        </div>
                                        <div className="pe-contradiction-issue-list">
                                            {activeRecord.report.findings.length === 0 ? (
                                                <div
                                                    className="pe-contradiction-empty">当前范围内没有发现明确问题。</div>
                                            ) : activeRecord.report.findings.map((finding) => (
                                                <article key={finding.findingId}
                                                         className={`pe-contradiction-issue-card is-severity-${finding.severity}`}>
                                                    <div className="pe-contradiction-issue-card__header">
                                                        <div className="pe-contradiction-issue-card__title-group">
                                                        <span
                                                            className={`pe-contradiction-issue-card__severity is-${finding.severity}`}>
                                                            {severityLabel(finding.severity)}
                                                        </span>
                                                            {finding.category && (
                                                                <span className="pe-contradiction-issue-card__category">
                                                                {categoryLabel(finding.category)}
                                                            </span>
                                                            )}
                                                            <h5 className="pe-contradiction-issue-card__title">{finding.title}</h5>
                                                        </div>
                                                        <span
                                                            className="pe-contradiction-issue-card__id">{finding.findingId}</span>
                                                    </div>
                                                    <p className="pe-contradiction-issue-card__desc">{finding.description}</p>
                                                    {finding.relatedEntryIds.length > 0 && (
                                                        <div className="pe-contradiction-chip-list">
                                                            <span className="pe-contradiction-chip-list__label">相关词条</span>
                                                            {finding.relatedEntryIds.map((entryId) => (
                                                                <button
                                                                    key={`${finding.findingId}-${entryId}`}
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
                                                        {finding.evidence.map((evidence, index) => (
                                                            <div key={`${finding.findingId}-${index}`}
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
                                                    {finding.recommendation && (
                                                        <div className="pe-contradiction-issue-card__recommendation">
                                                            <strong>建议：</strong>{finding.recommendation}
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
            {generateDialogOpen && (
                <div className="pe-contradiction-modal" role="dialog" aria-modal="true" aria-labelledby="pe-generate-report-title">
                    <div className="pe-contradiction-modal__dialog">
                        <div className="pe-contradiction-modal__header">
                            <div>
                                <h3 id="pe-generate-report-title" className="pe-contradiction-modal__title">生成新报告</h3>
                                <p className="pe-contradiction-modal__desc">选择检测方式、AI 插件和模型后开始生成。</p>
                            </div>
                            <button
                                type="button"
                                className="pe-contradiction-modal__close"
                                onClick={() => setGenerateDialogOpen(false)}
                                aria-label="关闭"
                                disabled={generating}
                            >
                                <CloseIcon/>
                            </button>
                        </div>
                        <div className="pe-contradiction-modal__body">
                            <label className="pe-contradiction-field">
                                <span>检测类型</span>
                                <Select
                                    options={CHECK_KIND_OPTIONS}
                                    value={checkKind}
                                    onChange={(v) => setCheckKind(String(v) as WorldCheckKind)}
                                    placeholder="检测类型"
                                    radius="md"
                                    triggerBackground="var(--fc-color-bg)"
                                    triggerBorderColor="var(--fc-color-border)"
                                    selectedColor="var(--fc-color-primary)"
                                    selectedBackground="var(--fc-color-primary-subtle)"
                                />
                            </label>
                            {checkKind === 'entry_alignment' && (
                                <div className="pe-contradiction-field">
                                    <span>目标词条</span>
                                    <input
                                        className="pe-contradiction-target-input"
                                        value={targetEntryQuery}
                                        onChange={(event) => {
                                            setTargetEntryQuery(event.target.value)
                                            if (selectedTargetEntry?.title !== event.target.value) {
                                                setTargetEntryId('')
                                            }
                                        }}
                                        placeholder={activeEntryTitle ? `当前：${activeEntryTitle}` : '输入词条名前缀搜索'}
                                    />
                                    {selectedTargetEntry && (
                                        <div className="pe-contradiction-target-selected">
                                            已选择：{selectedTargetEntry.title}
                                        </div>
                                    )}
                                    <div className="pe-contradiction-entry-options">
                                        {entriesLoading ? (
                                            <div className="pe-contradiction-entry-options__empty">正在加载词条…</div>
                                        ) : targetEntryOptions.length > 0 ? (
                                            targetEntryOptions.map((entry) => (
                                                <button
                                                    key={entry.id}
                                                    type="button"
                                                    className={`pe-contradiction-entry-option${entry.id === targetEntryId ? ' is-active' : ''}`}
                                                    onClick={() => {
                                                        setTargetEntryId(entry.id)
                                                        setTargetEntryQuery(entry.title)
                                                    }}
                                                >
                                                    <span className="pe-contradiction-entry-option__title">{entry.title}</span>
                                                    {entry.summary && (
                                                        <span className="pe-contradiction-entry-option__meta">{entry.summary}</span>
                                                    )}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="pe-contradiction-entry-options__empty">
                                                {targetEntryQuery.trim() ? '没有匹配的词条' : '输入词条名前缀以搜索'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <label className="pe-contradiction-field">
                                <span>AI 插件</span>
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
                            </label>
                            <label className="pe-contradiction-field">
                                <span>模型</span>
                                <Select
                                    options={(selectedPluginInfo?.models ?? []).map((m) => ({value: m, label: m}))}
                                    value={effectiveModel ?? ''}
                                    onChange={(v) => setLocalModel(String(v))}
                                    placeholder="选择模型"
                                    radius="md"
                                    triggerBackground="var(--fc-color-bg)"
                                    triggerBorderColor="var(--fc-color-border)"
                                    selectedColor="var(--fc-color-primary)"
                                    selectedBackground="var(--fc-color-primary-subtle)"
                                />
                            </label>
                        </div>
                        <div className="pe-contradiction-modal__footer">
                            <Button type="button" variant="outline" size="sm" onClick={() => setGenerateDialogOpen(false)} disabled={generating}>
                                取消
                            </Button>
                            <Button type="button" variant="primary" size="sm" onClick={() => void handleGenerate()} disabled={generating}>
                                {generating ? (progressMessage ?? '检测中…') : '开始生成'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default memo(ProjectContradictionPanel)
