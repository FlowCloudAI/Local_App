import {Button, Select, useAlert} from 'flowcloudai-ui'
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
} from '../api'
import './Idea.css'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type IdeaViewMode = 'inbox' | 'all' | 'processed' | 'archived'
type ProjectFilterMode = 'all' | 'global' | string

const IDEA_LIST_LIMIT = 100
const AUTOSAVE_DELAY = 700
const PREVIEW_LENGTH = 28

const IDEA_VIEW_OPTIONS: Array<{ key: IdeaViewMode; label: string; status?: IdeaNoteStatus }> = [
    {key: 'inbox', label: '待整理', status: 'inbox'},
    {key: 'all', label: '全部'},
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

export default function Idea() {
    const {showAlert} = useAlert()
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const createRequestIdRef = useRef(0)

    const [ideaNotes, setIdeaNotes] = useState<IdeaNote[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saveState, setSaveState] = useState<SaveState>('idle')
    const [statusMessage, setStatusMessage] = useState('输入内容后会自动保存')
    const [viewMode, setViewMode] = useState<IdeaViewMode>('inbox')
    const [projectFilter, setProjectFilter] = useState<ProjectFilterMode>('all')

    const selectedIdea = useMemo(
        () => ideaNotes.find((item) => item.id === selectedIdeaId) ?? null,
        [ideaNotes, selectedIdeaId],
    )

    const projectFilterOptions = useMemo(() => ([
        {value: 'all', label: '全部项目'},
        {value: 'global', label: '未归属'},
        ...projects.map((project) => ({value: project.id, label: project.name})),
    ]), [projects])

    const selectedProjectName = useMemo(() => {
        if (!selectedIdea?.project_id) return '未归属'
        return projects.find((project) => project.id === selectedIdea.project_id)?.name ?? '所属项目已删除'
    }, [projects, selectedIdea?.project_id])

    const syncDraftFromIdea = useCallback((idea: IdeaNote | null) => {
        setDraftTitle(idea?.title ?? '')
        setDraftContent(idea?.content ?? '')
        setSaveState('idle')
        setStatusMessage('输入内容后会自动保存')
    }, [])

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
            setIdeaNotes(list)
            setSelectedIdeaId((prev) => {
                const targetId = preferredIdeaId ?? prev
                if (targetId && list.some((item) => item.id === targetId)) return targetId
                return list[0]?.id ?? null
            })

            if (list.length === 0) {
                syncDraftFromIdea(null)
            }

            setStatusMessage(list.length === 0 ? '当前筛选下还没有便签，右侧输入后会自动创建' : '输入内容后会自动保存')
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

    useEffect(() => {
        void loadIdeaNotes()
    }, [loadIdeaNotes])

    useEffect(() => {
        void loadProjects()
    }, [loadProjects])

    useEffect(() => {
        syncDraftFromIdea(selectedIdea)
    }, [selectedIdea, syncDraftFromIdea])

    useEffect(() => {
        if (!initialized) return

        const timer = window.setTimeout(() => {
            textareaRef.current?.focus()
        }, 0)

        return () => window.clearTimeout(timer)
    }, [initialized, selectedIdeaId])

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
            if (currentTitle === draftTitle && currentContent === draftContent) {
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
                        const updated = await db_update_idea_note({
                            id: sourceIdea.id,
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
                    if (projectFilter !== 'all' && projectFilter !== 'global' && !created.project_id) {
                        setProjectFilter('all')
                        setStatusMessage('当前版本暂不支持新建时直接归属项目，已先保存到“全部项目”。')
                        return
                    }

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
    }, [draftContent, draftTitle, initialized, loadIdeaNotes, loading, matchesCurrentFilters, projectFilter, selectedIdea, viewMode])

    const handleSelectIdea = useCallback((ideaId: string) => {
        setSelectedIdeaId(ideaId)
    }, [])

    const handleCreateBlankIdea = useCallback(() => {
        setSelectedIdeaId(null)
        syncDraftFromIdea(null)
        setStatusMessage('空白便签，开始输入后会自动创建')
    }, [syncDraftFromIdea])

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

    const handleConvertToEntry = useCallback(async () => {
        await showAlert('转词条流程尚未实现，后续会支持把灵感整理为正式词条。', 'info')
    }, [showAlert])

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
        <div className="idea-page">
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

            <aside className="idea-page__sidebar">
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
            </aside>

            <section className="idea-page__editor">
                <div className="idea-page__editor-header">
                    <div>
                        <h3 className="idea-page__editor-title">
                            {selectedIdea ? '编辑便签' : '快速记录'}
                        </h3>
                        <p className={`idea-page__status idea-page__status--${saveState}`}>{statusMessage}</p>
                        <div className="idea-page__editor-meta">
                            <span className="idea-page__meta-badge">
                                {selectedIdea ? `所属：${selectedProjectName}` : '所属：未归属'}
                            </span>
                            {selectedIdea ? (
                                <span className="idea-page__meta-badge">
                                    当前状态：{getIdeaStatusLabel(selectedIdea.status)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <div className="idea-page__actions">
                        <Button variant="ghost" onClick={handleCreateBlankIdea}>空白便签</Button>
                        <Button variant="ghost" disabled={!selectedIdea} onClick={() => void handleDeleteCurrentIdea()}>
                            删除
                        </Button>
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
                            <Button variant="ghost" disabled={!selectedIdea} onClick={() => void handleTogglePinned()}>
                                {selectedIdea?.pinned ? '取消置顶' : '置顶'}
                            </Button>
                            <Button variant="ghost" disabled={!selectedIdea}
                                    onClick={() => void handleConvertToEntry()}>
                                转为词条
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
        </div>
    )
}
