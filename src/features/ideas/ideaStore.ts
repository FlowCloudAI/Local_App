import {useEffect, useMemo, useSyncExternalStore} from 'react'
import {
    db_create_idea_note,
    db_delete_idea_note,
    db_list_idea_notes,
    db_list_projects,
    db_update_idea_note,
    type IdeaNote,
    type IdeaNoteStatus,
    type Project,
    type UpdateIdeaNoteParams,
} from '../../api'
import {logger} from '../../shared/logger'

export type IdeaStatusFilter = 'all' | IdeaNoteStatus
export type IdeaProjectFilter = 'all' | 'global' | string
export type IdeaSaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface IdeaDraft {
    title: string
    content: string
    projectId: string | null
    status: IdeaNoteStatus
    pinned: boolean
}

interface IdeaSnapshot {
    ideas: IdeaNote[]
    projects: Project[]
    selectedIdeaId: string | null
    draft: IdeaDraft
    statusFilter: IdeaStatusFilter
    projectFilter: IdeaProjectFilter
    searchText: string
    loading: boolean
    hasLoaded: boolean
    saveState: IdeaSaveState
    lastSavedAt: string | null
    statusMessage: string
    version: number
}

const EMPTY_DRAFT: IdeaDraft = {
    title: '',
    content: '',
    projectId: null,
    status: 'inbox',
    pinned: false,
}

const listeners = new Set<() => void>()
let snapshot: IdeaSnapshot = {
    ideas: [],
    projects: [],
    selectedIdeaId: null,
    draft: EMPTY_DRAFT,
    statusFilter: 'all',
    projectFilter: 'all',
    searchText: '',
    loading: false,
    hasLoaded: false,
    saveState: 'idle',
    lastSavedAt: null,
    statusMessage: '输入内容后会自动保存',
    version: 0,
}
let loadPromise: Promise<void> | null = null
let savePromise: Promise<void> | null = null
let saveAgain = false
let saveTimer: number | null = null
let lastSavedDraft = JSON.stringify(EMPTY_DRAFT)

function emit() {
    for (const listener of listeners) listener()
}

function setSnapshot(patch: Partial<Omit<IdeaSnapshot, 'version'>>) {
    snapshot = {...snapshot, ...patch, version: snapshot.version + 1}
    emit()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getIdeaSnapshot() {
    return snapshot
}

function sortIdeas(ideas: IdeaNote[]) {
    return [...ideas].sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    })
}

function draftFromIdea(idea: IdeaNote | null, defaultProjectId: string | null = null): IdeaDraft {
    return idea ? {
        title: idea.title ?? '',
        content: idea.content,
        projectId: idea.project_id ?? null,
        status: idea.status,
        pinned: idea.pinned,
    } : {...EMPTY_DRAFT, projectId: defaultProjectId}
}

function matchesFilters(idea: IdeaNote) {
    if (snapshot.statusFilter !== 'all' && idea.status !== snapshot.statusFilter) return false
    if (snapshot.projectFilter === 'global') return !idea.project_id
    if (snapshot.projectFilter !== 'all') return idea.project_id === snapshot.projectFilter
    return true
}

function replaceIdea(idea: IdeaNote) {
    const ideas = snapshot.ideas.some(item => item.id === idea.id)
        ? snapshot.ideas.map(item => item.id === idea.id ? idea : item)
        : [idea, ...snapshot.ideas]
    setSnapshot({ideas: sortIdeas(ideas)})
}

function resetDraft(defaultProjectId: string | null = null) {
    const draft = draftFromIdea(null, defaultProjectId)
    lastSavedDraft = JSON.stringify(draft)
    setSnapshot({
        selectedIdeaId: null,
        draft,
        saveState: 'idle',
        lastSavedAt: null,
        statusMessage: '空白便签，开始输入后会自动创建',
    })
}

