import {Button} from 'flowcloudai-ui'
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {getImageLabel} from './MobileEntryDetailUtils'

interface MobileEntryImagesSectionProps {
    images: EntryImage[]
    onAddImage: () => void
    onOpenImage: (index: number) => void
}

export function MobileEntryImagesSection({
    images,
    onAddImage,
    onOpenImage,
}: MobileEntryImagesSectionProps) {
    return (
        <section className="mobile-entry-detail__images mobile-entry-detail__form-section">
            <div className="mobile-entry-detail__images-header">
                <div className="mobile-entry-detail__images-label">图片</div>
                <Button type="button" size="sm" variant="outline" onClick={onAddImage}>
                    + 添加图片
                </Button>
            </div>
            {images.length > 0 ? (
                <div className="mobile-entry-detail__image-grid">
                    {images.map((image, index) => {
                        const src = toEntryImageSrc(image)
                        return (
                            <button
                                type="button"
                                className="mobile-entry-detail__image-thumb"
                                key={`${image.path ?? image.url ?? index}-${index}`}
                                onClick={() => onOpenImage(index)}
                            >
                                {src ? (
                                    <img src={src} alt={getImageLabel(image, index)}/>
                                ) : (
                                    <span>无预览</span>
                                )}
                                {image.is_cover && <span className="mobile-entry-detail__image-badge">主图</span>}
                            </button>
                        )
                    })}
                </div>
            ) : (
                <div className="mobile-page__empty mobile-entry-detail__images-empty">
                    还没有图片
                </div>
            )}
        </section>
    )
}
