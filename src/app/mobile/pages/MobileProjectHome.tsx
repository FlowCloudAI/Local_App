import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {save as saveFileDialog} from '@tauri-apps/plugin-dialog'
import {
    db_create_entry,
    db_delete_project,
    db_export_project_fcworld,
    db_get_project,
    db_get_project_stats,
    db_list_categories,
    db_update_project,
    type Category,
    type Project,
    type ProjectStats,
} from '../../../api'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {ActionMenu, FloatingPanel, RenameDialog} from '../../../shared/ui/overlay'
import ProjectCoverPickerModal from '../../../features/project-editor/components/ProjectCoverPickerModal'
import {invalidateProjectList} from '../../../features/projects/projectListStore'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import {useFcworldProgress} from '../../../features/projects/hooks/useFcworldProgress'
import './MobileProjectHome.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    aiFocus: AiFocus
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

function buildProjectExportFileName(projectName: string): string {
    const safeName = projectName
        .split('')
        .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    return `${safeName || '世界观'}.fcworld`
}

export default function MobileProjectHome({push, pop, navigateToTab, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const {showAlert} = useAlert()
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const [project, setProject] = useState<Project | null>(null)
    const [categories, setCategories] = useState<Category[]>([])
    const [stats, setStats] = useState<ProjectStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [menuOpen, setMenuOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [coverOpen, setCoverOpen] = useState(false)
    const [descriptionOpen, setDescriptionOpen] = useState(false)
    const [descriptionDraft, setDescriptionDraft] = useState('')
    const [descriptionSaving, setDescriptionSaving] = useState(false)
    const [exporting, setExporting] = useState(false)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        Promise.all([
            db_get_project(projectId),
            db_list_categories(projectId),
            db_get_project_stats(projectId),
        ]).then(([p, cats, s]) => {
            setProject(p)
            setCategories(cats)
            setStats(s)
        }).catch(logger.error).finally(() => setLoading(false))
    }, [projectId])

    const handleCreateEntry = useCallback(async (categoryId: string | null) => {
        try {
            const created = await db_create_entry({
                projectId,
                categoryId,
                title: '未命名词条',
            })
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit'}})
        } catch (e) {
            logger.error('新建词条失败', e)
        }
    }, [projectId, push, setAiFocus])

    const handleOpenEntryList = useCallback((categoryId: string | null, categoryName: string) => {
        push({type: 'entryList', params: {projectId, categoryId: categoryId ?? '', displayName: categoryName}})
    }, [projectId, push])

    const handleOpenAi = useCallback(() => {
        setAiFocus({projectId, entryId: null})
        navigateToTab('ai')
    }, [navigateToTab, projectId, setAiFocus])

    const handleRename = useCallback(async (name: string) => {
        setRenaming(true)
        try {
            await db_update_project({id: projectId, name})
            setProject(prev => prev ? {...prev, name} : prev)
            invalidateProjectList()
            setRenameOpen(false)
        } catch (e) {
            await showAlert(`重命名失败：${String(e)}`, 'error', 'toast', 3000)
        } finally {
            setRenaming(false)
        }
    }, [projectId, showAlert])

    const handleChangeCover = useCallback(async (coverPath: string | null) => {
        try {
            await db_update_project({id: projectId, coverPath})
            setProject(prev => prev ? {...prev, cover_path: coverPath} : prev)
            invalidateProjectList()
            setCoverOpen(false)
        } catch (e) {
            await showAlert(`更换封面失败：${String(e)}`, 'error', 'toast', 3000)
        }
    }, [projectId, showAlert])

    const handleOpenDescription = useCallback(() => {
        setDescriptionDraft(project?.description ?? '')
        setDescriptionOpen(true)
    }, [project?.description])

    const handleSaveDescription = useCallback(async () => {
        setDescriptionSaving(true)
        try {
            const description = descriptionDraft.trim() || null
            const updated = await db_update_project({id: projectId, description})
            setProject(prev => prev ? {...prev, description: updated.description ?? null} : updated)
            invalidateProjectList()
            setDescriptionOpen(false)
        } catch (e) {
            await showAlert(`保存描述失败：${String(e)}`, 'error', 'toast', 3000)
        } finally {
            setDescriptionSaving(false)
        }
    }, [descriptionDraft, projectId, showAlert])

    const handleExportProject = useCallback(async () => {
        if (!project || exporting) return
        const selectedPath = await saveFileDialog({
            defaultPath: buildProjectExportFileName(project.name),
            filters: [{
                name: 'FlowCloudAI World',
                extensions: ['fcworld'],
            }],
        })
        if (!selectedPath) return

        setExporting(true)
        try {
            const operationId = startProgress('export', '导出世界')
            await db_export_project_fcworld(projectId, selectedPath, operationId)
            finishProgress()
        } catch (e) {
            closeProgress()
            await showAlert(`导出世界失败：${String(e)}`, 'error', 'toast', 3200)
        } finally {
            setExporting(false)
        }
    }, [closeProgress, exporting, finishProgress, project, projectId, showAlert, startProgress])

    const handleDeleteProject = useCallback(async () => {
        const result = await showAlert(
            `确定删除项目「${project?.name ?? ''}」？将永久删除其中所有词条、分类与图片，且不可撤销。`,
            'warning',
            'confirm',
        )
        if (result !== 'yes') return
        try {
            await db_delete_project(projectId)
            invalidateProjectList()
            pop()
        } catch (e) {
            await showAlert(`删除项目失败：${String(e)}`, 'error', 'toast', 3000)
        }
    }, [project, projectId, pop, showAlert])

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!project) return <div className="mobile-page__error">项目不存在</div>

    const image = toProjectImageSrc(project.cover_path)

    return (
        <div className="mobile-page mobile-project-home">
            <section className="mobile-project-home__hero">
                {image ? (
                    <img
                        src={image}
                        alt={project.name}
                        className="mobile-project-home__cover"
                    />
                ) : (
                    <div className="mobile-project-home__cover mobile-project-home__cover--empty">
                        {project.name.trim()[0] ?? '世'}
                    </div>
                )}
                <div className="mobile-project-home__title-row">
                    <div className="mobile-project-home__title-copy">
                        <span className="mobile-project-home__eyebrow">世界观</span>
                        <h2 className="mobile-project-home__title">{project.name}</h2>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setMenuOpen(true)}>
                        管理
                    </Button>
                </div>
                {project.description && (
                    <p className="mobile-project-home__description">
                        {project.description}
                    </p>
                )}
                {stats && (
                    <div className="mobile-project-home__stats">
                        <span className="mobile-project-home__stat">{stats.wordCount?.toLocaleString() ?? 0} 字</span>
                        <span className="mobile-project-home__stat">{stats.imageCount ?? 0} 张图片</span>
                    </div>
                )}
            </section>

            <div className="mobile-project-home__actions">
                <Button type="button" size="sm" className="mobile-project-home__action" onClick={() => handleCreateEntry(null)}>+ 新建词条</Button>
                <Button type="button" size="sm" variant="outline" className="mobile-project-home__action" onClick={handleOpenAi}>AI 讨论</Button>
            </div>

            <button
                type="button"
                className="mobile-list-card"
                onClick={() => handleOpenEntryList(null, '全部词条')}
            >
                <span className="mobile-list-card__title">全部词条</span>
                <span className="mobile-list-card__description">浏览项目中所有词条</span>
            </button>

            <button
                type="button"
                className="mobile-list-card"
                onClick={() => push({type: 'projectDefs', params: {projectId, displayName: '类型与标签'}})}
            >
                <span className="mobile-list-card__title">类型与标签</span>
                <span className="mobile-list-card__description">管理词条类型与标签定义</span>
            </button>

            <button
                type="button"
                className="mobile-list-card"
                onClick={() => push({type: 'categoryManager', params: {projectId, displayName: '分类管理'}})}
            >
                <span className="mobile-list-card__title">分类管理</span>
                <span className="mobile-list-card__description">新建、重命名、移动或删除分类</span>
            </button>

            {categories.length > 0 && (
                <section className="mobile-project-home__category-section">
                    <h3 className="mobile-project-home__section-title">
                        分类 ({categories.length})
                    </h3>
                    <div className="mobile-project-home__category-list">
                        {categories
                            .filter(c => !c.parent_id)
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map(cat => (
                                <button
                                    type="button"
                                    className="mobile-list-card"
                                    key={cat.id}
                                    onClick={() => handleOpenEntryList(cat.id, cat.name)}
                                >
                                    <span className="mobile-list-card__title">{cat.name}</span>
                                </button>
                            ))
                        }
                    </div>
                </section>
            )}
            <ActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                title={project.name}
                items={[
                    {key: 'rename', label: '重命名', onSelect: () => setRenameOpen(true)},
                    {key: 'description', label: '编辑描述', onSelect: handleOpenDescription},
                    {key: 'cover', label: '换封面', onSelect: () => setCoverOpen(true)},
                    {key: 'export', label: exporting ? '导出中…' : '导出 .fcworld', disabled: exporting, onSelect: () => void handleExportProject()},
                    {key: 'delete', label: '删除项目', danger: true, onSelect: () => void handleDeleteProject()},
                ]}
            />

            <RenameDialog
                open={renameOpen}
                title="重命名项目"
                initialValue={project.name}
                placeholder="项目名称"
                busy={renaming}
                onClose={() => setRenameOpen(false)}
                onConfirm={(name) => void handleRename(name)}
            />

            <FloatingPanel
                open={descriptionOpen}
                onClose={() => setDescriptionOpen(false)}
                dismissible={!descriptionSaving}
                ariaLabel="编辑项目描述"
                className="fc-rename-dialog"
            >
                <div className="fc-rename-dialog__title">编辑项目描述</div>
                <textarea
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                    disabled={descriptionSaving}
                    placeholder="项目描述"
                    rows={5}
                    className="mobile-project-home__description-input"
                />
                <div className="fc-rename-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDescriptionOpen(false)} disabled={descriptionSaving}>取消</Button>
                    <Button type="button" size="sm" onClick={() => void handleSaveDescription()} disabled={descriptionSaving}>
                        {descriptionSaving ? '保存中…' : '保存'}
                    </Button>
                </div>
            </FloatingPanel>

            <ProjectCoverPickerModal
                open={coverOpen}
                projectId={projectId}
                projectName={project.name}
                currentCoverPath={project.cover_path}
                onClose={() => setCoverOpen(false)}
                onSelectCover={(coverPath) => handleChangeCover(coverPath)}
            />
            <FcworldProgressDialog progress={fcworldProgress} />
        </div>
    )
}
