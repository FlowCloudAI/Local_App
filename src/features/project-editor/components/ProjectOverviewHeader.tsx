import {useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import type {Project} from '../../../api'
import FloatingPanel from '../../../shared/ui/overlay/FloatingPanel'
import RenameDialog from '../../../shared/ui/overlay/RenameDialog'
import ProjectOverviewStats from './ProjectOverviewStats'
import {formatProjectDate, toProjectImageSrc} from '../../projects/projectDisplay'
import '../../../shared/ui/overlay/FloatingPanelMenu.css'

function formatDate(s?: string | null): string {
    return formatProjectDate(s, {fallback: '未知', includeTime: true})
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
    onRename?: (name: string) => void | Promise<void>
    onExport?: () => void | Promise<void>
    exporting?: boolean
    onDelete?: () => void | Promise<void>
    onDescriptionChange?: (description: string) => void | Promise<void>
}

interface ProjectOverviewActionItem {
    key: string
    label: string
    danger?: boolean
    disabled?: boolean
    onSelect: () => void
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
                                   onRename,
                                   onExport,
                                   exporting = false,
                                   onDelete,
                                   onDescriptionChange,
                               }: ProjectOverviewHeaderProps) {
    const {showAlert} = useAlert()
    const [menuOpen, setMenuOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameSaving, setRenameSaving] = useState(false)
    const [descEditing, setDescEditing] = useState(false)
    const [descDraft, setDescDraft] = useState('')
    const [descSaving, setDescSaving] = useState(false)
    const coverSrc = toProjectImageSrc(project.cover_path)
    const titleMark = project.name?.trim()?.[0] ?? '项'

    async function handleDelete() {
        if (!onDelete) return
        const confirmed = await showAlert(
            `确定要删除世界「${project.name}」吗？世界内的所有词条和数据将被永久删除，此操作不可撤销。`,
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

    async function handleRenameConfirm(name: string) {
        if (!onRename) return
        if (name === project.name.trim()) {
            setRenameOpen(false)
            return
        }
        setRenameSaving(true)
        try {
            await onRename(name)
            setRenameOpen(false)
        } catch (e) {
            void showAlert(`重命名失败：${String(e)}`, 'error', 'nonInvasive', 2200)
        } finally {
            setRenameSaving(false)
        }
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

    const actionItems: ProjectOverviewActionItem[] = [
        onRename && {
            key: 'rename',
            label: '重命名',
            onSelect: () => setRenameOpen(true),
        },
        onDescriptionChange && {
            key: 'description',
            label: '编辑描述',
            onSelect: handleDescEditStart,
        },
        onExport && {
            key: 'export',
            label: exporting ? '导出中…' : '导出世界',
            disabled: exporting,
            onSelect: () => void onExport(),
        },
        onDelete && {
            key: 'delete',
            label: '删除世界',
            danger: true,
            onSelect: () => void handleDelete(),
        },
    ].filter(Boolean) as ProjectOverviewActionItem[]

    return (
        <>
            <section className="pe-overview-hero" data-tour-id="project-overview-hero">
                <div className="pe-project-cover-card" data-tour-id="project-overview-cover">
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

                {actionItems.length > 0 && (
                    <div className="pe-overview-hero__actions" data-tour-id="project-overview-edit">
                        <Button type="button" variant="outline" size="sm" onClick={() => setMenuOpen(true)}>
                            编辑
                        </Button>
                    </div>
                )}

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
                                <p className="pe-overview-desc is-placeholder">暂无描述</p>
                            )}
                        </div>
                    )}
                </div>

                <div className="pe-overview-hero__content pe-overview-hero__secondary" data-tour-id="project-overview-stats">
                    <div className="pe-overview-meta">
                        <span>创建于 {formatDate(project.created_at)}</span>
                        <span className="pe-meta-sep">·</span>
                        <span>更新于 {formatDate(project.updated_at)}</span>
                    </div>
                    <ProjectOverviewStats
                        entryCount={entryCount}
                        categoryCount={categoryCount}
                        entryTypeCount={entryTypeCount}
                        tagCount={tagCount}
                        imageCount={imageCount}
                        wordCount={wordCount}
                    />
                </div>
            </section>
            <FloatingPanel
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                ariaLabel="项目编辑菜单"
                className="fc-action-menu"
            >
                <div className="fc-action-menu__title">{project.name}</div>
                <div className="fc-action-menu__list">
                    {actionItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`fc-action-menu__item${item.danger ? ' fc-action-menu__item--danger' : ''}`}
                            disabled={item.disabled}
                            onClick={() => {
                                setMenuOpen(false)
                                item.onSelect()
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </FloatingPanel>
            <RenameDialog
                open={renameOpen}
                title="重命名世界"
                label="世界名称"
                initialValue={project.name}
                placeholder="输入世界名称"
                confirmText="保存"
                busy={renameSaving}
                onClose={() => setRenameOpen(false)}
                onConfirm={handleRenameConfirm}
            />
        </>
    )
}

export default ProjectOverviewHeader
