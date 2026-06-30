import {logger} from '../../../shared/logger'

const PROJECT_HOME_PERF_LOG_KEY = 'flowcloudai.projectHomePerfLog'

function readProjectHomePerfLogEnabled(): boolean {
    try {
        return typeof window !== 'undefined'
            && window.localStorage.getItem(PROJECT_HOME_PERF_LOG_KEY) === '1'
    } catch {
        return false
    }
}

export const PROJECT_HOME_PERF_LOG_ENABLED = readProjectHomePerfLogEnabled()

export function projectHomePerfInfo(label: string, payload: Record<string, unknown>) {
    if (!PROJECT_HOME_PERF_LOG_ENABLED) return
    logger.info(`[项目主页性能诊断] ${label}`, payload)
}

export function projectHomePerfWarn(label: string, payload: Record<string, unknown>) {
    if (!PROJECT_HOME_PERF_LOG_ENABLED) return
    logger.warn(`[项目主页性能诊断] ${label}`, payload)
}
