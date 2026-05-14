import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {convertFileSrc} from '@tauri-apps/api/core'
import {
    db_create_entry,
    db_get_project,
    db_get_project_stats,
    db_list_categories,
    type Category,
    type Project,
    type ProjectStats,
} from '../../../api'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

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

export default function MobileProjectHome({push, navigateToTab, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const [project, setProject] = useState<Project | null>(null)
    const [categories, setCategories] = useState<Category[]>([])
    const [stats, setStats] = useState<ProjectStats | null>(null)
    const [loading, setLoading] = useState(true)

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
            push({type: 'entryEditor', params: {projectId, entryId: created.id, displayName: '未命名词条'}})
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

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!project) return <div className="mobile-page__error">项目不存在</div>

    const image = toProjectImageSrc(project.cover_path)

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            <div style={{marginBottom: 16}}>
                {image && (
                    <img
                        src={image}
                        alt={project.name}
                        style={{
                            width: '100%',
                            height: 140,
                            objectFit: 'cover',
                            borderRadius: 'var(--fc-radius-md)',
                            marginBottom: 12
                        }}
                    />
                )}
                <h2 style={{margin: '0 0 4px', fontSize: 'var(--fc-font-size-xl)', fontWeight: 700}}>{project.name}</h2>
                {project.description && (
                    <p style={{
                        margin: '0 0 8px',
                        color: 'var(--fc-color-text-secondary)',
                        fontSize: 'var(--fc-font-size-sm)'
                    }}>
                        {project.description}
                    </p>
                )}
                {stats && (
                    <div style={{
                        display: 'flex',
                        gap: 16,
                        fontSize: 'var(--fc-font-size-xs)',
                        color: 'var(--fc-color-text-secondary)'
                    }}>
                        <span>{stats.wordCount?.toLocaleString() ?? 0} 字</span>
                        <span>{stats.imageCount ?? 0} 张图片</span>
                    </div>
                )}
            </div>

            <div style={{display: 'flex', gap: 8, marginBottom: 20}}>
                <Button type="button" size="sm" onClick={() => handleCreateEntry(null)}>+ 新建词条</Button>
                <Button type="button" size="sm" variant="outline" onClick={handleOpenAi}>AI 讨论</Button>
            </div>

            <button
                type="button"
                className="mobile-list-card"
                onClick={() => handleOpenEntryList(null, '全部词条')}
                style={{marginBottom: 12}}
            >
                <span className="mobile-list-card__title">全部词条</span>
                <span className="mobile-list-card__description">浏览项目中所有词条</span>
            </button>

            {categories.length > 0 && (
                <div>
                    <h3 style={{
                        fontSize: 'var(--fc-font-size-sm)',
                        color: 'var(--fc-color-text-secondary)',
                        margin: '0 0 8px'
                    }}>
                        分类 ({categories.length})
                    </h3>
                    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
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
                </div>
            )}
        </div>
    )
}
