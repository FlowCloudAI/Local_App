import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {useDrag, useWheel} from '@use-gesture/react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {
    db_count_entries,
    db_get_entry,
    db_get_project,
    formatApiError,
    type FcworldImportResult,
    type Project,
    toApiError,
} from '../../../api'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
import ProjectImportConflictDialog from '../../../features/projects/components/ProjectImportConflictDialog'
import ProjectDefaultCover from '../../../features/projects/ProjectDefaultCover'
import {useProjectImportController} from '../../../features/projects/hooks/useProjectImportController'
import {invalidateProjectList, useProjectListStore} from '../../../features/projects/projectListStore'
import {
    getHomeActivityTargetKey,
    getHomeTargetEntryId,
    getHomeTargetProjectId,
    isHomeProjectBackedTarget,
    removeHomeActivityTarget,
    removeHomeEntryActivity,
    removeHomeProjectActivity,
    type HomeActivityRecord,
    type HomeActivityTarget,
    useHomeDashboard,
} from '../../../features/home/homeActivity'
import {type MobilePage} from '../usePageStack'
import {type MobileBeforeLeave} from '../mobileBackNavigation'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {
    MobileAddIcon,
    MobileAnchoredMenu,
    MobileMoreIcon,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {formatProjectDate, parseProjectDateMs, toProjectImageSrc} from '../../../features/projects/projectDisplay'
import {
    collectDashboardTargets,
    FilterCheckIcon,
    FilterImportIcon,
    FilterRefreshIcon,
    formatRelativeTime,
    getTargetTypeLabel,
    MobileHomeContinueCard,
    PANEL_SWITCH_THRESHOLD,
    renderDisplayIcon,
    WORLD_DISPLAY_OPTIONS,
    WORLD_SORT_DETAILS,
    WORLD_SORT_OPTIONS,
    type WorldDisplayMode,
    type WorldSortMode,
} from './MobileHomeUi'
import './MobileHome.css'

interface Props {
    push: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    activePanel: MobileHomePanel
    onActivePanelChange: (panel: MobileHomePanel) => void
}

export type MobileHomePanel = 'dashboard' | 'worlds'

export default function MobileHome({
    push,
    navigateToTab,
    setAiFocus,
    setBeforeLeave,
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
    const homeRef = useRef<HTMLDivElement | null>(null)
    const worldPanelRef = useRef<HTMLElement | null>(null)
    const worldActionsRef = useRef<HTMLDivElement | null>(null)
    const touchWorldScrollTopRef = useRef(0)

    const dashboard = useHomeDashboard()
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

    useEffect(() => {
        if (!filterOpen) return undefined
        setBeforeLeave((intent) => {
            // 返回键收起筛选菜单并留在原地；切 Tab 时本页会整体卸载，不拦。
            if (intent !== 'back') return true
            setFilterOpen(false)
            return false
        })
        return () => setBeforeLeave(null)
    }, [filterOpen, setBeforeLeave])

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
                if (!cancelled) setCountsError(formatApiError(toApiError(e)))
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
            const projectId = getHomeTargetProjectId(target)

            if (isHomeProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
                invalidKeys.add(key)
                if (projectId) {
                    missingProjectIds.add(projectId)
                } else {
                    removeHomeActivityTarget(target)
                }
                continue
            }

            if (target.type === 'entry') {
                const entryId = getHomeTargetEntryId(target)
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
                    const entry = await db_get_entry(item.entryId, item.projectId)
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

        if (hasLoadedProjects && isHomeProjectBackedTarget(target)) {
            const projectId = getHomeTargetProjectId(target)
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
                        return parseProjectDateMs(b.created_at) - parseProjectDateMs(a.created_at) || nameOrder
                    case 'name-asc':
                        return nameOrder
                    case 'size-desc':
                        return (entryCounts[b.id] ?? 0) - (entryCounts[a.id] ?? 0) || nameOrder
                    case 'updated-desc':
                    default:
                        return parseProjectDateMs(b.updated_at ?? b.created_at) - parseProjectDateMs(a.updated_at ?? a.created_at) || nameOrder
                }
            })
    }, [entryCounts, projects, searchText, sortMode])

    const loadingWorlds = loading && projects.length === 0
    const worldError = error ?? countsError
    const retryWorlds = useCallback(() => {
        void refreshProjects()
    }, [refreshProjects])

    const handleOpenProject = useCallback((project: Project) => {
        setAiFocus({projectId: project.id, entryId: null})
        push({type: 'projectHome', params: {projectId: project.id, displayName: project.name}})
    }, [push, setAiFocus])

    const openDashboardTarget = useCallback((target: HomeActivityTarget) => {
        const projectId = getHomeTargetProjectId(target)
        if (hasLoadedProjects && isHomeProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
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
            const targetProjectId = getHomeTargetProjectId(target)
            const targetEntryId = getHomeTargetEntryId(target)
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

    const handleImportError = useCallback(
        (error: unknown) => showAlert(`导入世界失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3200),
        [showAlert],
    )
    const {
        importing,
        conflict: importConflict,
        progress: fcworldProgress,
        selectAndImport: handleImportProject,
        rename: handleImportConflictRename,
        overwrite: importConflictOverwrite,
        cancelConflict: handleImportConflictCancel,
    } = useProjectImportController({onImported: openImportedProject, onError: handleImportError})

    const handleImportConflictOverwrite = useCallback(async () => {
        if (!importConflict?.duplicateProject || importing) return
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return
        await importConflictOverwrite()
    }, [importConflict, importConflictOverwrite, importing, showAlert])

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
        const meta = `${entryCounts[project.id] ?? 0} 词条 · 更新于 ${formatProjectDate(project.updated_at ?? project.created_at)}`
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
                className="mobile-page__card mobile-project-card mobile-home-world-card"
                title={project.name}
                description={project.description || '你的世界在等你回来，继续补全新的角色、地点和事件。'}
                image={image}
                imageSlot={!image ? (
                    <ProjectDefaultCover
                        projectId={project.id}
                        projectName={project.name}
                    />
                ) : undefined}
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
                            <h2 className="mobile-page__hero-title">首页</h2>
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
                        className="mobile-page__search mobile-home__search"
                        radius="full"
                        size="lg"
                        allowClear
                    />

                    <section className="mobile-home__section">
                        <div className="mobile-home__section-head">
                            <h3 className="mobile-home__section-title">继续创作</h3>
                        </div>
                        <MobileHomeContinueCard
                            continueItem={continueItem}
                            lastSavedAt={dashboard.lastSession?.savedAt}
                            hasLoadedProjects={hasLoadedProjects}
                            projectError={error}
                            projectCount={projects.length}
                            onOpenTarget={openDashboardTarget}
                            onOpenWorlds={() => onActivePanelChange('worlds')}
                            onCreateWorld={() => setCreatorOpen(true)}
                            onRetry={retryWorlds}
                        />
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
                            <span className="mobile-page__eyebrow">
                                {loadingWorlds ? '正在同步' : `${worldProjects.length} 个世界`}
                            </span>
                            <h2 className="mobile-page__hero-title">世界观</h2>
                        </div>
                        <MobileTopActionPill
                            ref={worldActionsRef}
                            actions={[
                                {
                                    key: 'create',
                                    label: '新建世界观',
                                    icon: <MobileAddIcon/>,
                                    kind: 'add',
                                    onClick: () => setCreatorOpen(true),
                                },
                                {
                                    key: 'filter',
                                    label: '筛选与排序',
                                    icon: <MobileMoreIcon/>,
                                    kind: 'more',
                                    ariaHasPopup: 'menu',
                                    ariaExpanded: filterOpen,
                                    onClick: () => setFilterOpen(open => !open),
                                },
                            ]}
                        />
                    </div>

                    <Input
                        placeholder="搜索世界观…"
                        value={searchText}
                        onValueChange={setSearchText}
                        className="mobile-page__search mobile-home-worlds__search"
                        radius="full"
                        size="lg"
                        allowClear
                    />

                    {worldError && projects.length === 0 ? (
                        <div className="mobile-page__error" role="alert">
                            <span>加载失败：{worldError}</span>
                            <Button type="button" size="sm" variant="outline" onClick={retryWorlds}>重试</Button>
                        </div>
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
                        <>
                            {worldError && (
                                <div className="mobile-page__error-banner" role="alert">
                                    <span>部分世界信息刷新失败：{worldError}</span>
                                    <Button type="button" size="sm" variant="outline" onClick={retryWorlds}>重试</Button>
                                </div>
                            )}
                            <div className={`mobile-home-worlds__grid mobile-home-worlds__grid--${displayMode}`}>
                                {worldProjects.map(renderWorldCard)}
                            </div>
                        </>
                    )}
                </section>
            </div>

            <MobileAnchoredMenu
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                anchorRef={worldActionsRef}
                containerRef={homeRef}
                ariaLabel="世界观筛选与排序"
            >
                        <div className="mobile-anchored-menu__group" aria-label="显示方式">
                            {WORLD_DISPLAY_OPTIONS.map(option => {
                                const active = displayMode === option.key
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={active}
                                        className={`mobile-anchored-menu__row${active ? ' is-active' : ''}`}
                                        onClick={() => setDisplayMode(option.key)}
                                    >
                                        <span className="mobile-anchored-menu__check" aria-hidden="true">
                                            {active ? <FilterCheckIcon/> : null}
                                        </span>
                                        <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                            {renderDisplayIcon(option.key)}
                                        </span>
                                        <span className="mobile-anchored-menu__text">
                                            <span>{option.label}</span>
                                            <small>{option.desc}</small>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                        <div className="mobile-home-filter__divider" role="separator"/>
                        <div className="mobile-anchored-menu__group" aria-label="排序方式">
                            {WORLD_SORT_OPTIONS.map(option => {
                                const active = sortMode === option.key
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={active}
                                        className={`mobile-anchored-menu__row${active ? ' is-active' : ''}`}
                                        onClick={() => setSortMode(option.key)}
                                    >
                                        <span className="mobile-anchored-menu__check" aria-hidden="true">
                                            {active ? <FilterCheckIcon/> : null}
                                        </span>
                                        <span className="mobile-anchored-menu__icon" aria-hidden="true"/>
                                        <span className="mobile-anchored-menu__text">
                                            <span>{option.label}</span>
                                            <small>{WORLD_SORT_DETAILS[option.key]}</small>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                        <div className="mobile-home-filter__divider" role="separator"/>
                        <div className="mobile-anchored-menu__group" aria-label="列表操作">
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-anchored-menu__row"
                                disabled={importing}
                                onClick={() => {
                                    setFilterOpen(false)
                                    void handleImportProject()
                                }}
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                    <FilterImportIcon/>
                                </span>
                                <span className="mobile-anchored-menu__text">
                                    <span>{importing ? '导入中…' : '导入世界'}</span>
                                    <small>从 .fcworld 文件导入</small>
                                </span>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-anchored-menu__row"
                                disabled={loading}
                                onClick={() => {
                                    setFilterOpen(false)
                                    void refreshProjects()
                                }}
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                    <FilterRefreshIcon/>
                                </span>
                                <span className="mobile-anchored-menu__text">
                                    <span>刷新列表</span>
                                    <small>重新同步世界观</small>
                                </span>
                            </button>
                        </div>
            </MobileAnchoredMenu>
        </div>
    )
}
