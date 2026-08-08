/** 项目封面缩略图：在卡片接近视口时按需生成，详情页仍保留原始封面。 */
import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import {db_ensure_project_cover_thumbnail} from '../../../api'
import {toProjectImageSrc} from '../projectDisplay'

interface ProjectCoverImageProps {
    projectId: string
    coverPath: string
    alt: string
    fallback: ReactNode
    eager?: boolean
}

const DIRECT_IMAGE_RE = /^(https?:|data:|blob:|asset:|fcimg:)/i

export default function ProjectCoverImage({
    projectId,
    coverPath,
    alt,
    fallback,
    eager = false,
}: ProjectCoverImageProps) {
    const hostRef = useRef<HTMLSpanElement>(null)
    const directSrc = useMemo(
        () => DIRECT_IMAGE_RE.test(coverPath) ? toProjectImageSrc(coverPath) : undefined,
        [coverPath],
    )
    const [shouldLoad, setShouldLoad] = useState(eager)
    const [src, setSrc] = useState<string | undefined>(directSrc)

    useEffect(() => {
        setSrc(directSrc)
    }, [coverPath, directSrc, projectId])

    useEffect(() => {
        if (eager) setShouldLoad(true)
    }, [eager])

    useEffect(() => {
        if (eager || directSrc || shouldLoad) return
        const host = hostRef.current
        if (!host || typeof IntersectionObserver === 'undefined') {
            setShouldLoad(true)
            return
        }

        const observer = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting) return
            setShouldLoad(true)
            observer.disconnect()
        }, {rootMargin: '256px 0px'})
        observer.observe(host)
        return () => observer.disconnect()
    }, [directSrc, eager, shouldLoad])

    useEffect(() => {
        if (!shouldLoad || directSrc) return
        let cancelled = false
        void db_ensure_project_cover_thumbnail(projectId)
            .then(path => {
                if (!cancelled) setSrc(toProjectImageSrc(path ?? undefined))
            })
            .catch(() => {
                if (!cancelled) setSrc(undefined)
            })
        return () => {
            cancelled = true
        }
    }, [coverPath, directSrc, projectId, shouldLoad])

    return (
        <span ref={hostRef} style={{display: 'block', width: '100%', height: '100%'}}>
            {src ? (
                <img
                    className="fc-card__image"
                    src={src}
                    alt={alt}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    onError={() => setSrc(undefined)}
                />
            ) : fallback}
        </span>
    )
}
