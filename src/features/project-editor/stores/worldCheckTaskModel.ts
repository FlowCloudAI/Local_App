/**
 * 设定检测后台任务的纯状态模型。
 *
 * 这里不接触 Tauri 事件或 React，仅定义任务、运行记录和阶段推导，供状态仓库、桌面界面
 * 与 Node 最小回归检查共同使用。
 */
import type {StoredWorldCheckReport, WorldCheckKind} from '../../../api'

export type WorldCheckTaskStatus = 'running' | 'cancelling' | 'failed' | 'success' | 'cancelled'
export type WorldCheckTaskPhase = 'prepare' | 'analyze' | 'validate' | 'persist'
export type WorldCheckTaskPhaseStatus = 'pending' | 'active' | 'done' | 'failed' | 'cancelled'
export type WorldCheckTaskEventLevel = 'active' | 'success' | 'warning' | 'error'

export interface WorldCheckTaskEvent {
    id: string
    at: number
    level: WorldCheckTaskEventLevel
    title: string
    detail: string
    status: string
}

export interface WorldCheckTaskError {
    code: string
    message: string
    stage: WorldCheckTaskPhase
    detail?: Record<string, unknown>
    at: number
}

export interface WorldCheckTask {
    projectId: string
    projectName: string
    checkKind: WorldCheckKind
    pluginId: string
    model: string
    sessionId: string
    runId: string | null
    status: WorldCheckTaskStatus
    phase: WorldCheckTaskPhase
    startedAt: number
    finishedAt: number | null
    monitorOpen: boolean
    currentActivity: string
    outputChars: number
    toolCallCount: number
    retryCount: number
    scopeSummary: string | null
    sourceEntryCount: number | null
    truncated: boolean
    reportId: string | null
    record: StoredWorldCheckReport | null
    events: WorldCheckTaskEvent[]
    errors: WorldCheckTaskError[]
}

export const WORLD_CHECK_PHASES: WorldCheckTaskPhase[] = ['prepare', 'analyze', 'validate', 'persist']

export function getWorldCheckPhaseStatus(
    task: WorldCheckTask,
    phase: WorldCheckTaskPhase,
): WorldCheckTaskPhaseStatus {
    if (task.status === 'success') return 'done'

    const currentIndex = WORLD_CHECK_PHASES.indexOf(task.phase)
    const phaseIndex = WORLD_CHECK_PHASES.indexOf(phase)
    if (phaseIndex < currentIndex) return 'done'
    if (phaseIndex > currentIndex) return 'pending'
    if (task.status === 'failed') return 'failed'
    if (task.status === 'cancelled') return 'cancelled'
    return 'active'
}

export function appendUniqueWorldCheckError(
    errors: WorldCheckTaskError[],
    error: WorldCheckTaskError,
): WorldCheckTaskError[] {
    const duplicate = errors.some((item) => item.code === error.code && item.message === error.message)
    return duplicate ? errors : [...errors, error]
}
