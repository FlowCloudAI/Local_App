/**
 * 项目无图片时的共享默认封面。
 * 组件只输出轻量 DOM，连续线稿由单个静态 SVG 遮罩复用，避免逐卡生成或解码位图。
 */
import {getDefaultCoverTheme, getMeaningfulCoverMark} from '../../shared/lib/defaultCover'
import './ProjectDefaultCover.css'

interface ProjectDefaultCoverProps {
    projectId: string
    projectName: string
    className?: string
    variant?: 'card' | 'hero'
}

export default function ProjectDefaultCover({
    projectId,
    projectName,
    className,
    variant = 'card',
}: ProjectDefaultCoverProps) {
    const theme = getDefaultCoverTheme(projectId)
    const classes = [
        'fc-default-cover',
        `fc-default-cover--${variant}`,
        className,
    ].filter(Boolean).join(' ')

    return (
        <div
            className={classes}
            data-palette={theme.palette}
            data-composition={theme.composition}
            aria-hidden="true"
        >
            {variant === 'hero' ? (
                <span className="fc-default-cover__copy">
                    <small>世界观项目</small>
                    <strong>{projectName}</strong>
                </span>
            ) : null}
            <span className="fc-default-cover__mark">
                {getMeaningfulCoverMark(projectName, '世')}
            </span>
        </div>
    )
}
