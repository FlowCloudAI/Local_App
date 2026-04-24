import {type CSSProperties, memo, useEffect, useState} from 'react'
import {convertFileSrc} from '@tauri-apps/api/core'
import {Button, Card, Input, RollingBox} from 'flowcloudai-ui'
import {db_count_entries, db_list_projects, type Project} from '../api'
import ProjectCreator from '../features/projects/components/ProjectCreator'
import './ProjectList.css'

interface ProjectListProps {
    onOpenProject?: (project: Project) => void
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

function placeholderMark(name: string): string {
    const trimmed = name.trim()
    return trimmed ? trimmed[0] : 'P'
}

function asOptionalString(value: unknown): string | null | undefined {
    return typeof value === 'string' || value == null ? value : undefined
}

function ProjectList({onOpenProject}: ProjectListProps) {
    const [projects, setProjects] = useState<Project[]>([])
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(false)
    const [hasLoadedProjects, setHasLoadedProjects] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [creatorOpen, setCreatorOpen] = useState(false)

    async function loadProjects() {
        setLoading(true)
        setError(null)
        try {
            const nextProjects = await db_list_projects()
            setProjects(nextProjects)

            const countEntries = await Promise.all(
                nextProjects.map(async project => {
                    const count = await db_count_entries({projectId: project.id})
                    return [project.id, count] as const
                })
            )

            setEntryCounts(Object.fromEntries(countEntries))
        } catch (e) {
            setError(String(e))
        } finally {
            setLoading(false)
            setHasLoadedProjects(true)
        }
    }

    useEffect(() => {
        void loadProjects()
    }, [])

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

    return (
        <>
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={() => void loadProjects()}
                existingNames={projects.map(p => p.name)}
            />
            <RollingBox style={{padding: '0.35rem'} as CSSProperties} thumbSize="thin">
                <div className="project-list-page">
                    <div className="project-list-header">
                        <div className="project-list-title-block">
                            <h1 className="project-list-title">项目</h1>
                            <p className="project-list-subtitle">
                                浏览你的世界观项目。
                            </p>
                        </div>
                        <div className="project-list-header-actions">
                            <Button
                                size="sm"
                                onClick={() => setCreatorOpen(true)}
                            >
                                新建世界观
                            </Button>
                            <Button
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
                            onChange={setSearchText}
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
                        <div className="project-list-feedback error">
                            项目列表加载失败：{error}
                        </div>
                    )}

                {!error && (
                    <div className="project-list-feedback">
                        共 {projectCountLabel} 个项目，当前显示 {filteredProjectCountLabel} 个。
                    </div>
                )}

                    {hasLoadedProjects && projects.length === 0 && !loading ? (
                        <section className="project-list-empty-state">
                            <div className="project-list-empty-panel">
                                <div className="project-list-empty-mark">WORLD</div>
                                <h2 className="project-list-empty-title">让您的世界开始发光</h2>
                                <p className="project-list-empty-copy">
                                    从一个名字、一张封面、一个角色开始，把脑海里的大陆、城市、神话和命运写成真正可返回的世界
                                </p>
                                <Button size="lg" onClick={() => setCreatorOpen(true)}>创建您的第一个世界</Button>
                            </div>
                        </section>
                    ) : hasLoadedProjects || loading || error ? (
                        <div className="project-list-grid">
                            {filteredProjects.length === 0 && !loading ? (
                                <div className="project-list-feedback">
                                    没有匹配的项目。
                                </div>
                            ) : (
                                filteredProjects.map(project => {
                                    const coverPath = asOptionalString(project.cover_path)
                                    const updatedAt = asOptionalString(project.updated_at)
                                    const createdAt = asOptionalString(project.created_at)
                                    const image = toProjectImageSrc(coverPath)
                                    const timestampLabel = formatDate(updatedAt ?? createdAt)
                                    const entryCount = entryCounts[project.id] ?? 0

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
                                                    <span className="project-list-placeholder-mark">
                                                        {placeholderMark(project.name)}
                                                    </span>
                                                    </div>
                                                ) : undefined}
                                                title={project.name}
                                                description={project.description || '你的世界在等你回来，继续把新的角色、地点和事件写进去。'}
                                                extraInfo={(
                                                    <div className="project-list-meta">
                                                        <span>最近更新 {timestampLabel}</span>
                                                        <span>{entryCount} 个词条</span>
                                                    </div>
                                                )}
                                                variant="shadow"
                                                hoverable
                                                expandContentOnHover
                                                imageHeight="100%"
                                                contentAreaRatio={0.12}
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
                </div>
            </RollingBox>
        </>
    )
}

export default memo(ProjectList)
