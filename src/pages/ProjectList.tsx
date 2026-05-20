import {type CSSProperties, memo, useCallback, useEffect, useMemo, useState} from 'react'
import {convertFileSrc} from '@tauri-apps/api/core'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {Button, Card, Input, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    db_get_entry,
    db_get_project,
    db_import_project_fcworld,
    db_list_projects,
    db_preview_project_fcworld,
    type FcworldImportPreview,
    type FcworldImportResult,
    type Project,
} from '../api'
import ProjectCreator from '../features/projects/components/ProjectCreator'
import FcworldProgressDialog from '../features/projects/components/FcworldProgressDialog'
import ProjectImportConflictDialog from '../features/projects/components/ProjectImportConflictDialog'
import {useFcworldProgress} from '../features/projects/hooks/useFcworldProgress'
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
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const [hasLoadedProjects, setHasLoadedProjects] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)
    const [dashboard, setDashboard] = useState<HomeDashboardData>(() => loadHomeDashboardData())
    const [validEntryTargetKeys, setValidEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const [invalidHomeTargetKeys, setInvalidHomeTargetKeys] = useState<Set<string>>(() => new Set())
    const [pendingEntryTargetKeys, setPendingEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()

    const loadProjects = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const nextProjects = await db_list_projects()
            setProjects(nextProjects)
        } catch (e) {
            setError(String(e))
        } finally {
            setLoading(false)
            setHasLoadedProjects(true)
        }
    }, [])

    useEffect(() => {
        void loadProjects()
    }, [loadProjects])

    useEffect(() => {
        const handler = () => void loadProjects()
        window.addEventListener('fc:project-list-changed', handler)
        return () => window.removeEventListener('fc:project-list-changed', handler)
    }, [loadProjects])

    useEffect(() => {
        const refreshDashboard = () => setDashboard(loadHomeDashboardData())
        window.addEventListener(HOME_ACTIVITY_CHANGED_EVENT, refreshDashboard)
        window.addEventListener('storage', refreshDashboard)
        return () => {
            window.removeEventListener(HOME_ACTIVITY_CHANGED_EVENT, refreshDashboard)
            window.removeEventListener('storage', refreshDashboard)
        }
    }, [])

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

    const query = searchText.trim().toLowerCase()
    const filteredProjects = projects
        .filter(project => {
            if (!query) return true
            const name = project.name.toLowerCase()
            const description = (project.description ?? '').toLowerCase()
            return name.includes(query) || description.includes(query)
        })
        .sort((a, b) => {
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
    const projectCountLabel = hasLoadedProjects ? projects.length : '-'
    const filteredProjectCountLabel = hasLoadedProjects ? filteredProjects.length : '-'
    const quickActions = useMemo<Array<{
        key: string
        title: string
        description: string
        target?: HomeActivityTarget
        onClick?: () => void
    }>>(() => [
        {
            key: 'new-world',
            title: '开始一个新世界',
            description: '创建新的世界观项目。',
            onClick: () => setCreatorOpen(true),
        },
        {
            key: 'idea',
            title: '记录灵感',
            description: '先把想法放进灵感收件箱。',
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
            description: '让 AI 帮你整理设定、扩写片段或检查问题。',
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
            description: '回看最近保存的版本和分支。',
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
                onOpenProject?.(project)
                return
            }
        }
        void onOpenHomeTarget?.(target)
    }, [hasLoadedProjects, onOpenHomeTarget, onOpenProject, projectIdSet, projects, showAlert])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        window.dispatchEvent(new CustomEvent('fc:project-list-changed'))
        const importedProject = await db_get_project(result.projectId)
        onOpenProject?.(importedProject)
    }, [onOpenProject])

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
        } catch (error) {
            closeProgress()
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'toast', 3600)
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
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'toast', 3600)
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
            await showAlert(`导入世界失败：${String(error)}`, 'error', 'toast', 3600)
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
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={() => void loadProjects()}
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
            <FcworldProgressDialog progress={fcworldProgress} />
            <RollingBox axis="y" style={{padding: '0.35rem'} as CSSProperties} thumbSize="thin">
                <div className="project-list-page fc-page-shell">
                    <section className="project-home-hero">
                        <div className="project-home-hero__main">
                            <div className="project-list-title-block fc-page-title-block">
                                <h1 className="project-list-title fc-page-title">创作首页</h1>
                                <p className="project-list-subtitle fc-page-subtitle">
                                    回到正在构建的世界，继续整理角色、地点和灵感。
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="project-home-panel project-home-panel--quick">
                        <h2>快速开始</h2>
                        <button
                            type="button"
                            className="project-home-continue-card"
                            onClick={() => {
                                if (continueItem) {
                                    openDashboardTarget(continueItem)
                                    return
                                }
                                setCreatorOpen(true)
                            }}
                        >
                            {continueItem ? (
                                <>
                                    <span className="project-home-eyebrow">继续创作</span>
                                    <div className="project-home-continue-card__topline">
                                        <span className="project-home-continue-card__title">{continueItem.title}</span>
                                    </div>
                                    <p>
                                        {continueItem.subtitle || getTargetTypeLabel(continueItem.type)}
                                        {dashboard.lastSession?.savedAt ? ` · ${formatRelativeTime(dashboard.lastSession.savedAt)}` : ''}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <span className="project-home-eyebrow">开始创作</span>
                                    <div className="project-home-continue-card__topline">
                                        <span className="project-home-continue-card__title">给新的世界一个起点</span>
                                    </div>
                                    <p>创建世界观后，最近编辑、上次打开和常用内容会出现在这里。</p>
                                </>
                            )}
                        </button>
                        <div className="project-home-action-list">
                            {quickActions.map(action => (
                                <button
                                    key={action.key}
                                    type="button"
                                    className="project-home-action-item"
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
                                    <span>{action.title}</span>
                                    <small>{action.description}</small>
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
                                    onClick={loadProjects}
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

                                        return (
                                            <div
                                                key={project.id}
                                                style={{cursor: onOpenProject ? 'pointer' : undefined}}
                                                onClick={() => onOpenProject?.(project)}
                                            >
                                                <Card
                                                    className="project-list-card"
                                                    image={image}
                                                    imageSlot={!image ? (
                                                        <div className="project-list-placeholder">
                                                        </div>
                                                    ) : undefined}
                                                    title={project.name}
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
