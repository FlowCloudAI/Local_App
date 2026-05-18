import {useCallback, useEffect, useState} from 'react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {
    db_count_entries,
    db_get_project,
    db_import_project_fcworld,
    db_list_projects,
    db_preview_project_fcworld,
    type FcworldImportPreview,
    type FcworldImportResult,
    type Project,
} from '../../../api'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
import ProjectImportConflictDialog from '../../../features/projects/components/ProjectImportConflictDialog'
import {useFcworldProgress} from '../../../features/projects/hooks/useFcworldProgress'
import {type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

interface Props {
    push: (page: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
}

function toProjectImageSrc(coverPath?: string | null): string | undefined {
    if (!coverPath) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(coverPath)) return coverPath
    return convertFileSrc(coverPath, 'fcimg')
}

function formatDate(value?: string | null): string {
    if (!value) return '时间未知'
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const time = new Date(withTimezone).getTime()
    if (Number.isNaN(time)) return '时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(time)
}

export default function MobileProjectList({push, setAiFocus}: Props) {
    const {showAlert} = useAlert()
    const [projects, setProjects] = useState<Project[]>([])
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)
    const {progress: fcworldProgress, startProgress, closeProgress} = useFcworldProgress()

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const list = await db_list_projects()
            setProjects(list)
            const counts = await Promise.all(
                list.map(async p => {
                    const c = await db_count_entries({projectId: p.id})
                    return [p.id, c] as const
                })
            )
            setEntryCounts(Object.fromEntries(counts))
        } catch (e) {
            setError(String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        const handler = () => {
            void load()
        }
        window.addEventListener('fc:project-list-changed', handler)
        return () => window.removeEventListener('fc:project-list-changed', handler)
    }, [load])

    const query = searchText.trim().toLowerCase()
    const filtered = projects
        .filter(p => {
            if (!query) return true
            return p.name.toLowerCase().includes(query)
                || (p.description ?? '').toLowerCase().includes(query)
        })
        .sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
            return tb - ta
        })

    const handleOpenProject = useCallback((project: Project) => {
        setAiFocus({projectId: project.id, entryId: null})
        push({type: 'projectHome', params: {projectId: project.id, displayName: project.name}})
    }, [push, setAiFocus])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        window.dispatchEvent(new CustomEvent('fc:project-list-changed'))
        await load()
        const project = await db_get_project(result.projectId)
        await showAlert(
            `世界已导入：${result.importedRows.entries} 个词条，${result.assetCount} 个资源。`,
            'success',
            'nonInvasive',
            1400,
        )
        handleOpenProject(project)
    }, [handleOpenProject, load, showAlert])

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
            closeProgress()
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictCancel = useCallback(() => {
        if (!importing) setImportConflict(null)
    }, [importing])

    const handleImportConflictRename = useCallback(async (projectName: string) => {
        if (!importConflict || importing) return
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(importConflict.inputPath, {
                mode: 'rename',
                projectName,
            }, operationId)
            closeProgress()
            setImportConflict(null)
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictOverwrite = useCallback(async () => {
        if (!importConflict?.duplicateProject || importing) return
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(importConflict.inputPath, {
                mode: 'overwrite',
                overwriteProjectId: importConflict.duplicateProject.projectId,
            }, operationId)
            closeProgress()
            setImportConflict(null)
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${String(e)}`, 'error', 'toast', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    if (loading && projects.length === 0) {
        return <div className="mobile-page__loading">加载中…</div>
    }

    if (error && projects.length === 0) {
        return <div className="mobile-page__error">加载失败：{error}</div>
    }

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={() => void load()}
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

            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                <Input
                    placeholder="搜索项目…"
                    value={searchText}
                    onValueChange={setSearchText}
                    style={{flex: 1}}
                />
                <Button type="button" size="sm" onClick={() => setCreatorOpen(true)}>新建</Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={importing}
                    onClick={() => void handleImportProject()}
                >
                    {importing ? '导入中…' : '导入'}
                </Button>
            </div>

            {projects.length === 0 && !loading ? (
                <div className="mobile-page__empty">
                    <p>还没有任何项目</p>
                    <Button type="button" onClick={() => setCreatorOpen(true)}>创建第一个世界</Button>
                </div>
            ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                    {filtered.length === 0 ? (
                        <div className="mobile-page__empty">没有匹配的项目</div>
                    ) : (
                        filtered.map(project => {
                            const image = toProjectImageSrc(project.cover_path)
                            return (
                                <Card
                                    key={project.id}
                                    title={project.name}
                                    description={project.description || '暂无描述'}
                                    image={image}
                                    imageHeight="120px"
                                    extraInfo={
                                        <span style={{
                                            fontSize: 'var(--fc-font-size-xs)',
                                            color: 'var(--fc-color-text-secondary)'
                                        }}>
                                            {entryCounts[project.id] ?? 0} 词条 · {formatDate(project.updated_at)}
                                        </span>
                                    }
                                    variant="shadow"
                                    hoverable
                                    onClick={() => handleOpenProject(project)}
                                />
                            )
                        })
                    )}
                </div>
            )}
        </div>
    )
}
