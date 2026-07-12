import {useAlert} from 'flowcloudai-ui'
import {useCallback} from 'react'
import type {IdeaNote, IdeaNoteStatus} from '../../../api'
import {
    deleteSelectedIdea,
    patchIdeaDraft,
    refreshIdeas,
    selectIdea,
    setIdeaProjectFilter,
    setIdeaSearchText,
    setIdeaStatusFilter,
    startNewIdea,
    useIdeaStore,
    type IdeaProjectFilter,
    type IdeaSaveState,
    type IdeaStatusFilter,
} from '../../../features/ideas/ideaStore'
import {logger} from '../../../shared/logger'

export type MobileIdeaStatusFilter = IdeaStatusFilter
export type MobileIdeaProjectFilter = IdeaProjectFilter
export type MobileIdeaSaveState = IdeaSaveState

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
    const store = useIdeaStore()

    const deleteCurrentIdea = useCallback(async () => {
        if (!store.selectedIdeaId) return
        const result = await showAlert('确定删除这条灵感便签？', 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await deleteSelectedIdea()
            await showAlert('已删除灵感', 'success', 'nonInvasive', 1600)
        } catch (error) {
            logger.error('删除移动端灵感便签失败', error)
            await showAlert('删除失败', 'error', 'nonInvasive', 2200)
        }
    }, [showAlert, store.selectedIdeaId])

    return {
        ideas: store.ideas,
        visibleIdeas: store.visibleIdeas,
        projects: store.projects,
        loading: store.loading,
        statusFilter: store.statusFilter,
        setStatusFilter: setIdeaStatusFilter,
        projectFilter: store.projectFilter,
        setProjectFilter: setIdeaProjectFilter,
        searchText: store.searchText,
        setSearchText: setIdeaSearchText,
        selectedIdea: store.selectedIdea,
        selectedIdeaId: store.selectedIdeaId,
        draftTitle: store.draft.title,
        setDraftTitle: (title: string) => patchIdeaDraft({title}),
        draftContent: store.draft.content,
        setDraftContent: (content: string) => patchIdeaDraft({content}),
        draftProjectId: store.draft.projectId ?? '',
        setDraftProjectId: (projectId: string) => patchIdeaDraft({projectId: projectId || null}),
        draftStatus: store.draft.status,
        setDraftStatus: (status: IdeaNoteStatus) => patchIdeaDraft({status}),
        draftPinned: store.draft.pinned,
        setDraftPinned: (pinned: boolean) => patchIdeaDraft({pinned}),
        saveState: store.saveState,
        lastSavedAt: store.lastSavedAt,
        selectedProjectName: store.draft.projectId
            ? store.projectNameById.get(store.draft.projectId) ?? '未知项目'
            : '全局灵感',
        projectNameById: store.projectNameById,
        loadIdeas: refreshIdeas,
        selectIdea,
        startNewIdea,
        deleteSelectedIdea: deleteCurrentIdea,
    }
}

export type MobileIdeaController = ReturnType<typeof useMobileIdeaController>
