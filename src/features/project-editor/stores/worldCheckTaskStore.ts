/**
 * 桌面端设定检测后台任务仓库。
 *
 * 检测命令和 Tauri 事件在页面卸载后仍由本模块接管；页面组件只订阅快照，不再拥有任务
 * 生命周期。任务仅保存在当前应用进程中，退出应用后的恢复不属于本模块职责。
 */
import {useEffect, useSyncExternalStore} from 'react'
import {
    ai_cancel_session,
    ai_get_world_check_report_entry,
    ai_start_world_check_session,
    toApiError,
    type AiEventContextTrimmed,
    type AiEventDelta,
    type AiEventError,
    type AiEventReady,
    type AiEventToolCall,
    type AiEventToolResult,
    type AiEventToolRetrying,
    type AiEventTurnBegin,
    type AiEventTurnEnd,
    type ApiError,
    type WorldCheckSessionRequest,
} from '../../../api'
import {listen} from '../../../api/events'
import {logger} from '../../../shared/logger'
import {
    appendUniqueWorldCheckError,
    type WorldCheckTask,
    type WorldCheckTaskError,
    type WorldCheckTaskEvent,
    type WorldCheckTaskPhase,
} from './worldCheckTaskModel'

interface WorldCheckTaskSnapshot {
    tasks: Record<string, WorldCheckTask>
    version: number
}

interface StartWorldCheckTaskInput {
    request: WorldCheckSessionRequest
    projectName: string
}

const MAX_RETAINED_EVENTS = 80
const listeners = new Set<() => void>()
const inFlightByProject = new Map<string, Promise<WorldCheckTask>>()
const cancellationByProject = new Map<string, Promise<void>>()
const toolStartedAt = new Map<string, number>()

let snapshot: WorldCheckTaskSnapshot = {tasks: {}, version: 0}
let eventListenersPromise: Promise<void> | null = null

const TOOL_LABELS: Record<string, string> = {
    get_project_summary: '读取项目摘要',
    list_all_entries: '读取项目词条',
    search_entries: '搜索相关词条',
    get_entry: '读取词条详情',
    get_entry_content_by_line: '核对词条原文',
    get_entry_relations: '读取词条关系',
    list_categories: '读取分类结构',
    list_entries_by_type: '读取同类型词条',
    list_tag_schemas: '读取标签规则',
    list_entry_types: '读取词条类型',
    list_projects: '读取项目资料',
    web_search: '搜索外部资料',
    open_url: '读取外部资料',
}

function emit() {
    for (const listener of listeners) listener()
}

function setTask(projectId: string, update: (task: WorldCheckTask) => WorldCheckTask) {
    const current = snapshot.tasks[projectId]
    if (!current) return
    snapshot = {
        tasks: {...snapshot.tasks, [projectId]: update(current)},
        version: snapshot.version + 1,
    }
    emit()
}

