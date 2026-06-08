import {
    type TouchEvent as ReactTouchEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type WheelEvent as ReactWheelEvent,
} from 'react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
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
import {FloatingPanel} from '../../../shared/ui/overlay'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import './MobileHome.css'

interface Props {
    push: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
}

type WorldSortMode = 'updated-desc' | 'created-desc' | 'name-asc' | 'size-desc'
type WorldDisplayMode = 'card' | 'list' | 'compact'
type HomePanel = 'dashboard' | 'worlds'

const PANEL_SWITCH_THRESHOLD = 72

const WORLD_DISPLAY_OPTIONS: Array<{key: WorldDisplayMode; label: string; desc: string}> = [
    {key: 'card', label: '卡片', desc: '两列封面卡片'},
    {key: 'list', label: '列表', desc: '更适合扫标题'},
    {key: 'compact', label: '紧凑', desc: '提高屏幕容量'},
]

const WORLD_SORT_OPTIONS: Array<{key: WorldSortMode; label: string}> = [
    {key: 'updated-desc', label: '更新日期'},
    {key: 'created-desc', label: '创建日期'},
    {key: 'name-asc', label: '名称排序'},
    {key: 'size-desc', label: '项目体量'},
]

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

export default function MobileHome({push, navigateToTab, setAiFocus}: Props) {
    const {showAlert} = useAlert()
    const {
        projects,
        loading,
        error,
        hasLoaded: hasLoadedProjects,
        refresh: refreshProjects,
    } = useProjectListStore()
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const worldPanelRef = useRef<HTMLElement | null>(null)
    const touchStartYRef = useRef<number | null>(null)
    const touchWorldScrollTopRef = useRef(0)

    const [activePanel, setActivePanel] = useState<HomePanel>('dashboard')
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
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importing, setImporting] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)

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
            void showAlert('这个首页入口指向的内容已不存在，已从首页移除。', 'warning', 'toast', 3000)
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
                void showAlert('移动端暂未单独打开该工具面板，已进入对应世界。', 'info', 'toast', 2200)
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

        void showAlert(target.description || '该入口暂未接入移动端。', 'info', 'toast', 2600)
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
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
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
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
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
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const handleHelp = useCallback(() => {
        void showAlert('首页展示桌面端同一套继续创作和最近内容；向上滑动即可进入世界观列表。', 'info', 'toast', 2800)
    }, [showAlert])

    const handlePagerTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        touchStartYRef.current = event.touches[0]?.clientY ?? null
        touchWorldScrollTopRef.current = worldPanelRef.current?.scrollTop ?? 0
    }, [])

    const handlePagerTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        const startY = touchStartYRef.current
        touchStartYRef.current = null
        if (startY == null) return

        const endY = event.changedTouches[0]?.clientY ?? startY
        const deltaY = endY - startY
        if (Math.abs(deltaY) < PANEL_SWITCH_THRESHOLD) return

        if (activePanel === 'dashboard' && deltaY < 0) {
            setActivePanel('worlds')
            return
        }

        if (activePanel === 'worlds' && deltaY > 0 && touchWorldScrollTopRef.current <= 4) {
            setActivePanel('dashboard')
        }
    }, [activePanel])

    const handlePagerWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (Math.abs(event.deltaY) < 32) return
        if (activePanel === 'dashboard' && event.deltaY > 0) {
            setActivePanel('worlds')
            return
        }
        if (activePanel === 'worlds' && event.deltaY < 0 && (worldPanelRef.current?.scrollTop ?? 0) <= 4) {
            setActivePanel('dashboard')
        }
    }, [activePanel])

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
                imageHeight={displayMode === 'compact' ? '5.5rem' : '8.5rem'}
                extraInfo={<span className="mobile-project-card__meta">{meta}</span>}
                variant="shadow"
                hoverable
                onClick={() => handleOpenProject(project)}
            />
        )
    }

    return (
        <div
            className={`mobile-page mobile-home mobile-home--${activePanel}`}
            onTouchStart={handlePagerTouchStart}
            onTouchEnd={handlePagerTouchEnd}
            onWheel={handlePagerWheel}
        >
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={handleOpenProject}
                existingNames={projects.map(project => project.name)}
                backdropClassName="project-creator-backdrop--no-blur"
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
                        <div className="mobile-home-worlds__actions">
                            <button
                                type="button"
                                className="mobile-home-worlds__icon-btn"
                                aria-label="新建世界观"
                                onClick={() => setCreatorOpen(true)}
                            >
                                +
                            </button>
                            <button
                                type="button"
                                className="mobile-home-worlds__filter"
                                aria-label="筛选与排序"
                                onClick={() => setFilterOpen(true)}
                            >
                                筛选
                            </button>
                        </div>
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

            <FloatingPanel
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                ariaLabel="世界观筛选与排序"
                className="mobile-home-filter"
            >
                <div className="mobile-home-filter__section">
                    <div className="mobile-home-filter__title">显示模式</div>
                    <div className="mobile-home-filter__options">
                        {WORLD_DISPLAY_OPTIONS.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                className={`mobile-home-filter__option${displayMode === option.key ? ' is-active' : ''}`}
                                onClick={() => setDisplayMode(option.key)}
                            >
                                <span>{option.label}</span>
                                <small>{option.desc}</small>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mobile-home-filter__section">
                    <div className="mobile-home-filter__title">排序方法</div>
                    <div className="mobile-home-filter__options">
                        {WORLD_SORT_OPTIONS.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                className={`mobile-home-filter__option${sortMode === option.key ? ' is-active' : ''}`}
                                onClick={() => setSortMode(option.key)}
                            >
                                <span>{option.label}</span>
                            </button>
                        ))}
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={importing}
                        className="mobile-home-filter__import"
                        onClick={() => void handleImportProject()}
                    >
                        {importing ? '导入中…' : '导入世界'}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={loading}
                        className="mobile-home-filter__import"
                        onClick={() => void refreshProjects()}
                    >
                        刷新列表
                    </Button>
                </div>
            </FloatingPanel>
        </div>
    )
}
