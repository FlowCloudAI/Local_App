/**
 * 设定检测任务的桌面端状态视图。
 *
 * 页面摘要负责在浮层收起后保留进度入口；监视器负责完整阶段、运行记录、错误与终态操作。
 * 两者只消费后台任务快照，不启动命令，也不持有任务生命周期。
 */
import {useEffect, useMemo, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import {
    getWorldCheckPhaseStatus,
    WORLD_CHECK_PHASES,
    type WorldCheckTask,
    type WorldCheckTaskPhase,
} from '../../stores/worldCheckTaskModel'

const PHASE_COPY: Record<WorldCheckTaskPhase, {title: string; pending: string}> = {
    prepare: {title: '准备资料', pending: '等待载入项目资料'},
    analyze: {title: 'AI 分析', pending: '等待 AI 开始分析'},
    validate: {title: '校验报告', pending: '等待模型输出'},
    persist: {title: '保存完成', pending: '尚未写入历史'},
}

const STAGE_LABELS: Record<WorldCheckTaskPhase, string> = {
    prepare: '准备资料',
    analyze: 'AI 分析',
    validate: '报告校验',
    persist: '保存报告',
}

const KIND_LABELS: Record<WorldCheckTask['checkKind'], string> = {
    contradiction: '矛盾检测',
    entry_alignment: '单词条契合度',
    publication_risk: '出版风险',
}

function useTaskClock(task: WorldCheckTask) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (task.finishedAt) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [task.finishedAt])
    return task.finishedAt ?? now
}