function putTask(task: WorldCheckTask) {
    snapshot = {
        tasks: {...snapshot.tasks, [task.projectId]: task},
        version: snapshot.version + 1,
    }
    emit()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getSnapshot() {
    return snapshot
}

function findTaskBySession(sessionId: string): WorldCheckTask | null {
    return Object.values(snapshot.tasks).find((task) => task.sessionId === sessionId) ?? null
}

function updateTaskBySession(
    sessionId: string,
    update: (task: WorldCheckTask) => WorldCheckTask,
): WorldCheckTask | null {
    const task = findTaskBySession(sessionId)
    if (!task) return null
    setTask(task.projectId, update)
    return snapshot.tasks[task.projectId] ?? null
}

function appendEvent(task: WorldCheckTask, event: WorldCheckTaskEvent): WorldCheckTaskEvent[] {
    const existingIndex = task.events.findIndex((item) => item.id === event.id)
    if (existingIndex >= 0) {
        return task.events.map((item, index) => index === existingIndex ? event : item)
    }
    return [...task.events, event].slice(-MAX_RETAINED_EVENTS)
}

function elapsedSeconds(startedAt: number, at = Date.now()) {
    return Math.max(0, Math.round((at - startedAt) / 1000))
}

function toolLabel(name: string) {
    return TOOL_LABELS[name] ?? `调用工具 ${name}`
}

function toolEventKey(sessionId: string, index: number) {
    return `${sessionId}:${index}`
}

function safeDetail(value: unknown, maxLength = 320) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function normalizePhase(value: unknown, fallback: WorldCheckTaskPhase): WorldCheckTaskPhase {
    return value === 'prepare' || value === 'analyze' || value === 'validate' || value === 'persist'
        ? value
        : fallback
}

function failTask(task: WorldCheckTask, errorValue: unknown, fallbackPhase?: WorldCheckTaskPhase) {
    if (task.status === 'cancelled' || task.status === 'cancelling') return task
    const error = toApiError(errorValue)
    const at = Date.now()
    const stage = normalizePhase(error.detail?.stage, fallbackPhase ?? task.phase)
    const taskError: WorldCheckTaskError = {
        code: error.code,
        message: error.message,
        stage,
        detail: error.detail,
        at,
    }
    return {
        ...task,
        status: 'failed' as const,
        phase: stage,
        finishedAt: at,
        currentActivity: error.message,
        errors: appendUniqueWorldCheckError(task.errors, taskError),
        events: appendEvent(task, {
            id: `terminal-error:${error.code}:${error.message}`,
            at,
            level: 'error',
            title: '检测任务终止',
            detail: error.message,
            status: '终止',
        }),
    }
}

function finishCancelled(task: WorldCheckTask) {
    const at = Date.now()
    return {
        ...task,
        status: 'cancelled' as const,
        finishedAt: at,
        currentActivity: '检测已由用户停止',
        events: appendEvent(task, {
            id: 'terminal-cancelled',
            at,
            level: 'warning',
            title: '用户停止检测',
            detail: '当前 AI 会话已取消，后续工具调用不再执行。',
            status: '已停止',
        }),
    }
}

async function requestCancellation(projectId: string) {
    const existing = cancellationByProject.get(projectId)
    if (existing) return existing
    const task = snapshot.tasks[projectId]
    if (!task || (task.status !== 'running' && task.status !== 'cancelling')) return

    const request = ai_cancel_session(task.sessionId)
        .then(() => {
            setTask(projectId, finishCancelled)
        })
        .catch((error) => {
            const current = snapshot.tasks[projectId]
            if (!current || current.status !== 'cancelling') return
            if (!current.runId) {
                setTask(projectId, (item) => ({
                    ...item,
                    currentActivity: '正在等待 AI 会话就绪后停止',
                }))
                return
            }
            logger.warn('[worldCheckTaskStore] 停止检测失败', error)
            setTask(projectId, (item) => ({
                ...item,
                status: 'running',
                currentActivity: '停止请求失败，检测仍在运行',
                events: appendEvent(item, {
                    id: `cancel-failed:${Date.now()}`,
                    at: Date.now(),
                    level: 'warning',
                    title: '停止请求失败',
                    detail: toApiError(error).message,
                    status: '可重试',
                }),
            }))
        })
        .finally(() => {
            cancellationByProject.delete(projectId)
        })
    cancellationByProject.set(projectId, request)
    return request
}

function retryPendingCancellation(task: WorldCheckTask | null) {
    if (task?.status === 'cancelling') {
        queueMicrotask(() => void requestCancellation(task.projectId))
    }
}

function ensureWorldCheckEventListeners() {
    if (eventListenersPromise) return eventListenersPromise
    eventListenersPromise = Promise.all([
        listen<AiEventReady>('ai:ready', (event) => {
            const task = updateTaskBySession(event.payload.session_id, (current) => ({
                ...current,
                runId: event.payload.run_id,
                currentActivity: current.status === 'cancelling' ? current.currentActivity : 'AI 会话已就绪，正在开始分析',
            }))
            retryPendingCancellation(task)
        }),
        listen<AiEventTurnBegin>('ai:turn_begin', (event) => {
            const at = Date.now()
            const task = updateTaskBySession(event.payload.session_id, (current) => ({
                ...current,
                runId: event.payload.run_id,
                phase: 'analyze',
                currentActivity: current.status === 'cancelling' ? current.currentActivity : 'AI 正在分析项目资料',
                events: appendEvent(current, {
                    id: 'prepare-complete',
                    at,
                    level: 'success',
                    title: '检测资料已准备',
                    detail: '项目资料已载入，AI 开始执行只读分析。',
                    status: '完成',
                }),
            }))
            retryPendingCancellation(task)
        }),
        listen<AiEventDelta>('ai:delta', (event) => {
            updateTaskBySession(event.payload.session_id, (task) => ({
                ...task,
                phase: 'analyze',
                outputChars: task.outputChars + [...event.payload.text].length,
                currentActivity: '正在生成结构化检测报告',
            }))
        }),
        listen<AiEventToolCall>('ai:tool_call', (event) => {
            const at = Date.now()
            toolStartedAt.set(toolEventKey(event.payload.session_id, event.payload.index), at)
            updateTaskBySession(event.payload.session_id, (task) => {
                const id = `tool:${event.payload.index}`
                const existed = task.events.some((item) => item.id === id)
                return {
                    ...task,
                    phase: 'analyze',
                    toolCallCount: task.toolCallCount + (existed ? 0 : 1),
                    currentActivity: toolLabel(event.payload.name),
                    events: appendEvent(task, {
                        id,
                        at,
                        level: 'active',
                        title: toolLabel(event.payload.name),
                        detail: event.payload.arguments ? `参数已提交，${event.payload.arguments.length} 个字符` : '等待工具返回',
                        status: '进行中',
                    }),
                }
            })
        }),
        listen<AiEventToolRetrying>('ai:tool_retrying', (event) => {
            const at = Date.now()
            updateTaskBySession(event.payload.session_id, (task) => ({
                ...task,
                retryCount: task.retryCount + 1,
                currentActivity: `${toolLabel(event.payload.name)}正在重试`,
                events: appendEvent(task, {
                    id: `tool-retry:${event.payload.index}:${event.payload.attempt}`,
                    at,
                    level: 'warning',
                    title: `${toolLabel(event.payload.name)}重试`,
                    detail: `第 ${event.payload.attempt} 次调用失败，${event.payload.delay_ms} ms 后重试；最多 ${event.payload.max_retries} 次。`,
                    status: '重试中',
                }),
            }))
        }),
        listen<AiEventToolResult>('ai:tool_result', (event) => {
            const at = Date.now()
            updateTaskBySession(event.payload.session_id, (task) => {
                const id = `tool:${event.payload.index}`
                const startedAt = toolStartedAt.get(toolEventKey(event.payload.session_id, event.payload.index))
                toolStartedAt.delete(toolEventKey(event.payload.session_id, event.payload.index))
                const seconds = startedAt ? Math.max(0.1, (at - startedAt) / 1000).toFixed(1) : null
                const existing = task.events.find((item) => item.id === id)
                const resultText = event.payload.result ?? event.payload.output
                return {
                    ...task,
                    currentActivity: event.payload.is_error ? '工具调用失败，AI 正在评估是否继续' : '工具调用完成，AI 正在继续分析',
                    events: appendEvent(task, {
                        id,
                        at: existing?.at ?? at,
                        level: event.payload.is_error ? 'error' : 'success',
                        title: existing?.title ?? '工具调用',
                        detail: event.payload.is_error
                            ? safeDetail(resultText) || '工具返回错误'
                            : `返回 ${[...resultText].length} 个字符`,
                        status: event.payload.is_error ? '失败' : (seconds ? `${seconds} 秒` : '完成'),
                    }),
                }
            })
        }),
        listen<AiEventContextTrimmed>('ai:context_trimmed', (event) => {
            const at = Date.now()
            updateTaskBySession(event.payload.session_id, (task) => ({
                ...task,
                events: appendEvent(task, {
                    id: `context-trimmed:${event.payload.before}:${event.payload.after}`,
                    at,
                    level: 'warning',
                    title: '上下文已自动裁剪',
                    detail: `上下文从 ${event.payload.before} 调整为 ${event.payload.after}，丢弃 ${event.payload.dropped_rounds} 轮历史。`,
                    status: '已继续',
                }),
            }))
        }),
        listen<AiEventTurnEnd>('ai:turn_end', (event) => {
            if (event.payload.status === 'cancelled') {
                updateTaskBySession(event.payload.session_id, finishCancelled)
                return
            }
            if (event.payload.status !== 'ok') {
                updateTaskBySession(event.payload.session_id, (task) => failTask(
                    task,
                    event.payload.error ?? new Error(`AI 分析未正常完成：${event.payload.status}`),
                    'analyze',
                ))
                return
            }
            const at = Date.now()
            updateTaskBySession(event.payload.session_id, (task) => ({
                ...task,
                phase: 'validate',
                currentActivity: '正在校验报告结构与引用证据',
                events: appendEvent(task, {
                    id: 'analysis-complete',
                    at,
                    level: 'success',
                    title: 'AI 分析完成',
                    detail: `已生成 ${task.outputChars} 个字符，正在校验结构化报告。`,
                    status: '完成',
                }),
            }))
        }),
        listen<AiEventError>('ai:error', (event) => {
            updateTaskBySession(event.payload.session_id, (task) => (
                task.status === 'cancelling' || task.status === 'cancelled'
                    ? finishCancelled(task)
                    : failTask(task, event.payload.error)
            ))
        }),
    ]).then(() => undefined).catch((error) => {
        eventListenersPromise = null
        throw error
    })
    return eventListenersPromise
}

export async function startWorldCheckTask({
    request,
    projectName,
}: StartWorldCheckTaskInput): Promise<WorldCheckTask> {
    const existingFlight = inFlightByProject.get(request.projectId)
    if (existingFlight) return existingFlight
    const current = snapshot.tasks[request.projectId]
    if (current?.status === 'running' || current?.status === 'cancelling') {
        throw new Error('当前项目已有设定检测任务正在运行')
    }

    const startedAt = Date.now()
    putTask({
        projectId: request.projectId,
        projectName,
        checkKind: request.checkKind,
        pluginId: request.pluginId,
        model: request.model ?? 'default',
        sessionId: request.sessionId,
        runId: null,
        status: 'running',
        phase: 'prepare',
        startedAt,
        finishedAt: null,
        monitorOpen: true,
        currentActivity: '正在准备项目资料',
        outputChars: 0,
        toolCallCount: 0,
        retryCount: 0,
        scopeSummary: null,
        sourceEntryCount: null,
        truncated: false,
        reportId: null,
        record: null,
        events: [{
            id: 'prepare-start',
            at: startedAt,
            level: 'active',
            title: '准备检测资料',
            detail: '正在加载项目摘要、词条正文与关系证据。',
            status: '进行中',
        }],
        errors: [],
    })

    const taskPromise = (async () => {
        try {
            await ensureWorldCheckEventListeners()
            const result = await ai_start_world_check_session(request)
            const currentTask = snapshot.tasks[request.projectId]
            if (!currentTask) throw new Error('设定检测任务状态已丢失')
            if (currentTask.status === 'cancelled' || currentTask.status === 'cancelling') {
                await ai_cancel_session(request.sessionId).catch(() => {})
                setTask(request.projectId, finishCancelled)
                return snapshot.tasks[request.projectId]
            }

            const persistStartedAt = Date.now()
            setTask(request.projectId, (task) => ({
                ...task,
                runId: result.run_id,
                phase: 'persist',
                scopeSummary: result.scopeSummary,
                sourceEntryCount: result.sourceEntryIds.length,
                truncated: result.truncated,
                reportId: result.reportId,
                currentActivity: '报告校验通过，正在确认保存结果',
                events: appendEvent(task, {
                    id: 'validation-complete',
                    at: persistStartedAt,
                    level: 'success',
                    title: '报告校验通过',
                    detail: '检测类型、结构与引用证据均已通过校验。',
                    status: '完成',
                }),
            }))

            const record = await ai_get_world_check_report_entry(result.reportId)
            if (!record) throw new Error('新生成的检测报告未能写入历史记录')
            const finishedAt = Date.now()
            setTask(request.projectId, (task) => ({
                ...task,
                status: 'success',
                phase: 'persist',
                finishedAt,
                record,
                currentActivity: '检测报告已生成并保存',
                events: appendEvent(task, {
                    id: 'persist-complete',
                    at: finishedAt,
                    level: 'success',
                    title: '报告已保存',
                    detail: `报告已写入项目历史，本次任务耗时 ${elapsedSeconds(task.startedAt, finishedAt)} 秒。`,
                    status: '完成',
                }),
            }))
        } catch (error) {
            const currentTask = snapshot.tasks[request.projectId]
            if (currentTask) {
                setTask(request.projectId, (task) => (
                    task.status === 'cancelling' || task.status === 'cancelled'
                        ? finishCancelled(task)
                        : failTask(task, error, task.phase === 'persist' ? 'persist' : task.phase)
                ))
            }
        }
        return snapshot.tasks[request.projectId]
    })().finally(() => {
        inFlightByProject.delete(request.projectId)
    })
    inFlightByProject.set(request.projectId, taskPromise)
    return taskPromise
}

export function openWorldCheckTaskMonitor(projectId: string) {
    setTask(projectId, (task) => ({...task, monitorOpen: true}))
}

export function closeWorldCheckTaskMonitor(projectId: string) {
    setTask(projectId, (task) => ({...task, monitorOpen: false}))
}

export function cancelWorldCheckTask(projectId: string) {
    const task = snapshot.tasks[projectId]
    if (!task || task.status === 'failed' || task.status === 'success' || task.status === 'cancelled') {
        return Promise.resolve()
    }
    setTask(projectId, (current) => ({
        ...current,
        status: 'cancelling',
        currentActivity: '正在停止检测任务',
    }))
    return requestCancellation(projectId)
}

export function useWorldCheckTaskStore() {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    useEffect(() => {
        void ensureWorldCheckEventListeners().catch((error) => {
            logger.error('[worldCheckTaskStore] 注册 AI 事件监听失败', error)
        })
    }, [])
    return current
}

export function getLatestWorldCheckTask(tasks: Record<string, WorldCheckTask>) {
    return Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
}

export function formatWorldCheckTaskError(error: ApiError) {
    return safeDetail(error.detail) || error.message
}
