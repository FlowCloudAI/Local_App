import {useCallback, useMemo, useState} from 'react'
import {type EntryImage, toEntryImageSrc} from '../lib/entryImage'

export type ImageAddModalMode = 'add' | 'insert'

export default function useEntryImageState(images: EntryImage[]) {
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)
    const [imageAddModalMode, setImageAddModalMode] = useState<ImageAddModalMode | null>(null)

    const lightboxImages = useMemo(() => images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [images])

    const openImageAddModal = useCallback((mode: ImageAddModalMode) => {
        setImageAddModalMode(mode)
    }, [])

    const closeImageAddModal = useCallback(() => {
        setImageAddModalMode(null)
    }, [])

    return {
        lightboxOpen,
        setLightboxOpen,
        lightboxIndex,
        setLightboxIndex,
        lightboxImages,
        imageAddModalMode,
        openImageAddModal,
        closeImageAddModal,
    }
}
