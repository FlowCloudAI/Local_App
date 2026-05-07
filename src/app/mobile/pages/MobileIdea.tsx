import {useCallback, useEffect, useState} from 'react'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    db_create_idea_note,
    db_delete_idea_note,
    db_list_idea_notes,
    db_list_projects,
    db_update_idea_note,
    type IdeaNote,
    type Project,
} from '../../../api'
import {type MobilePage} from '../usePageStack'

interface Props {
    push: (page: MobilePage) => void
    setAiFocus: (f: { projectId: string | null; entryId: string | null }) => void
}

type StatusFilter = 'all' | 'inbox' | 'processed' | 'archived'

const VIEW_OPTIONS: Array<{ key: StatusFilter; label: string }> = [
    {key: 'all', label: '全部'},
    {key: 'inbox', label: '待整理'},
    {key: 'processed', label: '已处理'},
    {key: 'archived', label: '已归档'},
]

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    {value: 'inbox', label: '待整理'},
    {value: 'processed', label: '已处理'},
    {value: 'archived', label: '已归档'},
]

function formatDate(s: string): string {
    const d = new Date(s)
    return d.toLocaleDateString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})
}

export default function MobileIdea(_props: Props) {
    void _props
    const {showAlert} = useAlert()
    const [ideas, setIdeas] = useState<IdeaNote[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(false)
    const [viewMode, setViewMode] = useState<StatusFilter>('all')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editContent, setEditContent] = useState('')
    const [editProjectId, setEditProjectId] = useState<string>('')
    // 新建草稿：null 表示未开启，'' 或有内容表示正在草拟
    const [draftContent, setDraftContent] = useState<string | null>(null)
    const [draftProjectId, setDraftProjectId] = useState<string>('')

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [notes, projs] = await Promise.all([
                db_list_idea_notes({limit: 100, offset: 0, status: viewMode === 'all' ? undefined : viewMode}),
                db_list_projects(),
            ])
            setIdeas(notes)
            setProjects(projs)
        } catch (e) {
            console.error('加载灵感失败', e)
        } finally {
            setLoading(false)
        }
    }, [viewMode])

    useEffect(() => {
        void load()
    }, [load])

    const handleCreate = () => {
        setDraftContent('')
        setDraftProjectId('')
    }

    const handleConfirmDraft = async () => {
        if (!draftContent?.trim()) {
            setDraftContent(null)
            return
        }
        try {
            const created = await db_create_idea_note({
                content: draftContent.trim(),
                projectId: draftProjectId || null,
            })
            setIdeas(prev => [created, ...prev])
            setDraftContent(null)
            setDraftProjectId('')
        } catch {
            await showAlert('创建失败', 'error', 'toast', 2000)
        }
    }

    const handleCancelDraft = () => {
        setDraftContent(null)
        setDraftProjectId('')
    }

    const handleSave = async (id: string) => {
        if (!editContent.trim()) return
        try {
            await db_update_idea_note({id, content: editContent.trim(), projectId: editProjectId || null})
            setIdeas(prev => prev.map(i => i.id === id ? {
                ...i,
                content: editContent.trim(),
                project_id: editProjectId || null
            } : i))
            setEditingId(null)
        } catch {
            await showAlert('保存失败', 'error', 'toast', 2000)
        }
    }

    const handleDelete = async (id: string) => {
        const result = await showAlert('确定删除此条灵感？', 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await db_delete_idea_note(id)
            setIdeas(prev => prev.filter(i => i.id !== id))
        } catch {
            await showAlert('删除失败', 'error', 'toast', 2000)
        }
    }

    const handleStatusChange = async (id: string, status: string) => {
        try {
            await db_update_idea_note({id, status: status as IdeaNote['status']})
            setIdeas(prev => prev.map(i => i.id === id ? {...i, status: status as IdeaNote['status']} : i))
        } catch (e) {
            console.error('更新状态失败', e)
        }
    }

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            {/* 草稿内联输入区 */}
            {draftContent !== null ? (
                <div style={{
                    padding: 12, marginBottom: 12,
                    borderRadius: 'var(--fc-radius-sm)',
                    background: 'var(--fc-color-bg-elevated)',
                    border: '1px solid var(--fc-color-primary)',
                }}>
                    <textarea
                        autoFocus
                        value={draftContent}
                        onChange={e => setDraftContent(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault()
                                void handleConfirmDraft()
                            }
                        }}
                        placeholder="记录灵感…"
                        rows={3}
                        style={{
                            width: '100%', padding: 8, borderRadius: 6,
                            border: '1px solid var(--fc-color-border)',
                            background: 'var(--fc-color-bg)', color: 'var(--fc-color-text)',
                            fontSize: 'var(--fc-font-size-sm)', resize: 'vertical',
                            fontFamily: 'inherit', boxSizing: 'border-box',
                        }}
                    />
                    <Select
                        value={draftProjectId}
                        onChange={v => setDraftProjectId(String(v ?? ''))}
                        options={[
                            {value: '', label: '无关联项目'},
                            ...projects.map(p => ({value: p.id, label: p.name})),
                        ]}
                        placeholder="关联项目（可选）"
                        style={{marginTop: 8}}
                    />
                    <div style={{display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end'}}>
                        <Button size="sm" variant="ghost" onClick={handleCancelDraft}>取消</Button>
                        <Button size="sm" onClick={handleConfirmDraft} disabled={!draftContent.trim()}>保存</Button>
                    </div>
                </div>
            ) : (
                <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                    <Button size="sm" onClick={handleCreate}>+ 新建</Button>
                    <Button size="sm" variant="outline" onClick={load} disabled={loading}>刷新</Button>
                </div>
            )}

            <div style={{display: 'flex', gap: 6, marginBottom: 12}}>
                {VIEW_OPTIONS.map(opt => (
                    <button
                        key={opt.key}
                        onClick={() => setViewMode(opt.key)}
                        style={{
                            padding: '4px 10px', borderRadius: 999, fontSize: 'var(--fc-font-size-xs)',
                            border: '1px solid var(--fc-color-border)',
                            background: viewMode === opt.key ? 'var(--fc-color-primary)' : undefined,
                            color: viewMode === opt.key ? '#fff' : 'var(--fc-color-text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : ideas.length === 0 ? (
                <div className="mobile-page__empty">
                    <p>暂无灵感笔记</p>
                    <Button size="sm" onClick={handleCreate}>记一笔</Button>
                </div>
            ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                    {ideas.map(idea => (
                        <div
                            key={idea.id}
                            style={{
                                padding: 10, borderRadius: 'var(--fc-radius-sm)',
                                background: 'var(--fc-color-bg-elevated)',
                                border: '1px solid var(--fc-color-border)',
                            }}
                        >
                            {editingId === idea.id ? (
                                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                                    <textarea
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        placeholder="记录灵感…"
                                        rows={3}
                                        style={{
                                            padding: 8, borderRadius: 6,
                                            border: '1px solid var(--fc-color-border)',
                                            background: 'var(--fc-color-bg)',
                                            color: 'var(--fc-color-text)',
                                            fontSize: 'var(--fc-font-size-sm)',
                                            resize: 'vertical',
                                            fontFamily: 'inherit',
                                        }}
                                    />
                                    <Select
                                        value={editProjectId}
                                        onChange={v => setEditProjectId(String(v ?? ''))}
                                        options={[
                                            {value: '', label: '无关联项目'},
                                            ...projects.map(p => ({value: p.id, label: p.name})),
                                        ]}
                                        placeholder="关联项目"
                                    />
                                    <div style={{display: 'flex', gap: 6, justifyContent: 'flex-end'}}>
                                        <Button size="sm" variant="ghost"
                                                onClick={() => setEditingId(null)}>取消</Button>
                                        <Button size="sm" onClick={() => handleSave(idea.id)}>保存</Button>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div style={{
                                        fontSize: 'var(--fc-font-size-sm)',
                                        marginBottom: 6,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}>
                                        {idea.content || '(空内容)'}
                                    </div>
                                    <div style={{
                                        display: 'flex', gap: 4, alignItems: 'center',
                                        fontSize: 'var(--fc-font-size-xs)', color: 'var(--fc-color-text-secondary)',
                                        flexWrap: 'wrap',
                                    }}>
                                        <span>{formatDate(idea.created_at)}</span>
                                        <span>·</span>
                                        <select
                                            value={idea.status}
                                            onChange={e => handleStatusChange(idea.id, e.target.value)}
                                            style={{
                                                fontSize: 'var(--fc-font-size-xs)', padding: '2px 4px',
                                                border: '1px solid var(--fc-color-border)', borderRadius: 4,
                                                background: 'var(--fc-color-bg)', color: 'var(--fc-color-text)',
                                            }}
                                        >
                                            {STATUS_OPTIONS.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                        {idea.project_id && (
                                            <>
                                                <span>·</span>
                                                <span>{projects.find(p => p.id === idea.project_id)?.name ?? idea.project_id}</span>
                                            </>
                                        )}
                                        <div style={{marginLeft: 'auto', display: 'flex', gap: 4}}>
                                            <button
                                                onClick={() => {
                                                    setEditingId(idea.id);
                                                    setEditContent(idea.content);
                                                    setEditProjectId(idea.project_id ?? '')
                                                }}
                                                style={{
                                                    fontSize: 'var(--fc-font-size-xs)',
                                                    border: 'none',
                                                    background: 'none',
                                                    color: 'var(--fc-color-primary)',
                                                    cursor: 'pointer',
                                                    padding: '2px 6px',
                                                }}
                                            >
                                                编辑
                                            </button>
                                            <button
                                                onClick={() => handleDelete(idea.id)}
                                                style={{
                                                    fontSize: 'var(--fc-font-size-xs)',
                                                    border: 'none',
                                                    background: 'none',
                                                    color: 'var(--fc-color-error)',
                                                    cursor: 'pointer',
                                                    padding: '2px 6px',
                                                }}
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
