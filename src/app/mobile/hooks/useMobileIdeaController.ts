import {useAlert} from 'flowcloudai-ui'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    db_create_idea_note,
    db_delete_idea_note,
    db_list_idea_notes,
    db_list_projects,
    db_update_idea_note,
    type IdeaNote,
    type IdeaNoteStatus,
    type Project,
} from '../../../api'
import {logger} from '../../../shared/logger'

export type MobileIdeaStatusFilter = 'all' | IdeaNoteStatus
export type MobileIdeaProjectFilter = 'all' | 'global' | string
export type MobileIdeaSaveState = 'idle' | 'saving' | 'saved' | 'error'

const IDEA_LIST_LIMIT = 100
const IDEA_AUTOSAVE_DELAY = 700

export const MOBILE_IDEA_STATUS_OPTIONS: Array<{key: MobileIdeaStatusFilter; label: string}> = [
    {key: 'all', label: '全部'},
    {key: 'inbox', label: '待整理'},
    {key: 'processed', label: '已处理'},
    {key: 'archived', label: '归档'},
]

export const MOBILE_IDEA_STATUS_LABELS: Record<IdeaNoteStatus, string> = {
    inbox: '待整理',
    processed: '已处理',
    archived: '归档',
}

interface IdeaDraftSnapshot {
    title: string
    content: string
    projectId: string
    status: IdeaNoteStatus
    pinned: boolean
}

function normalizeDraftSnapshot(snapshot: IdeaDraftSnapshot): string {
    return JSON.stringify({
        title: snapshot.title,
        content: snapshot.content,
        projectId: snapshot.projectId,
        status: snapshot.status,
        pinned: snapshot.pinned,
    })
}

function getSnapshotFromIdea(idea: IdeaNote): IdeaDraftSnapshot {
    return {
        title: idea.title ?? '',
        content: idea.content ?? '',
        projectId: idea.project_id ?? '',
        status: idea.status,
        pinned: Boolean(idea.pinned),
    }
}

function sortIdeas(first: IdeaNote, second: IdeaNote): number {
    const pinnedDiff = Number(Boolean(second.pinned)) - Number(Boolean(first.pinned))
    if (pinnedDiff !== 0) return pinnedDiff
    return new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime()
}

export function formatMobileIdeaDate(value: string): string {
    const time = new Date(value)
    if (Number.isNaN(time.getTime())) return '时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(time)
}

export function getMobileIdeaTitle(idea: IdeaNote): string {
    const title = idea.title?.trim()
    if (title) return title
    const firstLine = idea.content.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    return firstLine ? firstLine.slice(0, 28) : '未命名灵感'
}

export function getMobileIdeaPreview(idea: IdeaNote): string {
    const content = idea.content.replace(/\s+/g, ' ').trim()
    if (content) return content.slice(0, 54)
    return idea.title?.trim() ? '只有标题，继续补充内容。' : '空白便签'
}

