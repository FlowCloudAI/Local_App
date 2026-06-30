import {useCallback, useEffect, useSyncExternalStore} from 'react'
import {
    db_get_project,
    db_list_all_entry_types,
    db_list_tag_schemas,
    type EntryTypeView,
    type Project,
    type TagSchema,
} from '../../api'

export interface ProjectDetailSnapshot {
    project: Project | null
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    loading: boolean
    error: string | null
    hasLoaded: boolean
    version: number
}

interface ProjectDetailPayload {
    project: Project | null
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
}

const emptySnapshot: ProjectDetailSnapshot = {
    project: null,
    entryTypes: [],
    tagSchemas: [],
    loading: false,
    error: null,
    hasLoaded: false,
    version: 0,
}

const listeners = new Set<() => void>()
const snapshots = new Map<string, ProjectDetailSnapshot>()
const inFlight = new Map<string, Promise<ProjectDetailPayload>>()
const queuedInvalidations = new Map<string, Promise<ProjectDetailPayload>>()

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function getSnapshot(projectId?: string | null): ProjectDetailSnapshot {
    if (!projectId) return emptySnapshot
    return snapshots.get(projectId) ?? emptySnapshot
}

function setProjectSnapshot(
    projectId: string,
    patch: Partial<Omit<ProjectDetailSnapshot, 'version'>>,
) {
    const current = getSnapshot(projectId)
    snapshots.set(projectId, {
        ...current,
        ...patch,
        version: current.version + 1,
    })
    emit()
}

function subscribeProjectDetail(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export async function refreshProjectDetail(projectId: string): Promise<ProjectDetailPayload> {
    const running = inFlight.get(projectId)
    if (running) return running

    setProjectSnapshot(projectId, {loading: true, error: null})
    const nextRequest = Promise.all([
        db_get_project(projectId),
        db_list_all_entry_types(projectId),
        db_list_tag_schemas(projectId),
    ]).then(([project, entryTypes, tagSchemas]) => {
        const payload = {project, entryTypes, tagSchemas}
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
            project: current.project,
            entryTypes: current.entryTypes,
            tagSchemas: current.tagSchemas,
        }
    }).finally(() => {
        inFlight.delete(projectId)
    })

    inFlight.set(projectId, nextRequest)
    return nextRequest
}

export function invalidateProjectDetail(projectId: string): Promise<ProjectDetailPayload> {
    const running = inFlight.get(projectId)
    if (running) {
        const queued = queuedInvalidations.get(projectId)
        if (queued) return queued

        const nextQueued = running.then(() => {
            queuedInvalidations.delete(projectId)
            return refreshProjectDetail(projectId)
        })
        queuedInvalidations.set(projectId, nextQueued)
        return nextQueued
    }

    return refreshProjectDetail(projectId)
}

export function patchProjectDetail(projectId: string, patch: Partial<Project>) {
    const current = getSnapshot(projectId)
    if (!current.project) return
    setProjectSnapshot(projectId, {
        project: {
            ...current.project,
            ...patch,
        },
    })
}

export function useProjectDetailStore(projectId?: string | null) {
    const current = useSyncExternalStore(
        subscribeProjectDetail,
        () => getSnapshot(projectId),
        () => getSnapshot(projectId),
    )

    useEffect(() => {
        if (!projectId) return
        if (!current.hasLoaded && !current.loading) {
            void refreshProjectDetail(projectId)
        }
    }, [current.hasLoaded, current.loading, projectId])

    const refresh = useCallback(() => {
        if (!projectId) return Promise.resolve({
            project: emptySnapshot.project,
            entryTypes: emptySnapshot.entryTypes,
            tagSchemas: emptySnapshot.tagSchemas,
        })
        return refreshProjectDetail(projectId)
    }, [projectId])

    return {
        ...current,
        refresh,
    }
}
