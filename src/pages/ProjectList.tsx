import {type CSSProperties, memo, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {convertFileSrc} from '../api/assets'
import {openFileDialog} from '../api/dialog'
import {Button, Card, Input, RollingBox, useAlert, useContextMenu} from 'flowcloudai-ui'
import {
    db_get_entry,
    db_get_project,
    db_delete_project,
    db_import_project_fcworld,
    db_preview_project_fcworld,
    db_update_project,
    type FcworldImportPreview,
    type FcworldImportResult,
    type Project,
    setting_get_settings,
    setting_update_settings,
} from '../api'
import ProjectCreator from '../features/projects/components/ProjectCreator'
import FcworldProgressDialog from '../features/projects/components/FcworldProgressDialog'
import ProjectImportConflictDialog from '../features/projects/components/ProjectImportConflictDialog'
import {useFcworldProgress} from '../features/projects/hooks/useFcworldProgress'
import {invalidateProjectList, useProjectListStore} from '../features/projects/projectListStore'
import {
    getHomeActivityTargetKey,
    HOME_ACTIVITY_CHANGED_EVENT,
    loadHomeDashboardData,
    removeHomeActivityTarget,
    removeHomeEntryActivity,
    removeHomeProjectActivity,
    type HomeActivityRecord,
    type HomeActivityTarget,
    type HomeDashboardData,
} from '../features/home/homeActivity'
import {FloatingPanel, RenameDialog} from '../shared/ui/overlay'
import {type TourDefinition, type TourStepLeaveContext, useTour} from '../features/onboarding'
import '../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectList.css'

interface ProjectListProps {
    onOpenProject?: (project: Project) => void
    onOpenHomeTarget?: (target: HomeActivityTarget) => void | Promise<void>
}

type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc'

const SORT_OPTIONS: Array<{ key: Exclude<SortMode, 'name-asc' | 'name-desc'>; label: string }> = [
    {key: 'updated-desc', label: '最近更新'},
    {key: 'updated-asc', label: '最早更新'},
]
const HOME_WELCOME_STORAGE_KEY = 'fc:onboarding:home-welcome:v1'
const WELCOME_TOUR_START_DELAY_MS = 300

function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

function parseDateValue(value?: string | null): number {
    if (!value) return 0
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const time = new Date(withTimezone).getTime()
    return Number.isNaN(time) ? 0 : time
}

function formatDate(value?: string | null): string {
    const timestamp = parseDateValue(value)
    if (!timestamp) return '时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(timestamp)
}

function formatRelativeTime(value?: string | null): string {
    const timestamp = parseDateValue(value)
    if (!timestamp) return '时间未知'

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return '刚刚'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
    return formatDate(value)
}

function asOptionalString(value: unknown): string | null | undefined {
    return typeof value === 'string' || value == null ? value : undefined
}

function normalizeStarredProjectIds(projectIds: string[] | null | undefined) {
    return Array.from(new Set((projectIds ?? []).filter(Boolean)))
}

function hasSeenHomeWelcome(): boolean {
    try {
        return window.localStorage.getItem(HOME_WELCOME_STORAGE_KEY) === 'done'
    } catch {
        return false
    }
}

function markHomeWelcomeSeen() {
    try {
        window.localStorage.setItem(HOME_WELCOME_STORAGE_KEY, 'done')
    } catch {
        // 本地存储不可用时只影响欢迎弹窗是否重复出现。
    }
}

function ProjectStarTag() {
    return (
        <span className="project-list-star-tag" aria-label="已标星">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3.3 14.8 9l6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.9 9.2 9 12 3.3Z" />
            </svg>
        </span>
    )
}

function getTargetTypeLabel(type: HomeActivityTarget['type']): string {
    switch (type) {
        case 'project':
            return '世界'
        case 'entry':
            return '词条'
        case 'tool':
            return '工具'
        case 'idea':
            return '灵感'
        case 'conversation':
            return '对话'
        case 'snapshot':
            return '快照'
        case 'help':
            return '帮助'
    }
}

function isProjectBackedTarget(target: HomeActivityTarget) {
    return target.type === 'project' || target.type === 'entry' || target.type === 'tool'
}

function getDashboardProjectId(target: HomeActivityTarget) {
    return target.type === 'project' ? target.projectId ?? target.id : target.projectId ?? null
}

function getDashboardEntryId(target: HomeActivityTarget) {
    return target.type === 'entry' ? target.entryId ?? target.id : null
}

function collectDashboardTargets(dashboard: HomeDashboardData) {
    const targets: HomeActivityTarget[] = [
        ...dashboard.recentItems,
        ...dashboard.pinnedItems,
    ]
    if (dashboard.continueItem) {
        targets.push(dashboard.continueItem)
    }
    return targets
}

function ProjectList({onOpenProject, onOpenHomeTarget}: ProjectListProps) {
    const {showAlert} = useAlert()
    const {showContextMenu} = useContextMenu()
    const {startTour} = useTour()
    const [importing, setImporting] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [welcomeOpen, setWelcomeOpen] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)
    const [starredProjectIds, setStarredProjectIds] = useState<string[]>([])
    const [renameProject, setRenameProject] = useState<Project | null>(null)
    const [projectActionBusy, setProjectActionBusy] = useState(false)
    const [dashboard, setDashboard] = useState<HomeDashboardData>(() => loadHomeDashboardData())
    const [validEntryTargetKeys, setValidEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const [invalidHomeTargetKeys, setInvalidHomeTargetKeys] = useState<Set<string>>(() => new Set())
    const [pendingEntryTargetKeys, setPendingEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const {
        projects,
        loading,
        error,
        hasLoaded: hasLoadedProjects,
        refresh: refreshProjects,
    } = useProjectListStore()
    const openCreatorForTour = useCallback(() => {
        setCreatorOpen(true)
    }, [])
    const closeCreatorWhenTourCancelled = useCallback(({reason}: TourStepLeaveContext) => {
        if (reason === 'skip' || reason === 'stop') setCreatorOpen(false)
    }, [])
    const closeCreatorWhenBackToHome = useCallback(({reason}: TourStepLeaveContext) => {
        if (reason === 'previous' || reason === 'skip' || reason === 'stop') setCreatorOpen(false)
    }, [])
    const homeOnboardingTour = useMemo<TourDefinition>(() => ({
        id: 'desktop-home-first-world',
        version: 1,
        steps: [
            {
                id: 'home-overview',
                target: '[data-tour-id="home-overview"]',
                title: '这是创作首页',
                content: '这里是进入流云AI后的起点。你可以继续已有世界，也可以从这里创建第一个世界观。',
                placement: 'bottom',
            },
            {
                id: 'home-actions',
                target: '[data-tour-id="home-quick-actions"]',
                title: '先选一个入口',
                content: '重点功能会按当前状态给出入口。新用户先从“开始一个新世界”进入，其他能力可以以后再看。',
                placement: 'bottom',
            },
            {
                id: 'new-world-action',
                target: '[data-tour-id="home-new-world-action"]',
                title: '创建第一个世界观',
                content: '这个入口会打开新建窗口。调试版点击下一步会自动打开窗口，方便继续看后面的步骤。',
                placement: 'bottom',
            },
            {
                id: 'creator-dialog',
                target: '[data-tour-id="project-creator-dialog"]',
                title: '新建世界观窗口',
                content: '新世界只需要先填最小信息：名称、可选简介，以及是否生成默认模板。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenBackToHome,
            },
            {
                id: 'creator-name',
                target: '[data-tour-id="project-creator-name"]',
                title: '先填世界观名称',
                content: '名称是唯一必填项，建议用作品名、企划名或你能快速识别的世界名。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-description',
                target: '[data-tour-id="project-creator-description"]',
                title: '简介可以先写一句话',
                content: '简介不是设定正文，只要写清题材、基调或当前创作目标，后续 AI 辅助会更好用。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-template',
                target: '[data-tour-id="project-creator-template"]',
                title: '默认模板先保持开启',
                content: '默认模板会帮你生成常用分类和标签。第一次创建建议保留，后面不需要时再调整。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-submit',
                target: '[data-tour-id="project-creator-submit"]',
                title: '填好后点击创建',
                content: '名称填好后这里会变成可用。完成引导后窗口会保留，你可以直接创建第一个世界观。',
                placement: 'top',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
        ],
    }), [closeCreatorWhenBackToHome, closeCreatorWhenTourCancelled, openCreatorForTour])

    useEffect(() => {
        if (!hasSeenHomeWelcome()) setWelcomeOpen(true)
    }, [])

    const finishWelcome = useCallback((startTutorial: boolean) => {
        markHomeWelcomeSeen()
        setWelcomeOpen(false)
        if (!startTutorial) return
        window.setTimeout(() => {
            startTour(homeOnboardingTour, {force: true, markCompletedOnSkip: true})
        }, WELCOME_TOUR_START_DELAY_MS)
    }, [homeOnboardingTour, startTour])

    useEffect(() => {
        const refreshDashboard = () => setDashboard(loadHomeDashboardData())
        window.addEventListener(HOME_ACTIVITY_CHANGED_EVENT, refreshDashboard)
        window.addEventListener('storage', refreshDashboard)
        return () => {
            window.removeEventListener(HOME_ACTIVITY_CHANGED_EVENT, refreshDashboard)
            window.removeEventListener('storage', refreshDashboard)
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        setting_get_settings()
            .then(settings => {
                if (!cancelled) setStarredProjectIds(normalizeStarredProjectIds(settings.starred_project_ids))
            })
            .catch(error => {
                if (!cancelled) void showAlert(`加载星标项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
            })
        return () => {
            cancelled = true
        }
    }, [showAlert])

    const projectIdSet = useMemo(() => new Set(projects.map(project => project.id)), [projects])
    const starredProjectIdSet = useMemo(() => new Set(starredProjectIds), [starredProjectIds])

    useEffect(() => {
        if (!hasLoadedProjects) return

        const entryTargets: Array<{
            key: string
            projectId: string
            entryId: string
            target: HomeActivityTarget
        }> = []
        const invalidKeys = new Set<string>()
        const missingProjectIds = new Set<string>()

        for (const target of collectDashboardTargets(dashboard)) {
            const key = getHomeActivityTargetKey(target)
            const projectId = getDashboardProjectId(target)

            if (isProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
                invalidKeys.add(key)
                if (projectId) {
                    missingProjectIds.add(projectId)
                } else {
                    removeHomeActivityTarget(target)
                }
                continue
            }

            if (target.type === 'entry') {
                const entryId = getDashboardEntryId(target)
                if (!projectId || !entryId) {
                    invalidKeys.add(key)
                    removeHomeActivityTarget(target)
                    continue
                }
                entryTargets.push({key, projectId, entryId, target})
            }
        }

        if (invalidKeys.size > 0) {
            setInvalidHomeTargetKeys(prev => new Set([...prev, ...invalidKeys]))
        }
        for (const projectId of missingProjectIds) {
            removeHomeProjectActivity(projectId)
        }
        if (entryTargets.length === 0) return

        const validationKeys = new Set(entryTargets.map(item => item.key))
        setPendingEntryTargetKeys(prev => new Set([...prev, ...validationKeys]))

        let cancelled = false
        void (async () => {
            const validKeys = new Set<string>()
            const invalidEntryKeys = new Set<string>()

            await Promise.all(entryTargets.map(async item => {
                try {
                    const entry = await db_get_entry(item.entryId)
                    if (entry.project_id !== item.projectId) {
                        invalidEntryKeys.add(item.key)
                        removeHomeActivityTarget(item.target)
                        return
                    }
                    validKeys.add(item.key)
                } catch {
                    invalidEntryKeys.add(item.key)
                    removeHomeEntryActivity(item.projectId, item.entryId)
                }
            }))

            if (cancelled) return

            setPendingEntryTargetKeys(prev => {
                const next = new Set(prev)
                for (const key of validationKeys) next.delete(key)
                return next
            })
            setValidEntryTargetKeys(prev => {
                const next = new Set(prev)
                for (const key of invalidEntryKeys) next.delete(key)
                for (const key of validKeys) next.add(key)
                return next
            })
            setInvalidHomeTargetKeys(prev => {
                const next = new Set(prev)
                for (const key of validKeys) next.delete(key)
                for (const key of invalidEntryKeys) next.add(key)
                return next
            })
        })()

        return () => {
            cancelled = true
        }
    }, [dashboard, hasLoadedProjects, projectIdSet])

    const query = searchText.trim().toLowerCase()
    const filteredProjects = projects
        .filter(project => {
            if (!query) return true
            const name = project.name.toLowerCase()
            const description = (project.description ?? '').toLowerCase()
            return name.includes(query) || description.includes(query)
        })
        .sort((a, b) => {
            const starOrder = Number(starredProjectIdSet.has(b.id)) - Number(starredProjectIdSet.has(a.id))
            if (starOrder !== 0) return starOrder

            const timeA = parseDateValue(asOptionalString(a.updated_at) ?? asOptionalString(a.created_at))
            const timeB = parseDateValue(asOptionalString(b.updated_at) ?? asOptionalString(b.created_at))
            const nameOrder = a.name.localeCompare(b.name, 'zh-CN')

            switch (sortMode) {
                case 'updated-asc':
                    return timeA - timeB || nameOrder
                case 'name-asc':
                    return nameOrder
                case 'name-desc':
                    return -nameOrder
                case 'updated-desc':
                default:
                    return timeB - timeA || nameOrder
            }
        })

    const saveStarredProjectIds = useCallback(async (projectIds: string[]) => {
        const nextIds = normalizeStarredProjectIds(projectIds)
        const settings = await setting_get_settings()
        const nextSettings = {...settings, starred_project_ids: nextIds}
        await setting_update_settings(nextSettings)
        window.dispatchEvent(new CustomEvent('fc:settings-updated', {detail: nextSettings}))
        return nextIds
    }, [])

    const toggleProjectStar = useCallback(async (project: Project) => {
        const previousIds = starredProjectIds
        const nextIds = previousIds.includes(project.id)
            ? previousIds.filter(id => id !== project.id)
            : [...previousIds, project.id]

        setStarredProjectIds(nextIds)
        try {
            setStarredProjectIds(await saveStarredProjectIds(nextIds))
        } catch (error) {
            setStarredProjectIds(previousIds)
            await showAlert(`保存星标失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [saveStarredProjectIds, showAlert, starredProjectIds])

    const handleRenameProject = useCallback(async (name: string) => {
        if (!renameProject) return
        if (name === renameProject.name) {
            setRenameProject(null)
            return
        }

        setProjectActionBusy(true)
        try {
            await db_update_project({id: renameProject.id, name})
            await invalidateProjectList()
            setRenameProject(null)
            await showAlert('项目已重命名', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`重命名项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setProjectActionBusy(false)
        }
    }, [renameProject, showAlert])

    const handleDeleteProject = useCallback(async (project: Project) => {
        const confirmed = await showAlert(
            `确定删除项目「${project.name}」吗？此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        try {
            await db_delete_project(project.id)
            removeHomeProjectActivity(project.id)
            await invalidateProjectList()
            if (starredProjectIds.includes(project.id)) {
                const nextIds = starredProjectIds.filter(id => id !== project.id)
                setStarredProjectIds(nextIds)
                await saveStarredProjectIds(nextIds)
            }
            await showAlert('项目已删除', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`删除项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [saveStarredProjectIds, showAlert, starredProjectIds])

    const handleProjectContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, project: Project) => {
        showContextMenu(event, [
            {label: '重命名', onClick: () => setRenameProject(project)},
            {label: '删除', danger: true, onClick: () => void handleDeleteProject(project)},
            {
                label: starredProjectIdSet.has(project.id) ? '取消标星' : '标星',
                onClick: () => void toggleProjectStar(project),
            },
        ])
    }, [handleDeleteProject, showContextMenu, starredProjectIdSet, toggleProjectStar])

    const projectCountLabel = hasLoadedProjects ? projects.length : '-'
    const filteredProjectCountLabel = hasLoadedProjects ? filteredProjects.length : '-'
    const quickActions = useMemo<Array<{
        key: string
        title: string
        description: string
        tone: 'world' | 'idea' | 'ai' | 'snapshot'
        icon: ReactNode
        target?: HomeActivityTarget
        onClick?: () => void
    }>>(() => [
        {
            key: 'new-world',
            title: '开始一个新世界',
            description: '从项目名称、简介和封面开始，先搭好世界观的创作容器。',
            tone: 'world',
            icon: (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">
                    <circle cx="11" cy="13" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path
                        d="M3.5 13h15M11 5.5c1.8 2.1 2.8 4.6 2.8 7.5s-1 5.4-2.8 7.5M11 5.5c-1.8 2.1-2.8 4.6-2.8 7.5s1 5.4 2.8 7.5"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                    <path d="M19 3.5v4M17 5.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            ),
            onClick: () => setCreatorOpen(true),
        },
        {
            key: 'idea',
            title: '记录灵感',
            description: '把片段、角色点子和待整理设定先收进灵感箱，稍后归档。',
            tone: 'idea',
            icon: (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">
                    <path
                        d="M12 3C14 8 16 10 21 12C16 14 14 16 12 21C10 16 8 14 3 12C8 10 10 8 12 3Z"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                </svg>
            ),
            target: {
                type: 'idea',
                id: 'idea-panel',
                title: '灵感收件箱',
                subtitle: '快速记录',
            },
        },
        {
            key: 'ai-chat',
            title: '打开 AI 助手',
            description: '让 AI 帮你拆解世界框架、扩写设定片段，或检查内容里的冲突。',
            tone: 'ai',
            icon: (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">
                    <path
                        d="M5 9.5A3.5 3.5 0 0 1 8.5 6h7A3.5 3.5 0 0 1 19 9.5v4A3.5 3.5 0 0 1 15.5 17H10l-4 3v-3.6A3.48 3.48 0 0 1 5 13.5v-4Z"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                    <path d="M9 10h5M9 13h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path
                        d="M17.5 4.5 18 6l1.5.5-1.5.5-.5 1.5-.5-1.5L15.5 6.5 17 6l.5-1.5Z"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                </svg>
            ),
            target: {
                type: 'conversation',
                id: 'ai-chat-panel',
                title: 'AI 助手',
                subtitle: '创作辅助',
            },
        },
        {
            key: 'snapshot',
            title: '查看快照',
            description: '回看最近保存的版本，适合在大改设定前确认可回退节点。',
            tone: 'snapshot',
            icon: (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">
                    <circle cx="8" cy="6" r="2" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="8" cy="18" r="2" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="16" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path
                        d="M8 8v8m2-10h3.5A2.5 2.5 0 0 1 16 8.5v1.5M10 18h3.5A2.5 2.5 0 0 0 16 15.5V14"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                </svg>
            ),
            target: {
                type: 'snapshot',
                id: 'snapshot-panel',
                title: '快照',
                subtitle: '版本记录',
            },
        },
    ], [])
    const isVisibleHomeTarget = useCallback((target: HomeActivityTarget) => {
        const key = getHomeActivityTargetKey(target)
        if (invalidHomeTargetKeys.has(key)) return false

        if (hasLoadedProjects && isProjectBackedTarget(target)) {
            const projectId = getDashboardProjectId(target)
            if (!projectId || !projectIdSet.has(projectId)) return false
        }

        if (target.type === 'entry' && hasLoadedProjects) {
            if (pendingEntryTargetKeys.has(key)) return false
            return validEntryTargetKeys.has(key)
        }

        return true
    }, [hasLoadedProjects, invalidHomeTargetKeys, pendingEntryTargetKeys, projectIdSet, validEntryTargetKeys])
    const visibleRecentItems = useMemo(() => (
        dashboard.recentItems.filter(item => isVisibleHomeTarget(item))
    ), [dashboard.recentItems, isVisibleHomeTarget])
    const continueItem = useMemo(() => {
        if (dashboard.continueItem && isVisibleHomeTarget(dashboard.continueItem)) {
            return dashboard.continueItem
        }
        return visibleRecentItems[0] ?? null
    }, [dashboard.continueItem, isVisibleHomeTarget, visibleRecentItems])
    const recentItems = useMemo(() => {
        const continueKey = continueItem ? getHomeActivityTargetKey(continueItem) : null
        return visibleRecentItems
            .filter(item => !continueKey || getHomeActivityTargetKey(item) !== continueKey)
            .slice(0, 5)
    }, [continueItem, visibleRecentItems])
    const aiAssistantAction = quickActions.find(action => action.key === 'ai-chat')
    const ideaAction = quickActions.find(action => action.key === 'idea')

    const openDashboardTarget = useCallback((target: HomeActivityTarget) => {
        const projectId = getDashboardProjectId(target)
        if (hasLoadedProjects && isProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
            if (projectId) {
                removeHomeProjectActivity(projectId)
            } else {
                removeHomeActivityTarget(target)
            }
            void showAlert('这个首页入口指向的内容已不存在，已从首页移除。', 'warning', 'nonInvasive', 3000)
            return
        }
        if (target.type === 'project') {
            const targetProjectId = target.projectId ?? target.id
            const project = projects.find(item => item.id === targetProjectId)
            if (project) {
                onOpenProject?.(project)
                return
            }
        }
        void onOpenHomeTarget?.(target)
    }, [hasLoadedProjects, onOpenHomeTarget, onOpenProject, projectIdSet, projects, showAlert])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        const importedProject = await db_get_project(result.projectId)
        onOpenProject?.(importedProject)
    }, [onOpenProject])

    const handleImportProject = useCallback(async () => {
        if (importing) return
        const selectedPath = await openFileDialog({
            multiple: false,
            filters: [{
                name: '流云AI World',
                extensions: ['fcworld'],
            }],
        })
        if (!selectedPath || Array.isArray(selectedPath)) return

        setImporting(true)
        try {
            const previewOperationId = startProgress('import', '检查导入包')
            const preview = await db_preview_project_fcworld(selectedPath, previewOperationId)
            if (preview.duplicateProject) {
                closeProgress()
                setImportConflict(preview)
                return
            }
            closeProgress()
            const importOperationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(selectedPath, {
                mode: 'rename',
                projectName: preview.projectName,
            }, importOperationId)
            finishProgress()
            await openImportedProject(result)
        } catch (error) {
            closeProgress()
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'nonInvasive', 3600)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictCancel = useCallback(() => {
        if (!importing) setImportConflict(null)
    }, [importing])

    const handleImportConflictRename = useCallback(async (projectName: string) => {
        if (!importConflict || importing) return
        const inputPath = importConflict.inputPath
        setImportConflict(null)
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(inputPath, {
                mode: 'rename',
                projectName,
            }, operationId)
            finishProgress()
            await openImportedProject(result)
        } catch (error) {
            closeProgress()
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'nonInvasive', 3600)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictOverwrite = useCallback(async () => {
        if (!importConflict?.duplicateProject || importing) return
        const inputPath = importConflict.inputPath
        const overwriteProjectId = importConflict.duplicateProject.projectId
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setImportConflict(null)
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(inputPath, {
                mode: 'overwrite',
                overwriteProjectId,
            }, operationId)
            finishProgress()
            await openImportedProject(result)
        } catch (error) {
            closeProgress()
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'nonInvasive', 3600)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const renderRecentItem = (item: HomeActivityRecord) => (
        <button
            key={item.key}
            type="button"
            className="project-home-recent-item"
            onClick={() => openDashboardTarget(item)}
        >
            <span className="project-home-recent-item__type">{getTargetTypeLabel(item.type)}</span>
            <span className="project-home-recent-item__title">{item.title}</span>
            <span className="project-home-recent-item__time">{formatRelativeTime(item.lastOpenedAt)}</span>
        </button>
    )

    return (
        <>
            <FloatingPanel
                open={welcomeOpen}
                dismissible={false}
                className="project-home-welcome-overlay"
                ariaLabel="欢迎使用流云AI"
            >
                <div className="project-home-welcome">
                    <div className="project-home-welcome__body">
                        <span className="project-home-welcome__eyebrow">欢迎使用流云AI</span>
                        <h2>先从第一个世界观开始</h2>
                        <p>
                            流云AI会把世界项目、词条、灵感和 AI 辅助放在同一个创作工作区里。你可以先看一遍简短教程，也可以直接开始使用。
                        </p>
                    </div>
                    <div className="project-home-welcome__actions">
                        <Button type="button" variant="ghost" onClick={() => finishWelcome(false)}>
                            暂不需要
                        </Button>
                        <Button type="button" onClick={() => finishWelcome(true)}>
                            开启教程
                        </Button>
                    </div>
                </div>
            </FloatingPanel>
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={project => onOpenProject?.(project)}
                existingNames={projects.map(p => p.name)}
            />
            <ProjectImportConflictDialog
                open={Boolean(importConflict)}
                preview={importConflict}
                existingNames={projects.map(p => p.name)}
                busy={importing}
                onCancel={handleImportConflictCancel}
                onRename={projectName => void handleImportConflictRename(projectName)}
                onOverwrite={() => void handleImportConflictOverwrite()}
            />
            <RenameDialog
                open={Boolean(renameProject)}
                title="重命名项目"
                initialValue={renameProject?.name ?? ''}
                placeholder="输入项目名称"
                confirmText="保存"
                busy={projectActionBusy}
                onClose={() => {
                    if (!projectActionBusy) setRenameProject(null)
                }}
                onConfirm={name => void handleRenameProject(name)}
            />
            <FcworldProgressDialog progress={fcworldProgress} />
            <RollingBox axis="y" style={{padding: '0.35rem'} as CSSProperties} thumbSize="thin">
                <div className="project-list-page fc-page-shell">
                    <section className="project-home-hero" data-tour-id="home-overview">
                        <div className="project-home-hero__main">
                            <div className="project-list-title-block fc-page-title-block">
                                <h1 className="project-list-title fc-page-title">创作首页</h1>
                                <p className="project-list-subtitle fc-page-subtitle">
                                    从世界项目开始组织创作：继续上次进度、记录突然出现的灵感，或让 AI 先帮你搭出设定骨架。
                                </p>
                            </div>
                            <div className="project-home-hero__actions">
                                <Button
                                    type="button"
                                    size="lg"
                                    onClick={() => {
                                        if (continueItem) {
                                            openDashboardTarget(continueItem)
                                            return
                                        }
                                        setCreatorOpen(true)
                                    }}
                                >
                                    {continueItem ? `继续创作：${continueItem.title}` : '创建你的第一个世界'}
                                </Button>
                                {aiAssistantAction?.target && (
                                    <Button
                                        type="button"
                                        size="lg"
                                        variant="outline"
                                        onClick={() => openDashboardTarget(aiAssistantAction.target!)}
                                    >
                                        打开 AI 助手
                                    </Button>
                                )}
                                {ideaAction?.target && (
                                    <Button
                                        type="button"
                                        size="lg"
                                        variant="ghost"
                                        onClick={() => openDashboardTarget(ideaAction.target!)}
                                    >
                                        记录灵感
                                    </Button>
                                )}
                            </div>
                            <div className="project-home-path-hint" aria-label="推荐创作流程">
                                <span className="project-home-path-hint__label">建议路径</span>
                                {hasLoadedProjects && projects.length === 0 ? (
                                    <ol className="project-home-path-list">
                                        <li>创建世界</li>
                                        <li>写第一条词条</li>
                                        <li>让 AI 梳理设定</li>
                                    </ol>
                                ) : (
                                    <p>继续当前项目后，可以从词条、地图、时间线或 AI 讨论接着推进。</p>
                                )}
                            </div>
                            {continueItem && (
                                <button
                                    type="button"
                                    className="project-home-continue-card"
                                    onClick={() => openDashboardTarget(continueItem)}
                                >
                                    <span className="project-home-eyebrow">上次停在这里</span>
                                    <div className="project-home-continue-card__topline">
                                        <span className="project-home-continue-card__title">{continueItem.title}</span>
                                    </div>
                                    <p>
                                        {continueItem.subtitle || getTargetTypeLabel(continueItem.type)}
                                        {dashboard.lastSession?.savedAt ? ` · ${formatRelativeTime(dashboard.lastSession.savedAt)}` : ''}
                                    </p>
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="project-home-panel project-home-panel--quick" data-tour-id="home-quick-actions">
                        <div className="project-home-panel__heading">
                            <h2>重点功能</h2>
                            <p>根据你现在的状态选择入口：新项目先建世界，零散想法先记灵感，已有材料可以直接交给 AI 梳理。</p>
                        </div>
                        <div className="project-home-action-list">
                            {quickActions.map(action => (
                                <button
                                    key={action.key}
                                    type="button"
                                    className={`project-home-action-item project-home-action-item--${action.tone}`}
                                    data-tour-id={action.key === 'new-world' ? 'home-new-world-action' : undefined}
                                    onClick={() => {
                                        if (action.onClick) {
                                            action.onClick()
                                            return
                                        }
                                        if (action.target) {
                                            openDashboardTarget(action.target)
                                        }
                                    }}
                                >
                                    <span className="project-home-action-item__icon" aria-hidden="true">
                                        {action.icon}
                                    </span>
                                    <span className="project-home-action-item__title">{action.title}</span>
                                    <small className="project-home-action-item__desc">{action.description}</small>
                                </button>
                            ))}
                        </div>
                    </section>

                    <div className="project-home-side">
                            <section className="project-home-panel">
                                <h2>最近内容</h2>
                                {recentItems.length > 0 ? (
                                    <div className="project-home-recent-list">
                                        {recentItems.map(renderRecentItem)}
                                    </div>
                                ) : (
                                    <p className="project-home-muted">打开项目或词条后，会在这里保留回到现场的入口。</p>
                                )}
                            </section>
                            <section className="project-home-panel">
                                <h2>帮助</h2>
                                <div className="project-home-help-list">
                                    {dashboard.helpLinks.map(link => (
                                        <button
                                            key={link.key}
                                            type="button"
                                            className="project-home-help-item"
                                            onClick={() => openDashboardTarget(link.target)}
                                        >
                                            <span>{link.title}</span>
                                            <small>{link.description}</small>
                                        </button>
                                    ))}
                                </div>
                            </section>
                    </div>

                    <section className="project-home-workbench">
                        <div className="project-list-header fc-page-header">
                            <div className="project-list-title-block fc-page-title-block">
                                <h2 className="project-list-section-title">我的世界</h2>
                                <p className="project-list-subtitle fc-page-subtitle">
                                    你正在构建 {projectCountLabel} 个世界。
                                </p>
                            </div>
                            <div className="project-list-header-actions fc-page-header-actions">
                                <Button type="button" size="sm" onClick={() => setCreatorOpen(true)}>
                                    开始一个新世界
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={importing}
                                    onClick={() => void handleImportProject()}
                                >
                                    {importing ? '导入中…' : '导入世界'}
                                </Button>
                                <Button
                                    type="button"
                                    className="project-list-refresh"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    onClick={() => void refreshProjects()}
                                >
                                    刷新
                                </Button>
                            </div>
                        </div>

                        <div className="project-list-toolbar">
                            <Input
                                className="project-list-search"
                                placeholder="搜索项目名称或描述…"
                                value={searchText}
                                onValueChange={setSearchText}
                            />
                            <div className="project-list-sort-tabs">
                                {SORT_OPTIONS.map(option => (
                                    <button
                                        key={option.key}
                                        className={`project-list-sort-tab${sortMode === option.key ? ' active' : ''}`}
                                        onClick={() => setSortMode(option.key)}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                                <button
                                    className={`project-list-sort-tab${sortMode === 'name-asc' || sortMode === 'name-desc' ? ' active' : ''}`}
                                    onClick={() => setSortMode(current => current === 'name-asc' ? 'name-desc' : 'name-asc')}
                                >
                                    {sortMode === 'name-desc' ? '标题 Z-A' : '标题 A-Z'}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="project-list-feedback fc-status-banner fc-status-banner--error error">
                                项目列表加载失败：{error}
                            </div>
                        )}

                        {!error && (
                            <div className="project-list-feedback fc-status-banner">
                                共 {projectCountLabel} 个项目，当前显示 {filteredProjectCountLabel} 个。
                            </div>
                        )}

                        {hasLoadedProjects && projects.length === 0 && !loading ? (
                            <section className="project-list-empty-state">
                                <div className="project-list-empty-panel fc-empty-state-card">
                                    <h2 className="project-list-empty-title fc-empty-state-title">给灵感一个安放之处</h2>
                                    <p className="project-list-empty-copy fc-empty-state-copy">
                                        从一名角色、一个物品、一处地点开始，构建属于你的世界
                                    </p>
                                    <Button type="button" size="lg" onClick={() => setCreatorOpen(true)}>创建你的第一个世界</Button>
                                </div>
                            </section>
                        ) : hasLoadedProjects || loading || error ? (
                            <div className="project-list-grid">
                                {filteredProjects.length === 0 && !loading ? (
                                    <div className="project-list-feedback fc-status-banner">
                                        没有匹配的项目。
                                    </div>
                                ) : (
                                    filteredProjects.map(project => {
                                        const coverPath = asOptionalString(project.cover_path)
                                        const updatedAt = asOptionalString(project.updated_at)
                                        const createdAt = asOptionalString(project.created_at)
                                        const image = toProjectImageSrc(coverPath)
                                        const timestampLabel = formatDate(updatedAt ?? createdAt)
                                        const isStarred = starredProjectIdSet.has(project.id)

                                        return (
                                            <div
                                                key={project.id}
                                                style={{cursor: onOpenProject ? 'pointer' : undefined}}
                                                onClick={() => onOpenProject?.(project)}
                                                onContextMenu={event => handleProjectContextMenu(event, project)}
                                            >
                                                <Card
                                                    className="project-list-card"
                                                    image={image}
                                                    imageSlot={!image ? (
                                                        <div className="project-list-placeholder">
                                                        </div>
                                                    ) : undefined}
                                                    title={project.name}
                                                    tag={isStarred ? <ProjectStarTag /> : undefined}
                                                    description={project.description || '你的世界在等你回来，继续把新的角色、地点和事件写进去。'}
                                                    extraInfo={(
                                                        <div className="project-list-meta">
                                                            <span>最近更新 {timestampLabel}</span>
                                                        </div>
                                                    )}
                                                    variant="shadow"
                                                    hoverable
                                                    expandContentOnHover
                                                    imageHeight="100%"
                                                    contentAreaRatio={0.2}
                                                    hoverContentAreaRatio={0.8}
                                                    overlayStartOpacity={1}
                                                    overlayEndOpacity={0}
                                                />
                                            </div>
                                        )
                                    })
                                )}
                                <button
                                    type="button"
                                    className="project-list-create-card"
                                    onClick={() => setCreatorOpen(true)}
                                >
                                    <span className="project-list-create-card__plus">+</span>
                                    <span className="project-list-create-card__label">新建世界观</span>
                                </button>
                            </div>
                        ) : null}
                    </section>
                </div>
            </RollingBox>
        </>
    )
}

export default memo(ProjectList)