export function useMobileIdeaController() {
    const {showAlert} = useAlert()
    const [ideas, setIdeas] = useState<IdeaNote[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(false)
    const [statusFilter, setStatusFilter] = useState<MobileIdeaStatusFilter>('all')
    const [projectFilter, setProjectFilter] = useState<MobileIdeaProjectFilter>('all')
    const [searchText, setSearchText] = useState('')
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [draftProjectId, setDraftProjectId] = useState('')
    const [draftStatus, setDraftStatus] = useState<IdeaNoteStatus>('inbox')
    const [draftPinned, setDraftPinned] = useState(false)
    const [saveState, setSaveState] = useState<MobileIdeaSaveState>('idle')
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
    const lastSavedSnapshotRef = useRef(normalizeDraftSnapshot({
        title: '',
        content: '',
        projectId: '',
        status: 'inbox',
        pinned: false,
    }))

    const currentDraft = useMemo<IdeaDraftSnapshot>(() => ({
        title: draftTitle,
        content: draftContent,
        projectId: draftProjectId,
        status: draftStatus,
        pinned: draftPinned,
    }), [draftContent, draftPinned, draftProjectId, draftStatus, draftTitle])

    const selectedIdea = useMemo(
        () => ideas.find(idea => idea.id === selectedIdeaId) ?? null,
        [ideas, selectedIdeaId],
    )

    const projectNameById = useMemo(() => {
        const map = new Map<string, string>()
        for (const project of projects) {
            map.set(project.id, project.name)
        }
        return map
    }, [projects])

    const loadIdeas = useCallback(async () => {
        setLoading(true)
        try {
            const [nextIdeas, nextProjects] = await Promise.all([
                db_list_idea_notes({
                    limit: IDEA_LIST_LIMIT,
                    offset: 0,
                    status: statusFilter === 'all' ? undefined : statusFilter,
                    projectId: projectFilter !== 'all' && projectFilter !== 'global' ? projectFilter : undefined,
                    onlyGlobal: projectFilter === 'global' ? true : undefined,
                }),
                db_list_projects(),
            ])
            setIdeas([...nextIdeas].sort(sortIdeas))
            setProjects(nextProjects)
        } catch (error) {
            logger.error('加载移动端灵感便签失败', error)
            await showAlert('加载灵感失败', 'error', 'nonInvasive', 2200)
        } finally {
            setLoading(false)
        }
    }, [projectFilter, showAlert, statusFilter])

    useEffect(() => {
        void loadIdeas()
    }, [loadIdeas])

    const setDraftFromIdea = useCallback((idea: IdeaNote | null) => {
        const snapshot = idea ? getSnapshotFromIdea(idea) : {
            title: '',
            content: '',
            projectId: '',
            status: 'inbox' as IdeaNoteStatus,
            pinned: false,
        }
        setDraftTitle(snapshot.title)
        setDraftContent(snapshot.content)
        setDraftProjectId(snapshot.projectId)
        setDraftStatus(snapshot.status)
        setDraftPinned(snapshot.pinned)
        lastSavedSnapshotRef.current = normalizeDraftSnapshot(snapshot)
        setSaveState('idle')
        setLastSavedAt(idea?.updated_at ?? null)
    }, [])

    const startNewIdea = useCallback(() => {
        setSelectedIdeaId(null)
        setDraftFromIdea(null)
    }, [setDraftFromIdea])

    const selectIdea = useCallback((idea: IdeaNote) => {
        setSelectedIdeaId(idea.id)
        setDraftFromIdea(idea)
    }, [setDraftFromIdea])

    const updateIdeaInList = useCallback((idea: IdeaNote) => {
        setIdeas(current => {
            const next = current.some(item => item.id === idea.id)
                ? current.map(item => item.id === idea.id ? idea : item)
                : [idea, ...current]
            return [...next].sort(sortIdeas)
        })
    }, [])

    useEffect(() => {
        const snapshotText = normalizeDraftSnapshot(currentDraft)
        if (snapshotText === lastSavedSnapshotRef.current) return
        const hasDraftContent = currentDraft.title.trim().length > 0 || currentDraft.content.trim().length > 0
        if (!selectedIdeaId && !hasDraftContent) {
            setSaveState('idle')
            return
        }

        setSaveState('saving')
        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    if (!selectedIdeaId) {
                        const created = await db_create_idea_note({
                            title: currentDraft.title.trim() || null,
                            content: currentDraft.content,
                            projectId: currentDraft.projectId || null,
                            pinned: currentDraft.pinned,
                        })
                        setSelectedIdeaId(created.id)
                        updateIdeaInList(created)
                        const createdSnapshot = getSnapshotFromIdea(created)
                        lastSavedSnapshotRef.current = normalizeDraftSnapshot(createdSnapshot)
                        setDraftTitle(createdSnapshot.title)
                        setDraftContent(createdSnapshot.content)
                        setDraftProjectId(createdSnapshot.projectId)
                        setDraftStatus(createdSnapshot.status)
                        setDraftPinned(createdSnapshot.pinned)
                        setSaveState('saved')
                        setLastSavedAt(created.updated_at)
                        return
                    }

                    const updated = await db_update_idea_note({
                        id: selectedIdeaId,
                        title: currentDraft.title.trim() || null,
                        content: currentDraft.content,
                        projectId: currentDraft.projectId || null,
                        status: currentDraft.status,
                        pinned: currentDraft.pinned,
                    })
                    updateIdeaInList(updated)
                    lastSavedSnapshotRef.current = normalizeDraftSnapshot(getSnapshotFromIdea(updated))
                    setSaveState('saved')
                    setLastSavedAt(updated.updated_at)
                } catch (error) {
                    logger.error('自动保存移动端灵感便签失败', error)
                    setSaveState('error')
                }
            })()
        }, IDEA_AUTOSAVE_DELAY)

        return () => window.clearTimeout(timer)
    }, [currentDraft, selectedIdeaId, updateIdeaInList])

    const deleteSelectedIdea = useCallback(async () => {
        if (!selectedIdeaId) return
        const result = await showAlert('确定删除这条灵感便签？', 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await db_delete_idea_note(selectedIdeaId)
            setIdeas(current => current.filter(idea => idea.id !== selectedIdeaId))
            startNewIdea()
            await showAlert('已删除灵感', 'success', 'nonInvasive', 1600)
        } catch (error) {
            logger.error('删除移动端灵感便签失败', error)
            await showAlert('删除失败', 'error', 'nonInvasive', 2200)
        }
    }, [selectedIdeaId, showAlert, startNewIdea])

    const visibleIdeas = useMemo(() => {
        const normalizedSearch = searchText.trim().toLocaleLowerCase('zh-CN')
        return ideas.filter(idea => {
            if (!normalizedSearch) return true
            const projectName = idea.project_id ? projectNameById.get(idea.project_id) ?? '' : '全局'
            return [
                idea.title ?? '',
                idea.content,
                MOBILE_IDEA_STATUS_LABELS[idea.status],
                projectName,
            ].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedSearch)
        })
    }, [ideas, projectNameById, searchText])

    const selectedProjectName = draftProjectId ? projectNameById.get(draftProjectId) ?? '未知项目' : '全局灵感'

    return {
        ideas,
        visibleIdeas,
        projects,
        loading,
        statusFilter,
        setStatusFilter,
        projectFilter,
        setProjectFilter,
        searchText,
        setSearchText,
        selectedIdea,
        selectedIdeaId,
        draftTitle,
        setDraftTitle,
        draftContent,
        setDraftContent,
        draftProjectId,
        setDraftProjectId,
        draftStatus,
        setDraftStatus,
        draftPinned,
        setDraftPinned,
        saveState,
        lastSavedAt,
        selectedProjectName,
        projectNameById,
        loadIdeas,
        selectIdea,
        startNewIdea,
        deleteSelectedIdea,
    }
}

export type MobileIdeaController = ReturnType<typeof useMobileIdeaController>
