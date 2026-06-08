import {convertFileSrc} from '@tauri-apps/api/core'
import {useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import type {Project} from '../../../api'
import ProjectOverviewStats from './ProjectOverviewStats'

function parseDateMs(s?: string | null): number {
    if (!s) return 0
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? 0 : t
}

function formatDate(s?: string | null): string {
    const ms = parseDateMs(s)
    if (!ms) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(ms)
}

function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

interface ProjectOverviewHeaderProps {
    project: Project
    entryCount: number
    categoryCount: number
    entryTypeCount: number
    tagCount: number
    imageCount?: number | null
    wordCount?: number | null
    onEditCover?: () => void
    onClearCover?: () => void
    coverUpdating?: boolean
    onCreateEntry?: () => void | Promise<void>
    onOpenProjectAi?: () => void
    onExport?: () => void | Promise<void>
    exporting?: boolean
    onDelete?: () => void | Promise<void>
    onDescriptionChange?: (description: string) => void | Promise<void>
}

function ProjectOverviewHeader({
                                   project,
                                   entryCount,
                                   categoryCount,
                                   entryTypeCount,
                                   tagCount,
                                   imageCount,
                                   wordCount,
                                   onEditCover,
                                   onClearCover,
                                   coverUpdating = false,
                                   onCreateEntry,
                                   onOpenProjectAi,
                                   onExport,
                                   exporting = false,
                                   onDelete,
                                   onDescriptionChange,
                               }: ProjectOverviewHeaderProps) {
    const {showAlert} = useAlert()
    const [descEditing, setDescEditing] = useState(false)
    const [descDraft, setDescDraft] = useState('')
    const [descSaving, setDescSaving] = useState(false)
    const coverSrc = toProjectImageSrc(project.cover_path)
    const titleMark = project.name?.trim()?.[0] ?? '项'

    async function handleDelete() {
        if (!onDelete) return
        const confirmed = await showAlert(
            `确定要删除项目「${project.name}」吗？项目内的所有词条和数据将被永久删除，此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return
        try {
            await onDelete()
        } catch (e) {
            void showAlert(`删除失败：${String(e)}`, 'error', 'nonInvasive', 2200)
        }
    }

    function handleDescEditStart() {
        setDescDraft(project.description ?? '')
        setDescEditing(true)
    }

    async function handleDescSave() {
        if (!onDescriptionChange) return
        setDescSaving(true)
        try {
            await onDescriptionChange(descDraft.trim())
            setDescEditing(false)
        } catch (e) {
            void showAlert(`保存失败：${String(e)}`, 'error', 'nonInvasive', 2200)
        } finally {
            setDescSaving(false)
        }
    }

    return (
        <section className="pe-overview-hero">
            <div className="pe-project-cover-card">
                <button
                    type="button"
                    className={`pe-project-cover${coverSrc ? ' has-image' : ''}`}
                    onClick={onEditCover}
                    disabled={coverUpdating}
                >
                    {coverSrc ? (
                        <img
                            src={coverSrc}
                            alt={`${project.name} 项目封面`}
                            className="pe-project-cover__image"
                        />
                    ) : (
                        <div className="pe-project-cover__placeholder">
                            <span className="pe-project-cover__mark">{titleMark}</span>
                            <span className="pe-project-cover__hint">点击设置项目封面</span>
                        </div>
                    )}
                </button>
                <div className="pe-project-cover__actions">
                    <Button type="button" variant="outline" size="sm" onClick={onEditCover} disabled={coverUpdating}>
                        {coverUpdating ? '保存中…' : coverSrc ? '更换封面' : '设置封面'}
                    </Button>
                    {coverSrc && (
                        <Button type="button" variant="ghost" size="sm" onClick={onClearCover} disabled={coverUpdating}>
                            清除封面
                        </Button>
                    )}
                </div>
            </div>

            <div className="pe-overview-hero__content pe-overview-hero__primary">
                <h1 className="pe-overview-title">{project.name}</h1>
                {descEditing ? (
                    <div className="pe-overview-desc-editor">
                        <textarea
                            className="pe-overview-desc-textarea"
                            value={descDraft}
                            onChange={(e) => setDescDraft(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder="添加项目描述…"
                        />
                        <div className="pe-overview-desc-actions">
                            <Button type="button" size="sm" disabled={descSaving} onClick={() => void handleDescSave()}>
                                {descSaving ? '保存中…' : '保存'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" disabled={descSaving}
                                    onClick={() => setDescEditing(false)}>
                                取消
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="pe-overview-desc-row">
                        {project.description ? (
                            <p className="pe-overview-desc">{project.description}</p>
                        ) : (
                            onDescriptionChange && (
                                <p className="pe-overview-desc is-placeholder">暂无描述</p>
                            )
                        )}
                        {onDescriptionChange && (
                            <Button type="button" variant="ghost" size="sm" onClick={handleDescEditStart}>
                                {project.description ? '编辑描述' : '添加描述'}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <div className="pe-overview-hero__content pe-overview-hero__secondary">
                <div className="pe-overview-meta">
                    <span>创建于 {formatDate(project.created_at)}</span>
                    <span className="pe-meta-sep">·</span>
                    <span>更新于 {formatDate(project.updated_at)}</span>
                </div>
                {(onCreateEntry || onOpenProjectAi || onExport) && (
                    <div className="pe-overview-primary-actions">
                        {onCreateEntry && (
                            <Button type="button" size="lg" onClick={() => void onCreateEntry()}>
                                新建词条
                            </Button>
                        )}
                        {onOpenProjectAi && (
                            <Button type="button" variant="outline" size="lg" onClick={onOpenProjectAi}>
                                AI 讨论项目
                            </Button>
                        )}
                        {onExport && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="lg"
                                onClick={() => void onExport()}
                                disabled={exporting}
                            >
                                {exporting ? '导出中…' : '导出世界'}
                            </Button>
                        )}
                    </div>
                )}
                <ProjectOverviewStats
                    entryCount={entryCount}
                    categoryCount={categoryCount}
                    entryTypeCount={entryTypeCount}
                    tagCount={tagCount}
                    imageCount={imageCount}
                    wordCount={wordCount}
                />
                {onDelete && (
                    <div className="pe-overview-danger-row">
                        <Button type="button" variant="ghost" size="sm" onClick={() => void handleDelete()}>
                            删除项目
                        </Button>
                    </div>
                )}
            </div>
        </section>
    )
}

export default ProjectOverviewHeader
