import {Button, Select, useAlert} from 'flowcloudai-ui'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    type Category,
    db_create_entry,
    db_create_idea_note,
    db_delete_idea_note,
    db_get_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_list_idea_notes,
    db_list_projects,
    db_update_idea_note,
    entryTypeKey,
    type EntryTypeView,
    type IdeaNote,
    type IdeaNoteStatus,
    type Project,
    setting_get_settings,
} from '../api'
import './Idea.css'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type IdeaViewMode = 'inbox' | 'all' | 'processed' | 'archived'
type ProjectFilterMode = 'all' | 'global' | string

interface IdeaProps {
    contextProjectId?: string | null
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    panelMode?: 'floating' | 'fullscreen'
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
}

const IDEA_LIST_LIMIT = 100
const AUTOSAVE_DELAY = 700
const PREVIEW_LENGTH = 28

const IDEA_VIEW_OPTIONS: Array<{ key: IdeaViewMode; label: string; status?: IdeaNoteStatus }> = [
    {key: 'all', label: '全部'},
    {key: 'inbox', label: '待整理', status: 'inbox'},
    {key: 'processed', label: '已处理', status: 'processed'},
    {key: 'archived', label: '已归档', status: 'archived'},
]

const IDEA_STATUS_OPTIONS: Array<{ key: IdeaNoteStatus; label: string }> = [
    {key: 'inbox', label: '待整理'},
    {key: 'processed', label: '已处理'},
    {key: 'archived', label: '已归档'},
]

function sortIdeaNotes(notes: IdeaNote[]) {
    return [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
}

function buildIdeaPreview(note: Pick<IdeaNote, 'title' | 'content'>) {
    const source = note.title?.trim() || note.content.trim()
    if (!source) return '未命名便签'
    return source.length > PREVIEW_LENGTH ? `${source.slice(0, PREVIEW_LENGTH)}…` : source
}

function getIdeaStatusLabel(status: IdeaNoteStatus) {
    if (status === 'processed') return '已处理'
    if (status === 'archived') return '已归档'
    return '待整理'
}

function formatIdeaTime(value?: string | null) {
    if (!value) return ''

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)
}

function buildEntryTitleFromIdea(title: string, content: string) {
    const trimmedTitle = title.trim()
    if (trimmedTitle) return trimmedTitle.slice(0, 160)

    const firstLine = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)

    return firstLine ? firstLine.slice(0, 160) : ''
}

