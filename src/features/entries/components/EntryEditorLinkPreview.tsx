import type {RefObject} from 'react'
import type {Entry} from '../../../api'
import {getCoverImage, normalizeEntryImages, toEntryImageSrc} from '../lib/entryImage'

interface EntryEditorLinkPreviewProps {
    linkPreview: { title: string; entryId: string | null } | null
    linkPreviewPosition: { top: number; left: number }
    linkPreviewEntry: Entry | null
    panelRef: RefObject<HTMLDivElement | null>
    anchorRef: RefObject<HTMLAnchorElement | null>
    onClearCloseTimer: () => void
    onScheduleClose: () => void
}

export default function EntryEditorLinkPreview({
                                                   linkPreview,
                                                   linkPreviewPosition,
                                                   linkPreviewEntry,
                                                   panelRef,
                                                   anchorRef,
                                                   onClearCloseTimer,
                                                   onScheduleClose,
                                               }: EntryEditorLinkPreviewProps) {
    if (!linkPreview) return null

    return (
        <div
            ref={panelRef}
            className="entry-editor-link-preview"
            style={{
                top: `${linkPreviewPosition.top}px`,
                left: `${linkPreviewPosition.left}px`,
            }}
            onMouseEnter={onClearCloseTimer}
            onMouseLeave={(e) => {
                const relatedTarget = e.relatedTarget
                if (
                    relatedTarget instanceof Node
                    && anchorRef.current?.contains(relatedTarget)
                ) {
                    return
                }
                onScheduleClose()
            }}
        >
            <div className="entry-editor-link-preview__header">
                <span>双链预览</span>
                <span>单击相关词条以进入</span>
            </div>

            {linkPreviewEntry ? (
                <div className="entry-editor-link-preview__body">
                    <div className="entry-editor-link-preview__media">
                        {(() => {
                            const previewCoverSrc = toEntryImageSrc(getCoverImage(normalizeEntryImages(linkPreviewEntry.images)))
                            return previewCoverSrc ? (
                                <img src={previewCoverSrc} alt={linkPreviewEntry.title}/>
                            ) : (
                                <div className="entry-editor-link-preview__placeholder">
                                    {linkPreviewEntry.title[0] ?? '词'}
                                </div>
                            )
                        })()}
                    </div>
                    <div className="entry-editor-link-preview__content">
                        <h3>{linkPreviewEntry.title}</h3>
                        <p className="entry-editor-link-preview__summary">
                            {linkPreviewEntry.summary || '暂无摘要'}
                        </p>
                        <p className="entry-editor-link-preview__hint">单击相关词条以进入</p>
                    </div>
                </div>
            ) : (
                <div className="entry-editor-link-preview__empty">
                    当前项目中没有找到名为“{linkPreview.title}”的词条。
                </div>
            )}
        </div>
    )
}
