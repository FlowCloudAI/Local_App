/**
 * 词条图片浏览器：统一桌面端与移动端的预览、画廊、缩放和图片管理入口。
 * 图片数据仍由词条编辑器持有，本组件只负责当前选择与交互呈现。
 */
import {type PointerEvent, useEffect, useRef, useState, type WheelEvent} from 'react'
import {Button, RollingBox, Slider, useAlert} from 'flowcloudai-ui'
import {open_entry_image_path} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import ActionMenu from '../../../shared/ui/overlay/ActionMenu'
import './EntryImageLightbox.css'

const MIN_SCALE = 0.8
const FIT_SCALE = 1
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
    onSetCover?: (index: number) => void
    onRemove?: (index: number) => void
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
    const [scale, setScale] = useState(FIT_SCALE)
    const [offset, setOffset] = useState({x: 0, y: 0})
    const [isDragging, setIsDragging] = useState(false)
    const [moreMenuOpen, setMoreMenuOpen] = useState(false)
    const previewThumbRefs = useRef<Record<number, HTMLButtonElement | null>>({})
    const dragStateRef = useRef({
        pointerId: -1,
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
    })

    const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(0, images.length - 1))
    const currentImage = images[safeIndex]

    function resetPreviewTransform() {
        setScale(FIT_SCALE)
        setOffset({x: 0, y: 0})
        setIsDragging(false)
        dragStateRef.current.pointerId = -1
    }

    function updateScale(nextScale: number) {
        const safeScale = clampScale(nextScale)
        setScale(safeScale)
        if (safeScale <= FIT_SCALE) {
            setOffset({x: 0, y: 0})
            setIsDragging(false)
            dragStateRef.current.pointerId = -1
        }
    }

    function selectImage(index: number) {
        onIndexChange((index + images.length) % images.length)
    }

    useEffect(() => {
        if (!open) return
        if (images.length === 0) {
            queueMicrotask(onClose)
            return
        }
        if (safeIndex !== currentIndex) {
            queueMicrotask(() => onIndexChange(safeIndex))
        }
    }, [currentIndex, images.length, onClose, onIndexChange, open, safeIndex])

    useEffect(() => {
        if (open) queueMicrotask(() => setViewMode('preview'))
    }, [open])

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            resetPreviewTransform()
            setMoreMenuOpen(false)
        })
    }, [open, currentIndex])

    useEffect(() => {
        if (viewMode !== 'preview') {
            queueMicrotask(() => resetPreviewTransform())
        }
    }, [viewMode])

    useEffect(() => {
        if (!open || viewMode !== 'preview') return
        const currentThumb = previewThumbRefs.current[safeIndex]
        if (!currentThumb) return
        const rafId = window.requestAnimationFrame(() => {
            currentThumb.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center',
            })
        })
        return () => window.cancelAnimationFrame(rafId)
    }, [open, safeIndex, viewMode])

    useEffect(() => {
        if (!open || viewMode !== 'preview') return

        function handleKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
            if (isTextInputTarget(event.target)) return

            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && images.length > 1) {
                event.preventDefault()
                const direction = event.key === 'ArrowLeft' ? -1 : 1
                onIndexChange((safeIndex + images.length + direction) % images.length)
                return
            }

            if (event.key === '0' || event.code === 'Numpad0') {
                event.preventDefault()
                setScale(FIT_SCALE)
                setOffset({x: 0, y: 0})
                setIsDragging(false)
                dragStateRef.current.pointerId = -1
                return
            }

            if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
                event.preventDefault()
                setScale((current) => clampScale(current + ZOOM_STEP))
                return
            }

            if (event.key === '-' || event.code === 'NumpadSubtract') {
                event.preventDefault()
                setScale((current) => {
                    const nextScale = clampScale(current - ZOOM_STEP)
                    if (nextScale <= FIT_SCALE) {
                        setOffset({x: 0, y: 0})
                        setIsDragging(false)
                        dragStateRef.current.pointerId = -1
                    }
                    return nextScale
                })
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [images.length, onIndexChange, open, safeIndex, viewMode])

    if (!open || images.length === 0) return null

    const canSetCover = Boolean(onSetCover && !currentImage?.is_cover)
    const showSetCoverAsPrimary = canSetCover && !onInsertMarkdown
    const hasMoreActions = Boolean(
        (canSetCover && onInsertMarkdown)
        || currentImage?.path
        || onRemove,
    )

    async function handleRemoveClick() {
        if (!onRemove) return
        const result = await showAlert('确认移除这张图片？', 'warning', 'confirm')
        if (result !== 'yes') return
        onRemove(safeIndex)
    }

    async function handleOpenLocalPath() {
        const rawPath = currentImage?.path
        if (!rawPath) return
        try {
            await open_entry_image_path(String(rawPath))
        } catch (error) {
            void showAlert(`打开图片失败: ${String(error)}`, 'error')
        }
    }

    function handleWheelZoom(event: WheelEvent<HTMLDivElement>) {
        if (!currentImage?.src) return
        event.preventDefault()
        updateScale(scale + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
    }

    function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
        if (scale <= FIT_SCALE) return
        dragStateRef.current.pointerId = event.pointerId
        dragStateRef.current.startX = event.clientX
        dragStateRef.current.startY = event.clientY
        dragStateRef.current.startOffsetX = offset.x
        dragStateRef.current.startOffsetY = offset.y
        setIsDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
        if (!isDragging || dragStateRef.current.pointerId !== event.pointerId) return
        setOffset({
            x: dragStateRef.current.startOffsetX + (event.clientX - dragStateRef.current.startX),
            y: dragStateRef.current.startOffsetY + (event.clientY - dragStateRef.current.startY),
        })
    }

    function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
        if (dragStateRef.current.pointerId !== event.pointerId) return
        dragStateRef.current.pointerId = -1
        setIsDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    function renderImageThumb(image: LightboxImage, index: number) {
        const active = index === safeIndex
        const label = `${image.alt || infoTitle}，第 ${index + 1} 张${image.is_cover ? '，主图' : ''}`
        return (
            <button
                key={`${image.path ?? image.url ?? index}-${index}`}
                type="button"
                className={`entry-editor-lightbox__thumb${active ? ' is-active' : ''}`}
                ref={(element) => {
                    previewThumbRefs.current[index] = element
                }}
                aria-current={active ? 'true' : undefined}
                aria-label={label}
                onClick={() => {
                    selectImage(index)
                    if (viewMode === 'gallery') setViewMode('preview')
                }}
            >
                <span className="entry-editor-lightbox__thumb-media">
                    {image.src ? (
                        <img
                            src={image.src}
                            alt=""
                            loading="lazy"
                            decoding="async"
                        />
                    ) : (
                        <span className="entry-editor-lightbox__thumb-empty">{index + 1}</span>
                    )}
                </span>
            </button>
        )
    }

    function renderImageRail() {
        return (
            <RollingBox
                className="entry-editor-lightbox__rail"
                axis="x"
                thumbSize="thin"
            >
                <div className="entry-editor-lightbox__thumbs">
                    {images.map(renderImageThumb)}
                    {onAddImage && (
                        <button
                            type="button"
                            className="entry-editor-lightbox__thumb entry-editor-lightbox__thumb--add"
                            onClick={onAddImage}
                        >
                            添加图片
                        </button>
                    )}
                </div>
            </RollingBox>
        )
    }

    function renderGalleryGrid() {
        return (
            <div className="entry-editor-lightbox__gallery-grid">
                {images.map((image, index) => {
                    const active = index === safeIndex
                    return (
                        <button
                            key={`${image.path ?? image.url ?? index}-${index}`}
                            type="button"
                            className={`entry-editor-lightbox__gallery-card${active ? ' is-active' : ''}`}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => {
                                selectImage(index)
                                setViewMode('preview')
                            }}
                        >
                            <span className="entry-editor-lightbox__gallery-media">
                                {image.src ? (
                                    <img
                                        src={image.src}
                                        alt={image.alt || `${infoTitle} ${index + 1}`}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                ) : (
                                    <span>图片路径不可预览</span>
                                )}
                            </span>
                            <span className="entry-editor-lightbox__gallery-caption">
                                <span>{index + 1} / {images.length}</span>
                                {image.is_cover && <span className="entry-editor-lightbox__badge">主图</span>}
                            </span>
                        </button>
                    )
                })}
                {onAddImage && (
                    <button
                        type="button"
                        className="entry-editor-lightbox__gallery-card entry-editor-lightbox__gallery-card--add"
                        onClick={onAddImage}
                    >
                        添加图片
                    </button>
                )}
            </div>
        )
    }

    const moreMenuItems = [
        ...(canSetCover && onInsertMarkdown ? [{
            key: 'set-cover',
            label: '设为主图',
            onSelect: () => onSetCover?.(safeIndex),
        }] : []),
        ...(currentImage?.path ? [{
            key: 'open-folder',
            label: '打开所在文件夹',
            onSelect: () => void handleOpenLocalPath(),
        }] : []),
        ...(onRemove ? [{
            key: 'remove-image',
            label: '移除图片',
            danger: true,
            onSelect: () => void handleRemoveClick(),
        }] : []),
    ]

    return (
        <>
            <FloatingPanel
                open={open}
                onClose={onClose}
                layerClassName="entry-editor-lightbox-layer"
                className="entry-editor-lightbox"
                closeLabel="关闭图片浏览"
                title={(
                    <div className="entry-editor-lightbox__identity">
                        <span className="entry-editor-lightbox__identity-title">{infoTitle} · 图片</span>
                        <span className="entry-editor-lightbox__count">
                            {safeIndex + 1} / {images.length}
                        </span>
                        {currentImage?.is_cover && <span className="entry-editor-lightbox__badge">主图</span>}
                    </div>
                )}
            >
            <section className="entry-editor-lightbox__dialog">
                <div className="entry-editor-lightbox__toolbar">
                    <div className="entry-editor-lightbox__view-switch" role="group" aria-label="浏览模式">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            radius="full"
                            aria-pressed={viewMode === 'preview'}
                            onClick={() => setViewMode('preview')}
                        >
                            预览
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            radius="full"
                            aria-pressed={viewMode === 'gallery'}
                            onClick={() => setViewMode('gallery')}
                        >
                            画廊
                        </Button>
                    </div>

                    {viewMode === 'preview' && currentImage?.src && (
                        <div className="entry-editor-lightbox__zoom-controls" role="group" aria-label="缩放控制">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="entry-editor-lightbox__zoom-value"
                                title="恢复适应窗口"
                                onClick={() => updateScale(FIT_SCALE)}
                            >
                                {Math.round(scale * 100)}%
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label="缩小图片"
                                onClick={() => updateScale(scale - ZOOM_STEP)}
                                disabled={scale <= MIN_SCALE}
                            >
                                −
                            </Button>
                            <Slider
                                className="entry-editor-lightbox__zoom-slider"
                                value={scale}
                                min={MIN_SCALE}
                                max={MAX_SCALE}
                                step={ZOOM_STEP}
                                aria-label="图片缩放比例"
                                onValueChange={(value) => updateScale(Array.isArray(value) ? value[1] : value)}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label="放大图片"
                                onClick={() => updateScale(scale + ZOOM_STEP)}
                                disabled={scale >= MAX_SCALE}
                            >
                                ＋
                            </Button>
                        </div>
                    )}

                    <div className="entry-editor-lightbox__header-actions">
                        {onInsertMarkdown && (
                            <Button
                                type="button"
                                size="sm"
                                radius="full"
                                onClick={() => onInsertMarkdown(safeIndex)}
                            >
                                插入正文
                            </Button>
                        )}
                        {showSetCoverAsPrimary && (
                            <Button
                                type="button"
                                size="sm"
                                radius="full"
                                onClick={() => onSetCover?.(safeIndex)}
                            >
                                设为主图
                            </Button>
                        )}
                        {hasMoreActions && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                radius="full"
                                onClick={() => setMoreMenuOpen(true)}
                            >
                                更多
                            </Button>
                        )}
                    </div>
                </div>

                <main className="entry-editor-lightbox__stage">
                    {viewMode === 'preview' ? (
                        <>
                            {images.length > 1 && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="entry-editor-lightbox__previous"
                                    aria-label="上一张"
                                    title="上一张"
                                    onClick={() => selectImage(safeIndex - 1)}
                                >
                                    <span aria-hidden="true">‹</span>
                                </Button>
                            )}

                            {currentImage?.src ? (
                                <div
                                    className={`entry-editor-lightbox__zoom-surface${scale > FIT_SCALE ? ' is-zoomable' : ''}${isDragging ? ' is-dragging' : ''}`}
                                    tabIndex={0}
                                    aria-label={`图片预览，第 ${safeIndex + 1} 张。方向键切换图片，加减号缩放，数字 0 恢复适应。`}
                                    onWheel={handleWheelZoom}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                    onDoubleClick={() => updateScale(scale > FIT_SCALE ? FIT_SCALE : 2)}
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

                            {images.length > 1 && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="entry-editor-lightbox__next"
                                    aria-label="下一张"
                                    title="下一张"
                                    onClick={() => selectImage(safeIndex + 1)}
                                >
                                    <span aria-hidden="true">›</span>
                                </Button>
                            )}
                        </>
                    ) : renderGalleryGrid()}
                </main>

                {viewMode === 'preview' && renderImageRail()}

                <span className="entry-editor-lightbox__live" aria-live="polite">
                    第 {safeIndex + 1} 张，共 {images.length} 张；缩放 {Math.round(scale * 100)}%
                </span>
            </section>
            </FloatingPanel>
            <ActionMenu
                open={moreMenuOpen}
                onClose={() => setMoreMenuOpen(false)}
                title={`${infoTitle} · 图片操作`}
                ariaLabel="图片操作"
                items={moreMenuItems}
            />
        </>
    )
}