export default function Idea({
                                 contextProjectId = null,
                                 onOpenEntry,
                                 panelMode,
                                 onTogglePanelMode,
                                 onToggleCollapsed
                             }: IdeaProps) {
    const {showAlert} = useAlert()
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const createRequestIdRef = useRef(0)
    const layoutRef = useRef<HTMLDivElement | null>(null)
    const selectedIdeaIdRef = useRef<string | null>(null)

    const [ideaNotes, setIdeaNotes] = useState<IdeaNote[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [draftProjectId, setDraftProjectId] = useState<string | null>(contextProjectId)
    const [defaultEntryType, setDefaultEntryType] = useState<string | null>(null)
    const [convertCategoryId, setConvertCategoryId] = useState<string | null>(null)
    const [convertEntryType, setConvertEntryType] = useState<string | null>(null)
    const [openAfterConvert, setOpenAfterConvert] = useState(true)
    const [converting, setConverting] = useState(false)
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saveState, setSaveState] = useState<SaveState>('idle')
    const [statusMessage, setStatusMessage] = useState('输入内容后会自动保存')
    const [viewMode, setViewMode] = useState<IdeaViewMode>('all')
    const [projectFilter, setProjectFilter] = useState<ProjectFilterMode>('all')
    const [compactLayout, setCompactLayout] = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    const selectedIdea = useMemo(
        () => ideaNotes.find((item) => item.id === selectedIdeaId) ?? null,
        [ideaNotes, selectedIdeaId],
    )
    const selectedIdeaProjectId = selectedIdea?.project_id ?? null

    useEffect(() => {
        selectedIdeaIdRef.current = selectedIdeaId
    }, [selectedIdeaId])

    const projectFilterOptions = useMemo(() => ([
        {value: 'all', label: '全部项目'},
        {value: 'global', label: '未归属'},
        ...projects.map((project) => ({value: project.id, label: project.name})),
    ]), [projects])

    const ideaProjectOptions = useMemo(() => ([
        {value: 'global', label: '未归属'},
        ...projects.map((project) => ({value: project.id, label: project.name})),
    ]), [projects])

    const categoryOptions = useMemo(() => ([
        {value: 'root', label: '项目根目录'},
        ...categories.map((category) => ({value: category.id, label: category.name})),
    ]), [categories])

    const entryTypeOptions = useMemo(() => ([
        {value: '', label: '不设置'},
        ...entryTypes.map((entryType) => ({
            value: entryTypeKey(entryType),
            label: entryType.name,
        })),
    ]), [entryTypes])

    const syncDraftFromIdea = useCallback((idea: IdeaNote | null) => {
        setDraftTitle(idea?.title ?? '')
        setDraftContent(idea?.content ?? '')
        setDraftProjectId(idea?.project_id ?? contextProjectId ?? null)
        setSaveState('idle')
        setStatusMessage('输入内容后会自动保存')
    }, [contextProjectId])

    const buildIdeaListParams = useCallback(() => {
        const activeView = IDEA_VIEW_OPTIONS.find((item) => item.key === viewMode)
        const params: {
            limit: number
            offset: number
            status?: IdeaNoteStatus
            projectId?: string
            onlyGlobal?: boolean
        } = {
            limit: IDEA_LIST_LIMIT,
            offset: 0,
        }

        if (activeView?.status) {
            params.status = activeView.status
        }

        if (projectFilter === 'global') {
            params.onlyGlobal = true
        } else if (projectFilter !== 'all') {
            params.projectId = projectFilter
        }

        return params
    }, [projectFilter, viewMode])

    const matchesCurrentFilters = useCallback((idea: IdeaNote) => {
        const currentParams = buildIdeaListParams()

        if (currentParams.status && idea.status !== currentParams.status) {
            return false
        }

        if (currentParams.onlyGlobal) {
            return !idea.project_id
        }

        if (currentParams.projectId) {
            return idea.project_id === currentParams.projectId
        }

        return true
    }, [buildIdeaListParams])

    const loadIdeaNotes = useCallback(async (preferredIdeaId?: string | null) => {
        setLoading(true)
        try {
            const list = sortIdeaNotes(await db_list_idea_notes(buildIdeaListParams()))
            const nextSelectedIdeaId = (() => {
                const targetId = preferredIdeaId ?? selectedIdeaIdRef.current
                if (targetId && list.some((item) => item.id === targetId)) return targetId
                return null
            })()

            setIdeaNotes(list)
            setSelectedIdeaId(nextSelectedIdeaId)

            if (!nextSelectedIdeaId) {
                syncDraftFromIdea(null)
            }

            setStatusMessage(
                nextSelectedIdeaId
                    ? '输入内容后会自动保存'
                    : '空白便签，开始输入后会自动创建',
            )
        } catch (error) {
            console.error('加载灵感便签失败', error)
            setStatusMessage(error instanceof Error ? error.message : '加载灵感便签失败')
            setSaveState('error')
        } finally {
            setLoading(false)
            setInitialized(true)
        }
    }, [buildIdeaListParams, syncDraftFromIdea])

    const loadProjects = useCallback(async () => {
        try {
            setProjects(await db_list_projects())
        } catch (error) {
            console.error('加载项目列表失败', error)
        }
    }, [])

    const loadIdeaConversionSettings = useCallback(async () => {
        try {
            const settings = await setting_get_settings()
            setDefaultEntryType(settings.default_entry_type ?? null)
        } catch (error) {
            console.error('加载默认词条类型失败', error)
        }
    }, [])

    useEffect(() => {
        void loadIdeaNotes()
    }, [loadIdeaNotes])

    useEffect(() => {
        void loadProjects()
    }, [loadProjects])

    useEffect(() => {
        void loadIdeaConversionSettings()
    }, [loadIdeaConversionSettings])

    useEffect(() => {
        syncDraftFromIdea(selectedIdea)
    }, [selectedIdea, syncDraftFromIdea])

    useEffect(() => {
        if (selectedIdea) return
        setDraftProjectId(contextProjectId ?? null)
    }, [contextProjectId, selectedIdea])

    useEffect(() => {
        if (!initialized) return

        const timer = window.setTimeout(() => {
            textareaRef.current?.focus()
        }, 0)

        return () => window.clearTimeout(timer)
    }, [initialized, selectedIdeaId])

    useEffect(() => {
        setOpenAfterConvert(true)

        if (!selectedIdeaId || !selectedIdeaProjectId) {
            setCategories([])
            setEntryTypes([])
            setConvertCategoryId(null)
            setConvertEntryType(null)
            return
        }

        let cancelled = false

        void (async () => {
            try {
                const [nextCategories, nextEntryTypes] = await Promise.all([
                    db_list_categories(selectedIdeaProjectId),
                    db_list_all_entry_types(selectedIdeaProjectId),
                ])

                if (cancelled) return

                setCategories(nextCategories)
                setEntryTypes(nextEntryTypes)
                setConvertCategoryId(null)

                const preferredEntryType = defaultEntryType && nextEntryTypes.some((item) => entryTypeKey(item) === defaultEntryType)
                    ? defaultEntryType
                    : null
                setConvertEntryType(preferredEntryType)
            } catch (error) {
                if (cancelled) return
                console.error('加载转词条配置失败', error)
                setCategories([])
                setEntryTypes([])
                setConvertCategoryId(null)
                setConvertEntryType(null)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [defaultEntryType, selectedIdeaId, selectedIdeaProjectId])

    useEffect(() => {
        const element = layoutRef.current
        if (!element || typeof ResizeObserver === 'undefined') return

        const updateFromWidth = (width: number) => {
            const isCompact = width <= 960
            setCompactLayout(isCompact)
            setSidebarCollapsed(isCompact)
        }

        // 同步获取初始宽度，避免先展开再收起的闪烁/动画
        const rect = element.getBoundingClientRect()
        updateFromWidth(rect.width)

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            updateFromWidth(entry.contentRect.width)
        })

        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!initialized || loading) return

        const trimmedContent = draftContent.trim()
        const sourceIdea = selectedIdea

        if (!sourceIdea && trimmedContent.length === 0) {
            setSaveState('idle')
            setStatusMessage('输入内容后会自动创建便签')
            return
        }

        if (sourceIdea) {
            const currentTitle = sourceIdea.title ?? ''
            const currentContent = sourceIdea.content
            const currentProjectId = sourceIdea.project_id ?? null
            if (currentTitle === draftTitle && currentContent === draftContent && currentProjectId === draftProjectId) {
                setSaveState('saved')
                setStatusMessage(sourceIdea.updated_at ? `已保存于 ${formatIdeaTime(sourceIdea.updated_at)}` : '已保存')
                return
            }
        }

        setSaveState('saving')
        setStatusMessage(sourceIdea ? '正在自动保存…' : '正在创建便签…')

        const timer = window.setTimeout(() => {
            if (sourceIdea) {
                void (async () => {
                    try {
                        const currentProjectId = sourceIdea.project_id ?? null
                        const updated = await db_update_idea_note({
                            id: sourceIdea.id,
                            projectId: currentProjectId === draftProjectId ? undefined : draftProjectId,
                            title: draftTitle.trim() ? draftTitle : null,
                            content: draftContent,
                        })
                        setIdeaNotes((prev) => sortIdeaNotes(prev.map((item) => item.id === updated.id ? updated : item)))
                        setSaveState('saved')
                        setStatusMessage(`已保存于 ${formatIdeaTime(updated.updated_at)}`)
                    } catch (error) {
                        console.error('更新灵感便签失败', error)
                        setSaveState('error')
                        setStatusMessage(error instanceof Error ? error.message : '自动保存失败')
                    }
                })()
                return
            }

            const requestId = createRequestIdRef.current + 1
            createRequestIdRef.current = requestId

            void (async () => {
                try {
                    const createdIdea = await db_create_idea_note({
                        projectId: draftProjectId,
                        title: draftTitle.trim() ? draftTitle : null,
                        content: draftContent,
                    })

                    const targetStatus = IDEA_VIEW_OPTIONS.find((item) => item.key === viewMode)?.status
                    const created = targetStatus && targetStatus !== createdIdea.status
                        ? await db_update_idea_note({
                            id: createdIdea.id,
                            status: targetStatus,
                        })
                        : createdIdea

                    if (createRequestIdRef.current !== requestId) return

                    setSelectedIdeaId(created.id)
                    setSaveState('saved')
                    setStatusMessage(`已创建并保存于 ${formatIdeaTime(created.updated_at)}`)

                    if (matchesCurrentFilters(created)) {
                        setIdeaNotes((prev) => sortIdeaNotes([created, ...prev.filter((item) => item.id !== created.id)]))
                    } else {
                        await loadIdeaNotes(created.id)
                    }
                } catch (error) {
                    console.error('创建灵感便签失败', error)
                    setSaveState('error')
                    setStatusMessage(error instanceof Error ? error.message : '创建便签失败')
                }
            })()
        }, AUTOSAVE_DELAY)

        return () => window.clearTimeout(timer)
    }, [draftContent, draftProjectId, draftTitle, initialized, loadIdeaNotes, loading, matchesCurrentFilters, selectedIdea, viewMode])

    const handleSelectIdea = useCallback((ideaId: string) => {
        setSelectedIdeaId(ideaId)
        if (compactLayout) {
            setSidebarCollapsed(true)
        }
    }, [compactLayout])

    const handleCreateBlankIdea = useCallback(() => {
        setSelectedIdeaId(null)
        syncDraftFromIdea(null)
        setStatusMessage('空白便签，开始输入后会自动创建')
        if (compactLayout) {
            setSidebarCollapsed(true)
        }
    }, [compactLayout, syncDraftFromIdea])

    const handleChangeIdeaStatus = useCallback(async (status: IdeaNoteStatus) => {
        if (!selectedIdea) return

        try {
            const updated = await db_update_idea_note({
                id: selectedIdea.id,
                status,
            })
            setStatusMessage(`状态已更新为「${getIdeaStatusLabel(updated.status)}」`)
            await loadIdeaNotes(updated.id)
        } catch (error) {
            console.error('更新便签状态失败', error)
            setSaveState('error')
            setStatusMessage(error instanceof Error ? error.message : '更新状态失败')
        }
    }, [loadIdeaNotes, selectedIdea])

    const handleTogglePinned = useCallback(async () => {
        if (!selectedIdea) return

        try {
            const updated = await db_update_idea_note({
                id: selectedIdea.id,
                pinned: !selectedIdea.pinned,
            })
            setIdeaNotes((prev) => sortIdeaNotes(prev.map((item) => item.id === updated.id ? updated : item)))
            setStatusMessage(updated.pinned ? '已置顶当前便签' : '已取消置顶')
        } catch (error) {
            console.error('更新置顶状态失败', error)
            setSaveState('error')
            setStatusMessage(error instanceof Error ? error.message : '更新置顶状态失败')
        }
    }, [selectedIdea])

    const handleProjectChange = useCallback((value: string | number | (string | number)[]) => {
        const singleValue = Array.isArray(value) ? value[0] : value
        if (singleValue === undefined) return
        const nextProjectId = singleValue === 'global' ? null : String(singleValue)

        if (!selectedIdea) {
            setDraftProjectId(nextProjectId)
            setStatusMessage(nextProjectId ? '已设置新便签的所属项目' : '已设置新便签为未归属')
            return
        }

        void (async () => {
            try {
                const updated = await db_update_idea_note({
                    id: selectedIdea.id,
                    projectId: nextProjectId,
                })
                setStatusMessage(nextProjectId ? '已更新便签所属项目' : '已将便签设为未归属')

                if (matchesCurrentFilters(updated)) {
                    setIdeaNotes((prev) => sortIdeaNotes(prev.map((item) => item.id === updated.id ? updated : item)))
                } else {
                    await loadIdeaNotes(updated.id)
                }
            } catch (error) {
                console.error('更新便签所属项目失败', error)
                setSaveState('error')
                setStatusMessage(error instanceof Error ? error.message : '更新所属项目失败')
            }
        })()
    }, [loadIdeaNotes, matchesCurrentFilters, selectedIdea])

    const handleOpenConvertedEntry = useCallback(async () => {
        if (!selectedIdea?.converted_entry_id || !selectedIdea.project_id) return

        try {
            const entry = await db_get_entry(selectedIdea.converted_entry_id)
            onOpenEntry?.(selectedIdea.project_id, {
                id: entry.id,
                title: entry.title,
            })
            setSaveState('saved')
            setStatusMessage('已打开关联词条')
        } catch (error) {
            console.error('打开关联词条失败', error)
            setSaveState('error')
            setStatusMessage(error instanceof Error ? error.message : '打开关联词条失败')
        }
    }, [onOpenEntry, selectedIdea])

    const handleConvertToEntry = useCallback(async () => {
        if (!selectedIdea) return

        if (selectedIdea.converted_entry_id) {
            await handleOpenConvertedEntry()
            return
        }

        if (!selectedIdea.project_id) {
            await showAlert('请先为这条便签选择所属项目，再转为词条。', 'warning', 'toast', 1800)
            return
        }

        const targetTitle = buildEntryTitleFromIdea(draftTitle, draftContent)
        if (!targetTitle) {
            await showAlert('便签标题和正文都为空，暂时无法转为词条。', 'warning', 'toast', 1800)
            return
        }

        setConverting(true)
        setSaveState('saving')
        setStatusMessage('正在转为词条…')

        try {
            let latestIdea = selectedIdea
            const currentProjectId = selectedIdea.project_id ?? null
            if (
                selectedIdea.title !== draftTitle
                || selectedIdea.content !== draftContent
                || currentProjectId !== draftProjectId
            ) {
                latestIdea = await db_update_idea_note({
                    id: selectedIdea.id,
                    projectId: currentProjectId === draftProjectId ? undefined : draftProjectId,
                    title: draftTitle.trim() ? draftTitle : null,
                    content: draftContent,
                })
                setIdeaNotes((prev) => sortIdeaNotes(prev.map((item) => item.id === latestIdea.id ? latestIdea : item)))
            }

            if (!latestIdea.project_id) {
                await showAlert('请先为这条便签选择所属项目，再转为词条。', 'warning', 'toast', 1800)
                setSaveState('idle')
                setStatusMessage('请先为便签设置所属项目')
                return
            }

            const createdEntry = await db_create_entry({
                projectId: latestIdea.project_id,
                categoryId: convertCategoryId,
                title: targetTitle,
                summary: null,
                content: draftContent.trim() ? draftContent : null,
                type: convertEntryType,
                tags: null,
                images: null,
            })

            const convertedIdea = await db_update_idea_note({
                id: latestIdea.id,
                status: 'processed',
                lastReviewedAt: new Date().toISOString(),
                convertedEntryId: createdEntry.id,
            })

            setSaveState('saved')
            setStatusMessage(`已转为词条「${createdEntry.title}」`)

            if (matchesCurrentFilters(convertedIdea)) {
                setIdeaNotes((prev) => sortIdeaNotes(prev.map((item) => item.id === convertedIdea.id ? convertedIdea : item)))
            } else {
                await loadIdeaNotes(convertedIdea.id)
            }

            if (openAfterConvert) {
                onOpenEntry?.(latestIdea.project_id, {
                    id: createdEntry.id,
                    title: createdEntry.title,
                })
            }
        } catch (error) {
            console.error('转为词条失败', error)
            setSaveState('error')
            setStatusMessage(error instanceof Error ? error.message : '转为词条失败')
        } finally {
            setConverting(false)
        }
    }, [
        convertCategoryId,
        convertEntryType,
        draftContent,
        draftProjectId,
        draftTitle,
        handleOpenConvertedEntry,
        loadIdeaNotes,
        matchesCurrentFilters,
        onOpenEntry,
        openAfterConvert,
        selectedIdea,
        showAlert,
    ])

    const handleDeleteCurrentIdea = useCallback(async () => {
        if (!selectedIdea) return

        const confirmed = await showAlert('删除后无法恢复，是否继续删除当前便签？', 'warning', 'confirm')
        if (confirmed !== 'yes') return

        try {
            await db_delete_idea_note(selectedIdea.id)
            await loadIdeaNotes()
            setStatusMessage('便签已删除，输入内容后会自动创建新的便签')
        } catch (error) {
            console.error('删除灵感便签失败', error)
            setSaveState('error')
            setStatusMessage(error instanceof Error ? error.message : '删除便签失败')
        }
    }, [loadIdeaNotes, selectedIdea, showAlert])

    return (
        <div
            ref={layoutRef}
            className={`idea-page${compactLayout ? ' is-compact' : ''}${compactLayout && sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
        >
            <div className="idea-page__shell">
                {compactLayout && !sidebarCollapsed ? (
                    <button
                        type="button"
                        className="idea-page__sidebar-backdrop"
                        aria-label="关闭灵感侧边栏"
                        onClick={() => setSidebarCollapsed(true)}
                    />
                ) : null}

                <aside className="idea-page__sidebar">
                    <div className="idea-page__sidebar-inner">
                        <div className="idea-page__sidebar-topbar">
                            <div className="idea-page__sidebar-topbar-title">灵感导航</div>
                            {compactLayout ? (
                                <button
                                    type="button"
                                    className="idea-page__sidebar-toggle"
                                    onClick={() => setSidebarCollapsed(true)}
                                    title="收起侧边栏"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                         strokeWidth="1.5">
                                        <path d="M10 3L5 8L10 13"/>
                                    </svg>
                                </button>
                            ) : null}
                        </div>
                        <div className="idea-page__toolbar">
                            <div className="idea-page__toolbar-group">
                                <span className="idea-page__toolbar-label">视图</span>
                                <div className="idea-page__segmented">
                                    {IDEA_VIEW_OPTIONS.map((item) => (
                                        <button
                                            key={item.key}
                                            type="button"
                                            className={`idea-page__segmented-item${viewMode === item.key ? ' is-active' : ''}`}
                                            onClick={() => setViewMode(item.key)}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="idea-page__toolbar-group idea-page__toolbar-group--project">
                                <span className="idea-page__toolbar-label">项目</span>
                                <Select
                                    className="idea-page__project-select"
                                    value={projectFilter}
                                    options={projectFilterOptions}
                                    onChange={(value) => setProjectFilter(String(value))}
                                />
                            </div>
                        </div>

                        <div className="idea-page__sidebar-header">
                            <div>
                                <h2 className="idea-page__title">灵感便签</h2>
                                <p className="idea-page__subtitle">默认先看待整理，重要内容可以置顶。</p>
                            </div>
                            <Button variant="ghost" onClick={handleCreateBlankIdea}>新建便签</Button>
                        </div>

                        <div className="idea-page__list">
                            {loading ? (
                                <div className="idea-page__empty">正在加载便签…</div>
                            ) : ideaNotes.length === 0 ? (
                                <div className="idea-page__empty">当前筛选下还没有便签，右侧直接开始记录。</div>
                            ) : (
                                ideaNotes.map((idea) => {
                                    const active = idea.id === selectedIdeaId
                                    return (
                                        <button
                                            key={idea.id}
                                            type="button"
                                            className={`idea-page__item${active ? ' is-active' : ''}`}
                                            onClick={() => handleSelectIdea(idea.id)}
                                        >
                                            <div className="idea-page__item-top">
                                                <span className="idea-page__item-title">{buildIdeaPreview(idea)}</span>
                                                {idea.pinned ? <span className="idea-page__item-pin">置顶</span> : null}
                                            </div>
                                            <div className="idea-page__item-preview">
                                                {idea.content.trim() || '空白便签'}
                                            </div>
                                            <div className="idea-page__item-meta">
                                                <span>{formatIdeaTime(idea.updated_at)}</span>
                                                <span>{getIdeaStatusLabel(idea.status)}</span>
                                            </div>
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </aside>

                <main className="idea-page__main">
                    <div className="idea-page__main-topbar">
                        <div className="idea-page__main-topbar-left">
                            <button
                                type="button"
                                className="idea-page__sidebar-toggle"
                                onClick={() => setSidebarCollapsed((prev) => !prev)}
                                title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    {sidebarCollapsed ? (
                                        <path d="M6 3L11 8L6 13"/>
                                    ) : (
                                        <path d="M10 3L5 8L10 13"/>
                                    )}
                                </svg>
                            </button>
                            <div className="idea-page__main-title">灵感便签</div>
                        </div>
                        <div className="idea-page__main-topbar-right">
                            <button
                                type="button"
                                className="idea-page__sidebar-toggle idea-page__fullscreen-toggle"
                                onClick={() => onTogglePanelMode?.()}
                                title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    {panelMode === 'fullscreen' ? (
                                        <>
                                            <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                                        </>
                                    ) : (
                                        <>
                                            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                                        </>
                                    )}
                                </svg>
                            </button>
                            <button
                                type="button"
                                className="idea-page__sidebar-toggle idea-page__collapse-toggle"
                                onClick={() => onToggleCollapsed?.()}
                                title="最小化"
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    <path d="M6 4l4 4-4 4"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <section className="idea-page__editor">
                        <div className="idea-page__editor-header">
                            <div className="idea-page__editor-header-top">
                                <div>
                                    <h3 className="idea-page__editor-title">
                                        {selectedIdea ? '编辑便签' : '快速记录'}
                                    </h3>
                                    <p className={`idea-page__status idea-page__status--${saveState}`}>{statusMessage}</p>
                                </div>
                                <div className="idea-page__actions">
                                    <Button variant="ghost" onClick={handleCreateBlankIdea}>空白便签</Button>
                                    <Button variant="ghost" disabled={!selectedIdea}
                                            onClick={() => void handleDeleteCurrentIdea()}>
                                        删除
                                    </Button>
                                </div>
                            </div>
                            <div className="idea-page__editor-header-bottom">
                                <div className="idea-page__editor-meta">
                                    <div className="idea-page__meta-field">
                                        <span className="idea-page__meta-label">所属项目</span>
                                        <Select
                                            className="idea-page__meta-select"
                                            value={draftProjectId ?? 'global'}
                                            options={ideaProjectOptions}
                                            onChange={handleProjectChange}
                                        />
                                    </div>
                                    {selectedIdea ? (
                                        <span className="idea-page__meta-badge">
                                            当前状态：{getIdeaStatusLabel(selectedIdea.status)}
                                        </span>
                                    ) : null}
                                    {selectedIdea?.converted_entry_id ? (
                                        <span className="idea-page__meta-badge">
                                            已关联词条
                                        </span>
                                    ) : null}
                                    {selectedIdea?.project_id && (
                                        <>
                                            <div className="idea-page__meta-field">
                                                <span className="idea-page__meta-label">目标分类</span>
                                                <Select
                                                    className="idea-page__meta-select"
                                                    value={convertCategoryId ?? 'root'}
                                                    options={categoryOptions}
                                                    onChange={(value) => setConvertCategoryId(value === 'root' ? null : String(value))}
                                                    disabled={converting || Boolean(selectedIdea.converted_entry_id)}
                                                />
                                            </div>
                                            <div className="idea-page__meta-field">
                                                <span className="idea-page__meta-label">词条类型</span>
                                                <Select
                                                    className="idea-page__meta-select"
                                                    value={convertEntryType ?? ''}
                                                    options={entryTypeOptions}
                                                    onChange={(value) => setConvertEntryType(value ? String(value) : null)}
                                                    disabled={converting || Boolean(selectedIdea.converted_entry_id)}
                                                />
                                            </div>
                                        </>
                                    )}
                                    {selectedIdea && !selectedIdea.project_id && (
                                        <span className="idea-page__meta-badge">
                                            先设置所属项目后才能转为词条
                                        </span>
                                    )}
                                </div>
                                <div className="idea-page__actions idea-page__actions--secondary">
                                    <Button
                                        variant="ghost"
                                        disabled={!selectedIdea || converting || Boolean(selectedIdea?.converted_entry_id)}
                                        onClick={() => setOpenAfterConvert((prev) => !prev)}
                                    >
                                        转后打开：{openAfterConvert ? '开' : '关'}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        disabled={!selectedIdea || converting}
                                        onClick={() => void handleConvertToEntry()}
                                    >
                                        {converting ? '转词条中…' : selectedIdea?.converted_entry_id ? '打开词条' : '转为词条'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="idea-page__editor-body">
                            <div className="idea-page__editor-tools">
                                <div className="idea-page__segmented idea-page__segmented--compact">
                                    {IDEA_STATUS_OPTIONS.map((item) => (
                                        <button
                                            key={item.key}
                                            type="button"
                                            className={`idea-page__segmented-item${selectedIdea?.status === item.key ? ' is-active' : ''}`}
                                            onClick={() => void handleChangeIdeaStatus(item.key)}
                                            disabled={!selectedIdea}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="idea-page__quick-actions">
                                    <Button variant="ghost" disabled={!selectedIdea}
                                            onClick={() => void handleTogglePinned()}>
                                        {selectedIdea?.pinned ? '取消置顶' : '置顶'}
                                    </Button>
                                </div>
                            </div>
                            <input
                                className="idea-page__title-input"
                                value={draftTitle}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                placeholder="可选标题，不写也可以"
                            />
                            <textarea
                                ref={textareaRef}
                                className="idea-page__content-input"
                                value={draftContent}
                                onChange={(event) => setDraftContent(event.target.value)}
                                placeholder="把刚冒出来的想法先记在这里。支持先写正文，系统会自动保存。"
                            />
                        </div>
                    </section>
                </main>
            </div>
        </div>
    )
};