function formatElapsed(startedAt: number, currentAt: number) {
    const seconds = Math.max(0, Math.floor((currentAt - startedAt) / 1000))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainder = seconds % 60
    return hours > 0
        ? [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
        : [minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

function taskStatusCopy(task: WorldCheckTask) {
    switch (task.status) {
        case 'failed':
            return {label: '检测失败', title: `${KIND_LABELS[task.checkKind]}需要处理`, action: '查看错误'}
        case 'success':
            return {label: '已完成', title: `${KIND_LABELS[task.checkKind]}报告已完成`, action: '查看结果'}
        case 'cancelled':
            return {label: '已取消', title: `${KIND_LABELS[task.checkKind]}已停止`, action: '查看记录'}
        case 'cancelling':
            return {label: '停止中', title: `正在停止${KIND_LABELS[task.checkKind]}`, action: '查看进度'}
        default:
            return {label: '运行中', title: `${KIND_LABELS[task.checkKind]}正在后台运行`, action: '查看进度'}
    }
}

function phaseDetail(task: WorldCheckTask, phase: WorldCheckTaskPhase) {
    const status = getWorldCheckPhaseStatus(task, phase)
    if (status === 'done') {
        if (phase === 'prepare') return task.sourceEntryCount == null ? '资料已载入' : `已载入 ${task.sourceEntryCount} 个词条`
        if (phase === 'analyze') return `完成 ${task.toolCallCount} 次工具调用`
        if (phase === 'validate') return '报告结构与引用有效'
        return '已写入历史记录'
    }
    if (status === 'failed') return task.errors[0]?.message ?? '当前阶段失败'
    if (status === 'cancelled') return '用户已停止'
    if (status === 'active') return task.currentActivity
    return PHASE_COPY[phase].pending
}

interface WorldCheckTaskCardProps {
    task: WorldCheckTask
    onOpen: () => void
}

export function WorldCheckTaskCard({task, onOpen}: WorldCheckTaskCardProps) {
    const currentAt = useTaskClock(task)
    const copy = taskStatusCopy(task)
    return (
        <section className={`pe-world-check-task-card is-${task.status}`} aria-label={copy.title}>
            <div className="pe-world-check-task-card__main">
                <div className="pe-world-check-task-card__heading">
                    <h3>{copy.title}</h3>
                    <span className="pe-world-check-task-card__badge">
                        {copy.label} · {formatElapsed(task.startedAt, currentAt)}
                    </span>
                </div>
                <p>{task.currentActivity}</p>
                <div className="pe-world-check-task-card__metrics">
                    <span>{task.toolCallCount} 次工具调用</span>
                    {task.retryCount > 0 && <span>{task.retryCount} 次重试</span>}
                    <span>输出 {task.outputChars} 字符</span>
                </div>
            </div>
            <Button type="button" variant="primary" size="sm" onClick={onOpen}>
                {copy.action}
            </Button>
            <div className="pe-world-check-task-card__phases" aria-label="检测阶段">
                {WORLD_CHECK_PHASES.map((phase) => (
                    <span key={phase} data-status={getWorldCheckPhaseStatus(task, phase)}>
                        {PHASE_COPY[phase].title}
                    </span>
                ))}
            </div>
        </section>
    )
}

interface WorldCheckTaskMonitorProps {
    task: WorldCheckTask
    onClose: () => void
    onCancel: () => void
    onRetry: () => void
    onOpenReport: () => void
    onDiscuss: () => void
}

export function WorldCheckTaskMonitor({
    task,
    onClose,
    onCancel,
    onRetry,
    onOpenReport,
    onDiscuss,
}: WorldCheckTaskMonitorProps) {
    const currentAt = useTaskClock(task)
    const elapsed = formatElapsed(task.startedAt, currentAt)
    const copy = taskStatusCopy(task)
    const primaryError = task.errors[0] ?? null
    const technicalDetail = useMemo(
        () => primaryError?.detail ? JSON.stringify(primaryError.detail, null, 2) : null,
        [primaryError],
    )

    const handleCopyDiagnostics = async () => {
        const diagnostics = {
            projectId: task.projectId,
            sessionId: task.sessionId,
            runId: task.runId,
            status: task.status,
            phase: task.phase,
            errors: task.errors,
            events: task.events,
        }
        await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
    }

    return (
        <FloatingPanel
            open={task.monitorOpen}
            onClose={onClose}
            dismissible
            title={`${KIND_LABELS[task.checkKind]} · ${task.projectName}`}
            closeLabel="收起并继续后台运行"
            layerClassName="pe-world-check-monitor-layer"
            className="pe-world-check-monitor"
        >
            <div className="pe-world-check-monitor__statusbar">
                <span className={`pe-world-check-monitor__badge is-${task.status}`} aria-live="polite">{copy.label}</span>
                <span className="pe-world-check-monitor__elapsed">{elapsed}</span>
            </div>

            <div className="pe-world-check-monitor__phases" aria-label="检测阶段">
                {WORLD_CHECK_PHASES.map((phase) => (
                    <div key={phase} className="pe-world-check-monitor__phase" data-status={getWorldCheckPhaseStatus(task, phase)}>
                        <span className="pe-world-check-monitor__phase-dot"/>
                        <div>
                            <strong>{PHASE_COPY[phase].title}</strong>
                            <small>{phaseDetail(task, phase)}</small>
                        </div>
                    </div>
                ))}
            </div>

            <div className="pe-world-check-monitor__body">
                <section className="pe-world-check-monitor__main">
                    {task.status === 'failed' && primaryError ? (
                        <div className="pe-world-check-monitor__hero is-error">
                            <h3>{STAGE_LABELS[primaryError.stage]}失败</h3>
                            <p>{primaryError.message}</p>
                            <code>{primaryError.code} · stage: {primaryError.stage}</code>
                            {technicalDetail && (
                                <details>
                                    <summary>查看技术详情</summary>
                                    <pre>{technicalDetail}</pre>
                                </details>
                            )}
                        </div>
                    ) : task.status === 'success' ? (
                        <div className="pe-world-check-monitor__hero is-success">
                            <h3>检测报告已生成并保存</h3>
                            <p>报告已进入当前项目的历史记录。不会自动打开 AI 对话，可先查看结果再决定是否讨论。</p>
                        </div>
                    ) : task.status === 'cancelled' ? (
                        <div className="pe-world-check-monitor__hero is-cancelled">
                            <h3>检测已停止</h3>
                            <p>任务没有继续生成或修改报告，停止前的运行记录仍保留在这里。</p>
                        </div>
                    ) : (
                        <div className="pe-world-check-monitor__hero is-running">
                            <h3>{task.currentActivity}</h3>
                            <p>浮层可以随时收起；任务会继续在后台运行。</p>
                        </div>
                    )}

                    <div className="pe-world-check-monitor__section-title">
                        <h3>{task.status === 'failed' ? '本次异常与运行记录' : '运行记录'}</h3>
                        <span>{task.events.length} 条</span>
                    </div>
                    <ol className="pe-world-check-monitor__events">
                        {task.events.map((event) => (
                            <li key={event.id} data-level={event.level}>
                                <time>{formatElapsed(task.startedAt, event.at)}</time>
                                <span className="pe-world-check-monitor__event-dot"/>
                                <div>
                                    <strong>{event.title}</strong>
                                    <p>{event.detail}</p>
                                </div>
                                <span>{event.status}</span>
                            </li>
                        ))}
                    </ol>
                </section>

                <aside className="pe-world-check-monitor__aside">
                    <section>
                        <h3>本次检测</h3>
                        <dl>
                            <div><dt>项目</dt><dd>{task.projectName}</dd></div>
                            <div><dt>类型</dt><dd>{KIND_LABELS[task.checkKind]}</dd></div>
                            <div><dt>插件</dt><dd>{task.pluginId}</dd></div>
                            <div><dt>模型</dt><dd>{task.model}</dd></div>
                            <div><dt>范围</dt><dd>{task.scopeSummary ?? '正在准备'}</dd></div>
                            <div><dt>会话</dt><dd title={task.sessionId}>{task.sessionId}</dd></div>
                        </dl>
                    </section>
                    <section>
                        <h3>{task.status === 'failed' ? '失败摘要' : '实时摘要'}</h3>
                        <ul>
                            <li>{task.toolCallCount} 次工具调用</li>
                            <li>{task.retryCount} 次重试</li>
                            <li>报告输出 {task.outputChars} 字符</li>
                            {task.truncated && <li className="is-warning">检测资料达到字符上限</li>}
                            {task.errors.length > 0 && <li className="is-error">{task.errors.length} 个终止错误</li>}
                        </ul>
                    </section>
                    <section>
                        <h3>显示规则</h3>
                        <ul>
                            <li>完整工具参数和原始 JSON 默认隐藏。</li>
                            <li>相同终止错误只显示一次，工具异常按时间保留。</li>
                            <li>错误只属于本检测任务，不会写入右侧 AI 对话。</li>
                        </ul>
                    </section>
                </aside>
            </div>

            <footer className="pe-world-check-monitor__footer">
                <span>
                    {task.status === 'running' || task.status === 'cancelling'
                        ? '收起浮层或离开页面不会终止检测；退出应用仍会结束任务。'
                        : '本次任务记录会保留到开始下一次检测。'}
                </span>
                <div>
                    {task.status === 'running' && (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={onCancel}>停止检测</Button>
                            <Button type="button" variant="primary" size="sm" onClick={onClose}>收起并继续工作</Button>
                        </>
                    )}
                    {task.status === 'cancelling' && (
                        <Button type="button" variant="outline" size="sm" disabled>正在停止…</Button>
                    )}
                    {task.status === 'failed' && (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyDiagnostics()}>复制诊断</Button>
                            <Button type="button" variant="primary" size="sm" onClick={onRetry}>重新检测</Button>
                        </>
                    )}
                    {task.status === 'success' && (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={onOpenReport}>查看报告</Button>
                            <Button type="button" variant="primary" size="sm" onClick={onDiscuss}>讨论这份报告</Button>
                        </>
                    )}
                    {task.status === 'cancelled' && (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={onClose}>关闭</Button>
                            <Button type="button" variant="primary" size="sm" onClick={onRetry}>重新检测</Button>
                        </>
                    )}
                </div>
            </footer>
        </FloatingPanel>
    )
}
