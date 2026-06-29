import {type PointerEvent, useEffect, useRef, useState, type WheelEvent} from 'react'
import {Button, RollingBox, useAlert} from 'flowcloudai-ui'
import {open_entry_image_path} from '../../../api'
import {Overlay} from '../../../shared/ui/overlay'
import './EntryImageLightbox.css'

const MIN_SCALE = 1
const MAX_SCALE = 5
const ZOOM_STEP = 0.2

type LightboxImage = {
    src?: string
    path?: string | null
    url?: string | null
    alt?: string | null
    is_cover?: boolean
}

interface EntryImageLightboxProps {
    open: boolean
    images: LightboxImage[]
    currentIndex: number
    infoTitle: string
    onClose: () => void
    onIndexChange: (index: number) => void
    onSetCover: (index: number) => void
    onRemove: (index: number) => void
    onAddImage?: () => void
    onInsertMarkdown?: (index: number) => void
}

function clampScale(nextScale: number) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
}

function isTextInputTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function EntryImageLightbox({
                                               open,
                                               images,
                                               currentIndex,
                                               infoTitle,
                                               onClose,
                                               onIndexChange,
                                               onSetCover,
                                               onRemove,
                                               onAddImage,
                                               onInsertMarkdown,
                                           }: EntryImageLightboxProps) {
    const {showAlert} = useAlert()
    const [viewMode, setViewMode] = useState<'preview' | 'gallery'>('preview')
    const [scale, setScale] = useState(1)
    const [offset, setOffset] = useState({x: 0, y: 0})
    const [isDragging, setIsDragging] = useState(false)
    const previewThumbRefs = useRef<Record<number, HTMLButtonElement | null>>({})
    const dragStateRef = useRef({
        pointerId: -1,
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
    })

    function resetPreviewTransform() {
        setScale(MIN_SCALE)
        setOffset({x: 0, y: 0})
        setIsDragging(false)
        dragStateRef.current.pointerId = -1
    }

    function updateScale(nextScale: number) {
        const safeScale = clampScale(nextScale)
        setScale(safeScale)
        if (safeScale === MIN_SCALE) {
            setOffset({x: 0, y: 0})
            setIsDragging(false)
            dragStateRef.current.pointerId = -1
        }
    }

    useEffect(() => {
        if (open) queueMicrotask(() => setViewMode('preview'))
    }, [open])

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => resetPreviewTransform())
    }, [open, currentIndex])

    useEffect(() => {
        if (viewMode !== 'preview') {
            queueMicrotask(() => resetPreviewTransform())
        }
    }, [viewMode])

    useEffect(() => {
        if (!open || viewMode !== 'preview') return
        const currentThumb = previewThumbRefs.current[currentIndex]
        if (!currentThumb) return
        const rafId = window.requestAnimationFrame(() => {
            currentThumb.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center',
            })
        })
        return () => window.cancelAnimationFrame(rafId)
    }, [open, viewMode, currentIndex])

    useEffect(() => {
        if (!open || viewMode !== 'preview') return

        function resetByKeyboard() {
            setScale(MIN_SCALE)
            setOffset({x: 0, y: 0})
            setIsDragging(false)
            dragStateRef.current.pointerId = -1
        }

        function zoomByKeyboard(delta: number) {
            setScale((current) => {
                const safeScale = clampScale(current + delta)
                if (safeScale === MIN_SCALE) {
                    setOffset({x: 0, y: 0})
                    setIsDragging(false)
                    dragStateRef.current.pointerId = -1
                }
                return safeScale
            })
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
            if (isTextInputTarget(event.target)) return

            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && images.length > 1) {
                event.preventDefault()
                const direction = event.key === 'ArrowLeft' ? -1 : 1
                onIndexChange((currentIndex + images.length + direction) % images.length)
                return
            }

            if (event.key === '0' || event.code === 'Numpad0') {
                event.preventDefault()
                resetByKeyboard()
                return
            }

            if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
                event.preventDefault()
                zoomByKeyboard(ZOOM_STEP)
                return
            }

            if (event.key === '-' || event.code === 'NumpadSubtract') {
                event.preventDefault()
                zoomByKeyboard(-ZOOM_STEP)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [currentIndex, images.length, onIndexChange, open, viewMode])

    if (!open || images.length === 0) return null

    const currentImage = images[currentIndex]

    async function handleRemoveClick() {
        const result = await showAlert('确认移除这张图片？', 'warning', 'confirm')
        if (result !== 'yes') return
        onRemove(currentIndex)
    }

    async function handleOpenLocalPath() {
        const rawPath = currentImage?.path
        if (!rawPath) {
            void showAlert('当前图片没有可打开的本地路径', 'warning')
            return
        }
        try {
            await open_entry_image_path(String(rawPath))
        } catch (error) {
            void showAlert(`打开图片失败: ${String(error)}`, 'error')
        }
    }

    function handleZoomIn() {
        updateScale(scale + ZOOM_STEP)
    }

    function handleZoomOut() {
        updateScale(scale - ZOOM_STEP)
    }

    function handleWheelZoom(event: WheelEvent<HTMLDivElement>) {
        if (!currentImage?.src) return
        event.preventDefault()
        const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
        updateScale(scale + delta)
    }

    function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
        if (scale <= MIN_SCALE) return
        dragStateRef.current.pointerId = event.pointerId
        dragStateRef.current.startX = event.clientX
        dragStateRef.current.startY = event.clientY
        dragStateRef.current.startOffsetX = offset.x
        dragStateRef.current.startOffsetY = offset.y
        setIsDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
        if (!isDragging) return
        if (dragStateRef.current.pointerId !== event.pointerId) return
        const nextX = dragStateRef.current.startOffsetX + (event.clientX - dragStateRef.current.startX)
        const nextY = dragStateRef.current.startOffsetY + (event.clientY - dragStateRef.current.startY)
        setOffset({x: nextX, y: nextY})
    }

    function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
        if (dragStateRef.current.pointerId !== event.pointerId) return
        dragStateRef.current.pointerId = -1
        setIsDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    function renderThumbItems(isWrapMode = false) {
        return (
            <div className={`entry-editor-lightbox__thumbs${isWrapMode ? ' entry-editor-lightbox__thumbs--wrap' : ''}`}>
                {images.map((image, index) => (
                    <button
                        key={`${image.path ?? image.url ?? index}-${index}`}
                        type="button"
                        className={`entry-editor-lightbox__thumb${index === currentIndex ? ' active' : ''}`}
                        ref={isWrapMode ? undefined : (element) => {
                            previewThumbRefs.current[index] = element
                        }}
                        onClick={() => {
                            onIndexChange(index)
                            if (viewMode === 'gallery') setViewMode('preview')
                        }}
                    >
                        <div className="entry-editor-lightbox__thumb-media">
                            {image.src ? (
                                <img
                                    src={image.src}
                                    alt={image.alt || `${infoTitle} ${index + 1}`}
                                    loading="lazy"
                                    decoding="async"
                                />
                            ) : (
                                <span className="entry-editor-lightbox__thumb-empty">{index + 1}</span>
                            )}
                        </div>
                    </button>
                ))}
                <button
                    type="button"
                    className="entry-editor-lightbox__thumb entry-editor-lightbox__thumb--add"
                    onClick={() => onAddImage?.()}
                    disabled={!onAddImage}
                >
                    <div className="entry-editor-lightbox__thumb-media entry-editor-lightbox__thumb-media--add">
                        <span className="entry-editor-lightbox__thumb-plus">+</span>
                        <span className="entry-editor-lightbox__thumb-add-label">添加图片</span>
                    </div>
                </button>
            </div>
        )
    }

    function renderImageRail() {
        return (
            <RollingBox
                className="entry-editor-lightbox__gallery"
                axis="x"
                thumbSize="thin"
            >
                {renderThumbItems()}
            </RollingBox>
        )
    }

    function renderGalleryGrid() {
        return (
            <div className="entry-editor-lightbox__gallery-grid">
                {renderThumbItems(true)}
            </div>
        )
    }

    return (
        <Overlay
            open={open}
            onClose={onClose}
            className="entry-editor-lightbox"
            ariaLabel={`${infoTitle} 图片浏览`}
        >
            <div className="entry-editor-lightbox__dialog">
                <div className="entry-editor-lightbox__toolbar">
                    <div className="entry-editor-lightbox__meta">
                        <span>{currentIndex + 1} / {images.length}</span>
                        {currentImage?.is_cover && <span className="entry-editor-lightbox__badge">主图</span>}
                    </div>
                    <div className="entry-editor-lightbox__actions">
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setViewMode((current) => current === 'preview' ? 'gallery' : 'preview')}
                        >
                            {viewMode === 'preview' ? '缩略图' : '大图预览'}
                        </Button>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onSetCover(currentIndex)}
                        >
                            设为主图
                        </Button>
                        {onInsertMarkdown && (
                            <Button type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onInsertMarkdown(currentIndex)}
                            >
                                插入正文
                            </Button>
                        )}
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleZoomOut()}
                            disabled={!currentImage?.src || scale <= MIN_SCALE}
                        >
                            缩小
                        </Button>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateScale(MIN_SCALE)}
                            disabled={!currentImage?.src || scale === MIN_SCALE}
                        >
                            100%
                        </Button>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleZoomIn()}
                            disabled={!currentImage?.src || scale >= MAX_SCALE}
                        >
                            放大
                        </Button>
                        <span>{Math.round(scale * 100)}%</span>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleOpenLocalPath()}
                        >
                            打开所在文件夹
                        </Button>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRemoveClick()}
                        >
                            移除
                        </Button>
                        <Button type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                        >
                            关闭
                        </Button>
                    </div>
                </div>

                {viewMode === 'preview' ? (
                    <>
                        <div className="entry-editor-lightbox__main">
                            {currentImage?.src ? (
                                <div
                                    className={`entry-editor-lightbox__zoom-surface${scale > MIN_SCALE ? ' entry-editor-lightbox__zoom-surface--zoomable' : ''}${isDragging ? ' entry-editor-lightbox__zoom-surface--dragging' : ''}`}
                                    onWheel={handleWheelZoom}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                    onDoubleClick={() => {
                                        if (scale > MIN_SCALE) {
                                            updateScale(MIN_SCALE)
                                        } else {
                                            updateScale(2)
                                        }
                                    }}
                                >
                                    <img
                                        src={currentImage.src}
                                        alt={currentImage.alt || infoTitle}
                                        className="entry-editor-lightbox__image"
                                        style={{
                                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                                        }}
                                        decoding="async"
                                        draggable={false}
                                    />
                                </div>
                            ) : (
                                <div className="entry-editor-lightbox__empty">图片路径不可预览</div>
                            )}
                        </div>
                        {renderImageRail()}
                    </>
                ) : (
                    <div className="entry-editor-lightbox__gallery-view">
                        {renderGalleryGrid()}
                    </div>
                )}
            </div>
        </Overlay>
    )
}
