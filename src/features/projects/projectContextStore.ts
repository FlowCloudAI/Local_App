import {useCallback, useEffect, useSyncExternalStore} from 'react'
import {
    db_get_project_stats,
    db_list_categories,
    type Category,
    type ProjectStats,
} from '../../api'

export interface ProjectContextSnapshot {
    categories: Category[]
    stats: ProjectStats | null
    loading: boolean
    error: string | null
    hasLoaded: boolean
    version: number
}

interface ProjectContextPayload {
    categories: Category[]
    stats: ProjectStats | null
}

const emptySnapshot: ProjectContextSnapshot = {
    categories: [],
    stats: null,
    loading: false,
    error: null,
    hasLoaded: false,
    version: 0,
}

const listeners = new Set<() => void>()
const snapshots = new Map<string, ProjectContextSnapshot>()
const inFlight = new Map<string, Promise<ProjectContextPayload>>()
const queuedInvalidations = new Map<string, Promise<ProjectContextPayload>>()

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function getSnapshot(projectId?: string | null): ProjectContextSnapshot {
    if (!projectId) return emptySnapshot
    return snapshots.get(projectId) ?? emptySnapshot
}

function setProjectSnapshot(
    projectId: string,
    patch: Partial<Omit<ProjectContextSnapshot, 'version'>>,
) {
    const current = getSnapshot(projectId)
    snapshots.set(projectId, {
        ...current,
        ...patch,
        version: current.version + 1,
    })
    emit()
}

function subscribeProjectContext(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export async function refreshProjectContext(projectId: string): Promise<ProjectContextPayload> {
    const running = inFlight.get(projectId)
    if (running) return running

    setProjectSnapshot(projectId, {loading: true, error: null})
    const nextRequest = Promise.all([
        db_list_categories(projectId),
        db_get_project_stats(projectId),
    ]).then(([categories, stats]) => {
        const payload = {categories, stats}
        setProjectSnapshot(projectId, {
            ...payload,
            loading: false,
            error: null,
            hasLoaded: true,
        })
        return payload
    }).catch((error) => {
        const current = getSnapshot(projectId)
        setProjectSnapshot(projectId, {
            loading: false,
            error: String(error),
            hasLoaded: true,
        })
        return {
            categories: current.categories,
            stats: current.stats,
        }
    }).finally(() => {
        inFlight.delete(projectId)
    })

    inFlight.set(projectId, nextRequest)
    return nextRequest
}

export function invalidateProjectContext(projectId: string): Promise<ProjectContextPayload> {
    const running = inFlight.get(projectId)
    if (running) {
        const queued = queuedInvalidations.get(projectId)
        if (queued) return queued

        const nextQueued = running.then(() => {
            queuedInvalidations.delete(projectId)
            return refreshProjectContext(projectId)
        })
        queuedInvalidations.set(projectId, nextQueued)
        return nextQueued
    }

    return refreshProjectContext(projectId)
}

export function useProjectContextStore(projectId?: string | null) {
    const current = useSyncExternalStore(
        subscribeProjectContext,
        () => getSnapshot(projectId),
        () => getSnapshot(projectId),
    )

    useEffect(() => {
        if (!projectId) return
        if (!current.hasLoaded && !current.loading) {
            void refreshProjectContext(projectId)
        }
    }, [current.hasLoaded, current.loading, projectId])

    const refresh = useCallback(() => {
        if (!projectId) return Promise.resolve({
            categories: emptySnapshot.categories,
            stats: emptySnapshot.stats,
        })
        return refreshProjectContext(projectId)
    }, [projectId])

    return {
        ...current,
        refresh,
    }
}
