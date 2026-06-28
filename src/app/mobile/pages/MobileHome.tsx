import {
    type CSSProperties,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {useDrag, useWheel} from '@use-gesture/react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {convertFileSrc} from '../../../api/assets'
import {openFileDialog} from '../../../api/dialog'
import {
    db_count_entries,
    db_get_entry,
    db_get_project,
    db_import_project_fcworld,
    db_preview_project_fcworld,
    type FcworldImportPreview,
    type FcworldImportResult,
    type Project,
} from '../../../api'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
import ProjectImportConflictDialog from '../../../features/projects/components/ProjectImportConflictDialog'
import {useFcworldProgress} from '../../../features/projects/hooks/useFcworldProgress'
import {invalidateProjectList, useProjectListStore} from '../../../features/projects/projectListStore'
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
} from '../../../features/home/homeActivity'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {MobileTopActionPill} from '../components/MobileTopControls'
import './MobileHome.css'

interface Props {
    push: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    setBeforeBack: (handler: (() => boolean | Promise<boolean>) | null) => void
    activePanel: MobileHomePanel
    onActivePanelChange: (panel: MobileHomePanel) => void
}

type WorldSortMode = 'updated-desc' | 'created-desc' | 'name-asc' | 'size-desc'
type WorldDisplayMode = 'card' | 'list'
export type MobileHomePanel = 'dashboard' | 'worlds'

const PANEL_SWITCH_THRESHOLD = 72

const WORLD_DISPLAY_OPTIONS: Array<{key: WorldDisplayMode; label: string; desc: string}> = [
    {key: 'card', label: '卡片', desc: '两列封面卡片'},
    {key: 'list', label: '列表', desc: '更适合扫标题'},
]

const WORLD_SORT_OPTIONS: Array<{key: WorldSortMode; label: string}> = [
    {key: 'updated-desc', label: '更新日期'},
    {key: 'created-desc', label: '创建日期'},
    {key: 'name-asc', label: '名称排序'},
    {key: 'size-desc', label: '项目体量'},
]

const WORLD_SORT_DETAILS: Record<WorldSortMode, string> = {
    'updated-desc': '最新到最旧',
    'created-desc': '新建到较早',
    'name-asc': 'A 到 Z',
    'size-desc': '词条多到少',
}

function FilterCheckIcon() {
    return (
        <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
            <path
                d="M5 12.5 9.2 16.7 19 6.8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.35"
            />
        </svg>
    )
}

function FilterCardIcon() {
    return (
        <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
            <rect x="4" y="4" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
            <rect x="13.8" y="4" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
            <rect x="4" y="13.8" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
            <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="1.35" fill="none" stroke="currentColor" strokeWidth="2.05"/>
        </svg>
    )
}

function FilterListIcon() {
    return (
        <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
            <circle cx="5" cy="6" r="1.25" fill="currentColor"/>
            <circle cx="5" cy="12" r="1.25" fill="currentColor"/>
            <circle cx="5" cy="18" r="1.25" fill="currentColor"/>
            <path d="M9 6h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
            <path d="M9 12h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
            <path d="M9 18h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
        </svg>
    )
}

function FilterImportIcon() {
    return (
        <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
            <path d="M12 4v10.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
            <path d="M7.8 10.4 12 14.6l4.2-4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"/>
            <path d="M5.8 18.2h12.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2"/>
        </svg>
    )
}

function FilterRefreshIcon() {
    return (
        <svg className="mobile-home-filter__svg" viewBox="0 0 24 24" focusable="false">
            <path
                d="M18.4 8.1A6.7 6.7 0 0 0 6.5 7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.2"
            />
            <path d="M18.5 4.9v3.6h-3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"/>
            <path
                d="M5.6 15.9A6.7 6.7 0 0 0 17.5 17"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.2"
            />
            <path d="M5.5 19.1v-3.6h3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"/>
        </svg>
    )
}

