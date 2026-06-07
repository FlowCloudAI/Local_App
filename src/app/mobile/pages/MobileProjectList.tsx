import {useCallback, useEffect, useState} from 'react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {
    db_count_entries,
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
    const {projects, loading: projectsLoading, error: projectError} = useProjectListStore()
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [countsLoading, setCountsLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const [countsError, setCountsError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()

    useEffect(() => {
        if (projects.length === 0) {
            setEntryCounts({})
            setCountsError(null)
            setCountsLoading(false)
            return
        }

        let cancelled = false
        setCountsLoading(true)
        setCountsError(null)
        const loadCounts = async () => {
            try {
                const counts = await Promise.all(
                    projects.map(async p => {
                        const c = await db_count_entries({projectId: p.id})
                        return [p.id, c] as const
                    })
                )
                if (!cancelled) setEntryCounts(Object.fromEntries(counts))
            } catch (e) {
                if (!cancelled) setCountsError(String(e))
            } finally {
                if (!cancelled) setCountsLoading(false)
            }
        }
        void loadCounts()

        return () => {
            cancelled = true
        }
    }, [projects])

    const loading = projectsLoading || countsLoading
    const error = projectError ?? countsError

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
                onCreated={handleOpenProject}
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
