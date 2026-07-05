import {
    type ImgHTMLAttributes,
    type ReactNode,
    type SyntheticEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {convertFileSrc} from '../../../api/assets'
import {db_ensure_entry_cover_thumbnail} from '../../../api'
import {logger} from '../../../shared/logger'

const failedCovers = new Set<string>()

function toEntryCoverSrc(cover?: string | null): string | undefined {
    if (!cover) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(cover)) return cover
    return convertFileSrc(String(cover), 'fcimg')
}

function withCacheBuster(src: string): string {
    return `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`
}

interface EntryCoverImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    projectId: string
    entryId: string
    cover?: string | null
    fallback: ReactNode
}

export default function EntryCoverImage({
                                            projectId,
                                            entryId,
                                            cover,
                                            fallback,
                                            onError,
                                            ...imgProps
                                        }: EntryCoverImageProps) {
    const initialSrc = useMemo(() => toEntryCoverSrc(cover), [cover])
    const [src, setSrc] = useState(initialSrc)
    const [failed, setFailed] = useState(false)
    const triedRef = useRef(false)

    useEffect(() => {
        setSrc(initialSrc)
        setFailed(false)
        triedRef.current = false
    }, [initialSrc])

    const handleError = async (event: SyntheticEvent<HTMLImageElement>) => {
        onError?.(event)
        if (!cover || triedRef.current) {
            setFailed(true)
            return
        }

        const cacheKey = `${projectId}:${entryId}:${cover}`
        triedRef.current = true
        if (failedCovers.has(cacheKey)) {
            setFailed(true)
            return
        }

        try {
            const nextCover = await db_ensure_entry_cover_thumbnail(projectId, entryId)
            const nextSrc = toEntryCoverSrc(nextCover)
            if (nextSrc) {
                setSrc(withCacheBuster(nextSrc))
                return
            }
        } catch (error) {
            logger.warn('生成词条封面缩略图失败', {projectId, entryId, cover, error})
        }

        failedCovers.add(cacheKey)
        setFailed(true)
    }

    if (!src || failed) return <>{fallback}</>

    return (
        <img
            {...imgProps}
            src={src}
            onError={(event) => void handleError(event)}
        />
    )
}