function renderDisplayIcon(mode: WorldDisplayMode) {
    if (mode === 'card') return <FilterCardIcon/>
    return <FilterListIcon/>
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

function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

function getTargetTypeLabel(type: HomeActivityTarget['type']): string {
    switch (type) {
        case 'project': return '世界'
        case 'entry': return '词条'
        case 'tool': return '工具'
        case 'idea': return '灵感'
        case 'conversation': return '对话'
        case 'snapshot': return '快照'
        case 'help': return '帮助'
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
    if (dashboard.continueItem) targets.push(dashboard.continueItem)
    return targets
}

export default function MobileHome({
    push,
    navigateToTab,
    setAiFocus,
    setBeforeBack,
    activePanel,
    onActivePanelChange,
}: Props) {
    const {showAlert} = useAlert()
    const {
        projects,
        loading,
        error,
        hasLoaded: hasLoadedProjects,
        refresh: refreshProjects,
    } = useProjectListStore()
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const homeRef = useRef<HTMLDivElement | null>(null)
    const worldPanelRef = useRef<HTMLElement | null>(null)
    const worldActionsRef = useRef<HTMLDivElement | null>(null)
    const touchWorldScrollTopRef = useRef(0)

    const [dashboard, setDashboard] = useState<HomeDashboardData>(() => loadHomeDashboardData())
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [countsError, setCountsError] = useState<string | null>(null)
    const [validEntryTargetKeys, setValidEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const [invalidHomeTargetKeys, setInvalidHomeTargetKeys] = useState<Set<string>>(() => new Set())
    const [pendingEntryTargetKeys, setPendingEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const [searchText, setSearchText] = useState('')
    const [displayMode, setDisplayMode] = useState<WorldDisplayMode>('card')
    const [sortMode, setSortMode] = useState<WorldSortMode>('updated-desc')
    const [filterOpen, setFilterOpen] = useState(false)
    const [filterAnchor, setFilterAnchor] = useState<{top: number; right: number} | null>(null)
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importing, setImporting] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)

    const updateFilterAnchor = useCallback(() => {
        const homeElement = homeRef.current
        const actionsElement = worldActionsRef.current
        if (!homeElement || !actionsElement) return
        const homeRect = homeElement.getBoundingClientRect()
        const actionsRect = actionsElement.getBoundingClientRect()
        setFilterAnchor({
            top: Math.max(0, actionsRect.top - homeRect.top),
            right: Math.max(0, homeRect.right - actionsRect.right),
        })
    }, [])

    const toggleFilterMenu = useCallback(() => {
        setFilterOpen(open => {
            if (!open) updateFilterAnchor()
            return !open
        })
    }, [updateFilterAnchor])

    useEffect(() => {
        if (!filterOpen) return undefined
        updateFilterAnchor()
        const viewport = window.visualViewport
        window.addEventListener('resize', updateFilterAnchor)
        viewport?.addEventListener('resize', updateFilterAnchor)
        return () => {
            window.removeEventListener('resize', updateFilterAnchor)
            viewport?.removeEventListener('resize', updateFilterAnchor)
        }
    }, [filterOpen, updateFilterAnchor])

    useEffect(() => {
        if (!filterOpen) return undefined
        setBeforeBack(() => {
            setFilterOpen(false)
            return false
        })
        return () => setBeforeBack(null)
    }, [filterOpen, setBeforeBack])

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
        if (projects.length === 0) {
            setEntryCounts({})
            setCountsError(null)
            return
        }

        let cancelled = false
        setCountsError(null)
        const loadCounts = async () => {
            try {
                const counts = await Promise.all(
                    projects.map(async project => [project.id, await db_count_entries({projectId: project.id})] as const)
                )
                if (!cancelled) setEntryCounts(Object.fromEntries(counts))
            } catch (e) {
                if (!cancelled) setCountsError(String(e))
            }
        }
        void loadCounts()
        return () => {
            cancelled = true
        }
    }, [projects])

    const projectIdSet = useMemo(() => new Set(projects.map(project => project.id)), [projects])

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

    const isVisibleHomeTarget = useCallback((target: HomeActivityTarget) => {
        const key = getHomeActivityTargetKey(target)
        if (invalidHomeTargetKeys.has(key)) return false

        if (hasLoadedProjects && isProjectBackedTarget(target)) {
            const projectId = getDashboardProjectId(target)
            if (!projectId || !projectIdSet.has(projectId)) return false
        }

        if (target.type === 'entry') {
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

    const worldProjects = useMemo(() => {
        const query = searchText.trim().toLowerCase()
        return projects
            .filter(project => {
                if (!query) return true
                return project.name.toLowerCase().includes(query)
                    || (project.description ?? '').toLowerCase().includes(query)
            })
            .sort((a, b) => {
                const nameOrder = a.name.localeCompare(b.name, 'zh-CN')
                switch (sortMode) {
                    case 'created-desc':
                        return parseDateValue(b.created_at) - parseDateValue(a.created_at) || nameOrder
                    case 'name-asc':
                        return nameOrder
                    case 'size-desc':
                        return (entryCounts[b.id] ?? 0) - (entryCounts[a.id] ?? 0) || nameOrder
                    case 'updated-desc':
                    default:
                        return parseDateValue(b.updated_at ?? b.created_at) - parseDateValue(a.updated_at ?? a.created_at) || nameOrder
                }
            })
    }, [entryCounts, projects, searchText, sortMode])

    const loadingWorlds = loading && projects.length === 0
    const worldError = error ?? countsError

    const handleOpenProject = useCallback((project: Project) => {
        setAiFocus({projectId: project.id, entryId: null})
        push({type: 'projectHome', params: {projectId: project.id, displayName: project.name}})
    }, [push, setAiFocus])

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
                handleOpenProject(project)
                return
            }
        }

        if (target.type === 'entry') {
            const targetProjectId = getDashboardProjectId(target)
            const targetEntryId = getDashboardEntryId(target)
            if (targetProjectId && targetEntryId) {
                setAiFocus({projectId: targetProjectId, entryId: targetEntryId})
                push({
                    type: 'entryDetail',
                    params: {
                        projectId: targetProjectId,
                        entryId: targetEntryId,
                        displayName: target.title || '词条',
                    },
                })
                return
            }
        }

        if (target.type === 'tool' && projectId) {
            const project = projects.find(item => item.id === projectId)
            if (project) {
                handleOpenProject(project)
                void showAlert('移动端暂未单独打开该工具面板，已进入对应世界。', 'info', 'nonInvasive', 2200)
                return
            }
        }

        if (target.type === 'idea') {
            navigateToTab('ideas')
            return
        }

        if (target.type === 'conversation') {
            navigateToTab('ai')
            return
        }

        void showAlert(target.description || '该入口暂未接入移动端。', 'info', 'nonInvasive', 2600)
    }, [handleOpenProject, hasLoadedProjects, navigateToTab, projectIdSet, projects, push, setAiFocus, showAlert])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        const project = await db_get_project(result.projectId)
        handleOpenProject(project)
    }, [handleOpenProject])

    const handleImportProject = useCallback(async () => {
        if (importing) return
        const selectedPath = await openFileDialog({
            multiple: false,
            filters: [{
                name: 'FlowCloudAI World',
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
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'nonInvasive', 3200)
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
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'nonInvasive', 3200)
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
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'nonInvasive', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const handleHelp = useCallback(() => {
        void showAlert('首页展示桌面端同一套继续创作和最近内容；向上滑动即可进入世界观列表。', 'info', 'nonInvasive', 2800)
    }, [showAlert])

    const settlePagerDrag = useCallback((deltaY: number, worldStartScrollTop: number) => {
        if (Math.abs(deltaY) < PANEL_SWITCH_THRESHOLD) return

        if (activePanel === 'dashboard' && deltaY < 0) {
            onActivePanelChange('worlds')
            return
        }

        if (activePanel === 'worlds' && deltaY > 0 && worldStartScrollTop <= 4) {
            onActivePanelChange('dashboard')
        }
    }, [activePanel, onActivePanelChange])

    const bindPagerDrag = useDrag(({
        first,
        last,
        movement: [, deltaY],
    }) => {
        if (first) {
            touchWorldScrollTopRef.current = worldPanelRef.current?.scrollTop ?? 0
        }
        if (!last) return
        settlePagerDrag(deltaY, touchWorldScrollTopRef.current)
    }, {
        axis: 'y',
        filterTaps: true,
        pointer: {keys: false, touch: true},
        threshold: 8,
    })

    const bindPagerWheel = useWheel(({event}) => {
        if (Math.abs(event.deltaY) < 32) return
        if (activePanel === 'dashboard' && event.deltaY > 0) {
            onActivePanelChange('worlds')
            return
        }
        if (activePanel === 'worlds' && event.deltaY < 0 && (worldPanelRef.current?.scrollTop ?? 0) <= 4) {
            onActivePanelChange('dashboard')
        }
    })

    const renderRecentItem = (item: HomeActivityRecord) => (
        <button
            key={item.key}
            type="button"
            className="mobile-home-recent-item"
            onClick={() => openDashboardTarget(item)}
        >
            <span className="mobile-home-recent-item__type">{getTargetTypeLabel(item.type)}</span>
            <span className="mobile-home-recent-item__title">{item.title}</span>
            <span className="mobile-home-recent-item__time">{formatRelativeTime(item.lastOpenedAt)}</span>
        </button>
    )

    const renderWorldCard = (project: Project) => {
        const image = toProjectImageSrc(project.cover_path)
        const meta = `${entryCounts[project.id] ?? 0} 词条 · 更新于 ${formatDate(project.updated_at ?? project.created_at)}`
        if (displayMode === 'list') {
            return (
                <button
                    type="button"
                    className="mobile-list-card mobile-home-world-list-card"
                    key={project.id}
                    onClick={() => handleOpenProject(project)}
                >
                    <span className="mobile-list-card__title">{project.name}</span>
                    <span className="mobile-list-card__description">{project.description || meta}</span>
                    <span className="mobile-list-card__meta">{meta}</span>
                </button>
            )
        }

        return (
            <Card
                key={project.id}
                className="mobile-project-card mobile-home-world-card"
                title={project.name}
                description={project.description || '你的世界在等你回来，继续补全新的角色、地点和事件。'}
                image={image}
                imageHeight="8.5rem"
                extraInfo={<span className="mobile-project-card__meta">{meta}</span>}
                variant="shadow"
                hoverable
                onClick={() => handleOpenProject(project)}
            />
        )
    }

    return (
        <div
            ref={homeRef}
            className={`mobile-page mobile-home mobile-home--${activePanel}`}
            {...bindPagerDrag()}
            {...bindPagerWheel()}
        >
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={handleOpenProject}
                existingNames={projects.map(project => project.name)}
            />
            <ProjectImportConflictDialog
                open={Boolean(importConflict)}
                preview={importConflict}
                existingNames={projects.map(project => project.name)}
                busy={importing}
                onCancel={handleImportConflictCancel}
                onRename={projectName => void handleImportConflictRename(projectName)}
                onOverwrite={() => void handleImportConflictOverwrite()}
            />
            <FcworldProgressDialog progress={fcworldProgress} />

            <div className="mobile-home__pager">
                <section className="mobile-home__panel mobile-home__dashboard">
                    <div className="mobile-home__hero">
                        <h2 className="mobile-home__title">首页</h2>
                        <button
                            type="button"
                            className="mobile-home__help"
                            aria-label="帮助"
                            onClick={handleHelp}
                        >
                            ?
                        </button>
                    </div>

                    <Input
                        placeholder="搜索世界观…"
                        value={searchText}
                        onValueChange={setSearchText}
                        className="mobile-home__search"
                        radius="full"
                        size="lg"
                        allowClear
                    />

                    <section className="mobile-home__section">
                        <div className="mobile-home__section-head">
                            <h3 className="mobile-home__section-title">继续创作</h3>
                        </div>
                        {continueItem ? (
                            <button
                                type="button"
                                className="mobile-home__continue"
                                onClick={() => openDashboardTarget(continueItem)}
                            >
                                <span className="mobile-home__eyebrow">上次停在这里</span>
                                <span className="mobile-home__continue-title">{continueItem.title}</span>
                                <span className="mobile-home__continue-desc">
                                    {continueItem.subtitle || getTargetTypeLabel(continueItem.type)}
                                    {dashboard.lastSession?.savedAt ? ` · ${formatRelativeTime(dashboard.lastSession.savedAt)}` : ''}
                                </span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="mobile-home__continue mobile-home__continue--empty"
                                onClick={() => setCreatorOpen(true)}
                            >
                                <span className="mobile-home__continue-title">创建你的第一个世界</span>
                                <span className="mobile-home__continue-desc">从世界观容器开始，再补词条、关系和图片。</span>
                            </button>
                        )}
                    </section>

                    <section className="mobile-home__section mobile-home__section--recent">
                        <div className="mobile-home__section-head">
                            <h3 className="mobile-home__section-title">最近内容</h3>
                        </div>
                        {recentItems.length > 0 ? (
                            <div className="mobile-home__recent-list">
                                {recentItems.map(renderRecentItem)}
                            </div>
                        ) : (
                            <p className="mobile-home__muted">打开项目或词条后，会在这里保留回到现场的入口。</p>
                        )}
                    </section>

                    <button
                        type="button"
                        className="mobile-home__project-list-button"
                        onClick={() => onActivePanelChange('worlds')}
                    >
                        项目列表
                    </button>
                </section>

                <section
                    ref={worldPanelRef}
                    className="mobile-home__panel mobile-home-worlds"
                    aria-label="世界观列表"
                >
                    <div className="mobile-home-worlds__head">
                        <div className="mobile-home-worlds__copy">
                            <span className="mobile-home__eyebrow">
                                {loadingWorlds ? '正在同步' : `${worldProjects.length} 个世界`}
                            </span>
                            <h2 className="mobile-home-worlds__title">世界观</h2>
                        </div>
                        <MobileTopActionPill
                            ref={worldActionsRef}
                            actions={[
                                {
                                    key: 'create',
                                    label: '新建世界观',
                                    icon: '+',
                                    kind: 'add',
                                    onClick: () => setCreatorOpen(true),
                                },
                                {
                                    key: 'filter',
                                    label: '筛选与排序',
                                    icon: '…',
                                    kind: 'more',
                                    ariaHasPopup: 'menu',
                                    ariaExpanded: filterOpen,
                                    onClick: toggleFilterMenu,
                                },
                            ]}
                        />
                    </div>

                    <Input
                        placeholder="搜索世界观…"
                        value={searchText}
                        onValueChange={setSearchText}
                        className="mobile-home-worlds__search"
                        radius="full"
                        size="lg"
                        allowClear
                    />

                    {worldError && projects.length === 0 ? (
                        <div className="mobile-page__error">加载失败：{worldError}</div>
                    ) : loadingWorlds ? (
                        <div className="mobile-page__loading mobile-home__state-panel">加载中…</div>
                    ) : projects.length === 0 ? (
                        <div className="mobile-page__empty mobile-home__state-panel">
                            <p>还没有任何世界观</p>
                            <Button type="button" onClick={() => setCreatorOpen(true)}>创建第一个世界</Button>
                        </div>
                    ) : worldProjects.length === 0 ? (
                        <div className="mobile-page__empty mobile-home__state-panel">没有匹配的世界观</div>
                    ) : (
                        <div className={`mobile-home-worlds__grid mobile-home-worlds__grid--${displayMode}`}>
                            {worldProjects.map(renderWorldCard)}
                        </div>
                    )}
                </section>
            </div>

            {filterOpen ? (
                <div
                    className="mobile-home-filter-layer"
                    role="presentation"
                    onPointerDown={event => {
                        if (event.target === event.currentTarget) setFilterOpen(false)
                    }}
                >
                    <div
                        className="mobile-home-filter"
                        role="menu"
                        aria-label="世界观筛选与排序"
                        style={filterAnchor ? {
                            '--mobile-home-filter-top': `${filterAnchor.top}px`,
                            '--mobile-home-filter-right': `${filterAnchor.right}px`,
                        } as CSSProperties : undefined}
                        onPointerDown={event => event.stopPropagation()}
                    >
                        <div className="mobile-home-filter__group" aria-label="显示方式">
                            {WORLD_DISPLAY_OPTIONS.map(option => {
                                const active = displayMode === option.key
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={active}
                                        className={`mobile-home-filter__row${active ? ' is-active' : ''}`}
                                        onClick={() => setDisplayMode(option.key)}
                                    >
                                        <span className="mobile-home-filter__check" aria-hidden="true">
                                            {active ? <FilterCheckIcon/> : null}
                                        </span>
                                        <span className="mobile-home-filter__icon" aria-hidden="true">
                                            {renderDisplayIcon(option.key)}
                                        </span>
                                        <span className="mobile-home-filter__text">
                                            <span>{option.label}</span>
                                            <small>{option.desc}</small>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                        <div className="mobile-home-filter__divider" role="separator"/>
                        <div className="mobile-home-filter__group" aria-label="排序方式">
                            {WORLD_SORT_OPTIONS.map(option => {
                                const active = sortMode === option.key
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={active}
                                        className={`mobile-home-filter__row${active ? ' is-active' : ''}`}
                                        onClick={() => setSortMode(option.key)}
                                    >
                                        <span className="mobile-home-filter__check" aria-hidden="true">
                                            {active ? <FilterCheckIcon/> : null}
                                        </span>
                                        <span className="mobile-home-filter__icon mobile-home-filter__icon--empty" aria-hidden="true"/>
                                        <span className="mobile-home-filter__text">
                                            <span>{option.label}</span>
                                            <small>{WORLD_SORT_DETAILS[option.key]}</small>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                        <div className="mobile-home-filter__divider" role="separator"/>
                        <div className="mobile-home-filter__group" aria-label="列表操作">
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-home-filter__row"
                                disabled={importing}
                                onClick={() => {
                                    setFilterOpen(false)
                                    void handleImportProject()
                                }}
                            >
                                <span className="mobile-home-filter__check" aria-hidden="true"/>
                                <span className="mobile-home-filter__icon" aria-hidden="true">
                                    <FilterImportIcon/>
                                </span>
                                <span className="mobile-home-filter__text">
                                    <span>{importing ? '导入中…' : '导入世界'}</span>
                                    <small>从 .fcworld 文件导入</small>
                                </span>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-home-filter__row"
                                disabled={loading}
                                onClick={() => {
                                    setFilterOpen(false)
                                    void refreshProjects()
                                }}
                            >
                                <span className="mobile-home-filter__check" aria-hidden="true"/>
                                <span className="mobile-home-filter__icon" aria-hidden="true">
                                    <FilterRefreshIcon/>
                                </span>
                                <span className="mobile-home-filter__text">
                                    <span>刷新列表</span>
                                    <small>重新同步世界观</small>
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
