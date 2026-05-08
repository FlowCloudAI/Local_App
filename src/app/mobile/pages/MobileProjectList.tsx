import {useCallback, useEffect, useState} from 'react'
import {Button, Card, Input} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {db_count_entries, db_list_projects, type Project} from '../../../api'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
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
    const [projects, setProjects] = useState<Project[]>([])
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [creatorOpen, setCreatorOpen] = useState(false)

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

            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                <Input
                    placeholder="搜索项目…"
                    value={searchText}
                    onValueChange={setSearchText}
                    style={{flex: 1}}
                />
                <Button size="sm" onClick={() => setCreatorOpen(true)}>新建</Button>
            </div>

            {projects.length === 0 && !loading ? (
                <div className="mobile-page__empty">
                    <p>还没有任何项目</p>
                    <Button onClick={() => setCreatorOpen(true)}>创建第一个世界</Button>
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