export async function refreshIdeas(preferredIdeaId?: string | null) {
    if (loadPromise) return loadPromise
    setSnapshot({loading: true})
    loadPromise = (async () => {
        try {
            const [ideas, projects] = await Promise.all([
                db_list_idea_notes({
                    limit: 100,
                    offset: 0,
                    status: snapshot.statusFilter === 'all' ? undefined : snapshot.statusFilter,
                    projectId: snapshot.projectFilter !== 'all' && snapshot.projectFilter !== 'global'
                        ? snapshot.projectFilter
                        : undefined,
                    onlyGlobal: snapshot.projectFilter === 'global' ? true : undefined,
                }),
                db_list_projects(),
            ])
            const sortedIdeas = sortIdeas(ideas)
            const targetId = preferredIdeaId ?? snapshot.selectedIdeaId
            const selected = sortedIdeas.find(idea => idea.id === targetId) ?? null
            setSnapshot({
                ideas: sortedIdeas,
                projects,
                selectedIdeaId: selected?.id ?? null,
                loading: false,
                hasLoaded: true,
            })
            if (!selected && targetId) resetDraft()
        } catch (error) {
            logger.error('加载灵感便签失败', error)
            setSnapshot({
                loading: false,
                hasLoaded: true,
                saveState: 'error',
                statusMessage: error instanceof Error ? error.message : '加载灵感便签失败',
            })
        } finally {
            loadPromise = null
        }
    })()
    return loadPromise
}

function scheduleSave() {
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    const hasContent = snapshot.draft.title.trim() || snapshot.draft.content.trim()
    if (!snapshot.selectedIdeaId && !hasContent) {
        setSnapshot({saveState: 'idle', statusMessage: '输入内容后会自动创建便签'})
        return
    }
    setSnapshot({
        saveState: 'saving',
        statusMessage: snapshot.selectedIdeaId ? '正在自动保存…' : '正在创建便签…',
    })
    saveTimer = window.setTimeout(() => {
        saveTimer = null
        void flushIdeaDraft()
    }, 700)
}

export function patchIdeaDraft(patch: Partial<IdeaDraft>) {
    setSnapshot({draft: {...snapshot.draft, ...patch}})
    scheduleSave()
}

export async function flushIdeaDraft(): Promise<void> {
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
    }
    if (JSON.stringify(snapshot.draft) === lastSavedDraft) return
    if (savePromise) {
        saveAgain = true
        await savePromise
        return
    }

    const draft = snapshot.draft
    const draftKey = JSON.stringify(draft)
    const selectedIdeaId = snapshot.selectedIdeaId
    const hasContent = draft.title.trim() || draft.content.trim()
    if (!selectedIdeaId && !hasContent) return

    setSnapshot({saveState: 'saving'})
    savePromise = (async () => {
        try {
            let saved = selectedIdeaId
                ? await db_update_idea_note({
                    id: selectedIdeaId,
                    title: draft.title.trim() ? draft.title : null,
                    content: draft.content,
                    projectId: draft.projectId,
                    status: draft.status,
                    pinned: draft.pinned,
                })
                : await db_create_idea_note({
                    title: draft.title.trim() ? draft.title : null,
                    content: draft.content,
                    projectId: draft.projectId,
                    pinned: draft.pinned,
                })
            if (!selectedIdeaId && saved.status !== draft.status) {
                saved = await db_update_idea_note({id: saved.id, status: draft.status})
            }
            lastSavedDraft = draftKey
            if (matchesFilters(saved)) replaceIdea(saved)
            else await refreshIdeas(saved.id)
            setSnapshot({
                selectedIdeaId: saved.id,
                saveState: 'saved',
                lastSavedAt: saved.updated_at,
                statusMessage: `已保存于 ${new Date(saved.updated_at).toLocaleString('zh-CN')}`,
            })
        } catch (error) {
            logger.error('保存灵感便签失败', error)
            setSnapshot({
                saveState: 'error',
                statusMessage: error instanceof Error ? error.message : '自动保存失败',
            })
        } finally {
            savePromise = null
        }
    })()
    await savePromise
    if (saveAgain || JSON.stringify(snapshot.draft) !== lastSavedDraft) {
        saveAgain = false
        await flushIdeaDraft()
    }
}

