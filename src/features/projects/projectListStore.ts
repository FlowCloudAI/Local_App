import {useCallback, useEffect, useSyncExternalStore} from 'react'
import {db_list_projects, type Project} from '../../api'

export interface ProjectListSnapshot {
    projects: Project[]
    loading: boolean
    error: string | null
    hasLoaded: boolean
    version: number
}

const listeners = new Set<() => void>()

let snapshot: ProjectListSnapshot = {
    projects: [],
    loading: false,
    error: null,
    hasLoaded: false,
    version: 0,
}
let inFlight: Promise<Project[]> | null = null
let queuedInvalidation: Promise<Project[]> | null = null

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function setSnapshot(patch: Partial<Omit<ProjectListSnapshot, 'version'>>) {
    snapshot = {
        ...snapshot,
        ...patch,
        version: snapshot.version + 1,
    }
    emit()
}

function subscribeProjectList(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getProjectListSnapshot() {
    return snapshot
}

export async function refreshProjectList(): Promise<Project[]> {
    if (inFlight) return inFlight

    setSnapshot({loading: true, error: null})
    inFlight = db_list_projects()
        .then((projects) => {
            setSnapshot({
                projects,
                loading: false,
                error: null,
                hasLoaded: true,
            })
            return projects
        })
        .catch((error) => {
            setSnapshot({
                loading: false,
                error: String(error),
                hasLoaded: true,
            })
            return snapshot.projects
        })
        .finally(() => {
            inFlight = null
        })

    return inFlight
}

export function invalidateProjectList() {
    if (inFlight) {
        queuedInvalidation ??= inFlight.then(() => {
            queuedInvalidation = null
            return refreshProjectList()
        })
        return queuedInvalidation
    }

    return refreshProjectList()
}

export function useProjectListStore() {
    const current = useSyncExternalStore(
        subscribeProjectList,
        getProjectListSnapshot,
        getProjectListSnapshot,
    )

    useEffect(() => {
        if (!current.hasLoaded && !current.loading) {
            void refreshProjectList()
        }
    }, [current.hasLoaded, current.loading])

    const refresh = useCallback(() => refreshProjectList(), [])

    return {
        ...current,
        refresh,
    }
}
