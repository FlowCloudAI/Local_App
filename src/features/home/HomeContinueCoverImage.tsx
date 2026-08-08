/**
 * 首页继续创作封面：两端统一优先复用词条主图，其次复用项目主图。
 * 图片加载与缩略图修复继续交给现有领域组件，本组件只负责选择顺序和默认封面。
 */
import type {Entry, Project} from '../../api'
import EntryCoverImage from '../entries/components/EntryCoverImage'
import {getCoverImage, normalizeEntryImages} from '../entries/lib/entryImage'
import ProjectCoverImage from '../projects/components/ProjectCoverImage'
import ProjectDefaultCover from '../projects/ProjectDefaultCover'
import {getHomeTargetProjectId, type HomeActivityTarget} from './homeActivity'

interface HomeContinueCoverImageProps {
    target: HomeActivityTarget
    project?: Project | null
    entry?: Entry | null
    eager?: boolean
}

export default function HomeContinueCoverImage({
    target,
    project,
    entry,
    eager = false,
}: HomeContinueCoverImageProps) {
    const projectId = project?.id ?? getHomeTargetProjectId(target) ?? target.id
    const projectName = project?.name ?? target.subtitle ?? target.title
    const defaultCover = (
        <ProjectDefaultCover projectId={projectId} projectName={projectName} variant="hero"/>
    )
    const projectCover = project?.cover_path ? (
        <ProjectCoverImage
            projectId={projectId}
            coverPath={project.cover_path}
            alt={projectName}
            eager={eager}
            fallback={defaultCover}
        />
    ) : defaultCover
    const entryCover = getCoverImage(normalizeEntryImages(entry?.images))
    const entryCoverPath = entryCover?.url || entryCover?.path

    if (!entry || !entryCoverPath) return projectCover

    return (
        <EntryCoverImage
            className="fc-card__image"
            projectId={projectId}
            entryId={entry.id}
            cover={entryCoverPath}
            alt={entry.title}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fallback={projectCover}
        />
    )
}