export async function selectIdea(ideaOrId: IdeaNote | string, defaultProjectId: string | null = null) {
    await flushIdeaDraft()
    const idea = typeof ideaOrId === 'string'
        ? snapshot.ideas.find(item => item.id === ideaOrId) ?? null
        : ideaOrId
    if (!idea) return
    const draft = draftFromIdea(idea)
    lastSavedDraft = JSON.stringify(draft)
    setSnapshot({
        selectedIdeaId: idea.id,
        draft,
        saveState: 'saved',
        lastSavedAt: idea.updated_at,
        statusMessage: `已保存于 ${new Date(idea.updated_at).toLocaleString('zh-CN')}`,
    })
    void defaultProjectId
}

export async function startNewIdea(defaultProjectId: string | null = null) {
    await flushIdeaDraft()
    resetDraft(defaultProjectId)
}

export async function updateSelectedIdea(patch: Partial<Pick<IdeaNote, 'status' | 'pinned'>>) {
    await flushIdeaDraft()
    const selectedIdeaId = snapshot.selectedIdeaId
    if (!selectedIdeaId) return null
    return updateIdeaNote({id: selectedIdeaId, ...patch})
}

export async function updateIdeaNote(params: UpdateIdeaNoteParams) {
    const updated = await db_update_idea_note(params)
    const draft = draftFromIdea(updated)
    if (updated.id === snapshot.selectedIdeaId) {
        lastSavedDraft = JSON.stringify(draft)
        setSnapshot({draft, lastSavedAt: updated.updated_at, saveState: 'saved'})
    }
    if (matchesFilters(updated)) replaceIdea(updated)
    else await refreshIdeas(updated.id)
    return updated
}

export async function deleteSelectedIdea() {
    await flushIdeaDraft()
    if (!snapshot.selectedIdeaId) return
    await db_delete_idea_note(snapshot.selectedIdeaId)
    resetDraft()
    await refreshIdeas()
}

export function setIdeaStatusFilter(statusFilter: IdeaStatusFilter) {
    setSnapshot({statusFilter})
    const activeLoad = loadPromise
    void (activeLoad ? activeLoad.then(() => refreshIdeas()) : refreshIdeas())
}

export function setIdeaProjectFilter(projectFilter: IdeaProjectFilter) {
    setSnapshot({projectFilter})
    const activeLoad = loadPromise
    void (activeLoad ? activeLoad.then(() => refreshIdeas()) : refreshIdeas())
}

export function setIdeaSearchText(searchText: string) {
    setSnapshot({searchText})
}

export function setIdeaFeedback(saveState: IdeaSaveState, statusMessage: string) {
    setSnapshot({saveState, statusMessage})
}

export function useIdeaStore() {
    const current = useSyncExternalStore(subscribe, getIdeaSnapshot, getIdeaSnapshot)
    useEffect(() => {
        if (!current.hasLoaded && !current.loading) void refreshIdeas()
    }, [current.hasLoaded, current.loading])

    const projectNameById = useMemo(
        () => new Map(current.projects.map(project => [project.id, project.name])),
        [current.projects],
    )
    const visibleIdeas = useMemo(() => {
        const search = current.searchText.trim().toLocaleLowerCase('zh-CN')
        if (!search) return current.ideas
        return current.ideas.filter(idea => [
            idea.title ?? '',
            idea.content,
            idea.status,
            idea.project_id ? projectNameById.get(idea.project_id) ?? '' : '全局 未归属',
        ].join(' ').toLocaleLowerCase('zh-CN').includes(search))
    }, [current.ideas, current.searchText, projectNameById])

    return {
        ...current,
        selectedIdea: current.ideas.find(idea => idea.id === current.selectedIdeaId) ?? null,
        visibleIdeas,
        projectNameById,
    }
}
