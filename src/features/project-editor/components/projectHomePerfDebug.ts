import {logger} from '../../../shared/logger'

const PROJECT_HOME_PERF_LOG_KEY = 'flowcloudai.projectHomePerfLog'

function isProjectHomePerfLogEnabled(): boolean {
    try {
        return typeof window !== 'undefined'
            && window.localStorage.getItem(PROJECT_HOME_PERF_LOG_KEY) === '1'
    } catch {
        return false
    }
}

export function projectHomePerfInfo(label: string, payload: Record<string, unknown>) {
    if (!isProjectHomePerfLogEnabled()) return
    logger.info(`[项目主页性能诊断] ${label}`, payload)
}

export function projectHomePerfWarn(label: string, payload: Record<string, unknown>) {
    if (!isProjectHomePerfLogEnabled()) return
    logger.warn(`[项目主页性能诊断] ${label}`, payload)
}
