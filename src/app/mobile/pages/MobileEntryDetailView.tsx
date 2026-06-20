import MarkdownPreview from '@uiw/react-markdown-preview'
import {type CSSProperties, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction} from 'react'
import {TagItem} from 'flowcloudai-ui'
import {
    type Entry,
    type EntryBrief,
    type EntryLink,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {getComparableTagValue} from '../../../features/entries/lib/entryTag'
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {type EntryRelationDraft} from '../../../features/project-editor/components/EntryRelationCreator'
import {
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {buildExcerpt, getImageLabel, type TagValueMap} from './MobileEntryDetailUtils'

interface MobileEntryDetailViewProps {
    pageRef: RefObject<HTMLDivElement | null>
    topActionsRef: RefObject<HTMLDivElement | null>
    entry: Entry
    entryType: EntryTypeView | null
    typeBadgeStyle?: CSSProperties
    viewTagSchemas: TagSchema[]
    viewTagMap: TagValueMap
    viewImages: EntryImage[]
    viewMarkdownSource: string
    viewRelationDrafts: EntryRelationDraft[]
    hasConnections: boolean
    outgoingLinks: EntryLink[]
    incomingLinks: EntryLink[]
    entryBriefById: Map<string, EntryBrief>
    colorMode: 'light' | 'dark'
    menuOpen: boolean
    setMenuOpen: Dispatch<SetStateAction<boolean>>
    onBack: () => void
    onAiDiscuss: () => void
    onEdit: () => void
    onDelete: () => void
    onOpenLinkedEntry: (entryId: string) => void
    onMarkdownClick: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function MobileEntryDetailView({
    pageRef,
    topActionsRef,
    entry,
    entryType,
    typeBadgeStyle,
    viewTagSchemas,
    viewTagMap,
    viewImages,
    viewMarkdownSource,
    viewRelationDrafts,
    hasConnections,
    outgoingLinks,
    incomingLinks,
    entryBriefById,
    colorMode,
    menuOpen,
    setMenuOpen,
    onBack,
    onAiDiscuss,
    onEdit,
    onDelete,
    onOpenLinkedEntry,
    onMarkdownClick,
}: MobileEntryDetailViewProps) {
    const entryMenuItems: MobileAnchoredMenuItem[] = [
        {
            key: 'delete',
            label: '删除词条',
            description: '永久删除当前词条',
            icon: <MobileEntryDetailActionIcon type="delete"/>,
            danger: true,
            onSelect: () => onDelete(),
        },
    ]

    return (
        <div ref={pageRef} className="mobile-page mobile-entry-detail">
            <MobilePageTopBar
                className="mobile-entry-detail__view-topbar"
                sticky
                edgeToEdge
                ariaLabel="词条查看操作"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        onClick: onBack,
                    }]}
                />}
                right={<MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'ai',
                            label: 'AI 讨论',
                            icon: <MobileEntryDetailActionIcon type="ai"/>,
                            onClick: onAiDiscuss,
                        },
                        {
                            key: 'edit',
                            label: '编辑词条',
                            icon: <MobileEntryDetailActionIcon type="edit"/>,
                            kind: 'add',
                            onClick: onEdit,
                        },
                        {
                            key: 'menu',
                            label: '更多操作',
                            icon: <MobileEntryDetailActionIcon type="more"/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        },
                    ]}
                />}
            />

            <h1 className="mobile-entry-detail__title">
                {entry.title}
            </h1>

            {entry.summary && (
                <p className="mobile-entry-detail__summary">
                    {entry.summary}
                </p>
            )}

            {entryType && (
                <div className="mobile-entry-detail__type">
                    <span className="mobile-entry-detail__type-badge" style={typeBadgeStyle}>
                        <EntryTypeIcon entryType={entryType} className=""/> {entryType.name}
                    </span>
                </div>
            )}

            {viewTagSchemas.length > 0 && (
                <div className="mobile-entry-detail__tags mobile-entry-detail__tags--view">
                    {viewTagSchemas.map(s => (
                        <TagItem
                            key={s.id}
                            schema={{id: s.id, name: s.name, type: s.type as 'number' | 'string' | 'boolean', range_min: s.range_min ?? null, range_max: s.range_max ?? null}}
                            value={getComparableTagValue(viewTagMap, s) ?? undefined}
                            mode="show"
                        />
                    ))}
                </div>
            )}

            {viewImages.length > 0 && (
                <div className="mobile-entry-detail__images mobile-entry-detail__images--view">
                    <div className="mobile-entry-detail__image-grid">
                        {viewImages.map((image, index) => {
                            const src = toEntryImageSrc(image)
                            return (
                                <div className="mobile-entry-detail__image-thumb mobile-entry-detail__image-thumb--static" key={`${image.path ?? image.url ?? index}-${index}`}>
                                    {src ? (
                                        <img src={src} alt={getImageLabel(image, index)}/>
                                    ) : (
                                        <span>无预览</span>
                                    )}
                                    {image.is_cover && <span className="mobile-entry-detail__image-badge">主图</span>}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {entry.content ? (
                <div className="mobile-entry-detail__markdown" data-color-mode={colorMode} onClick={onMarkdownClick}>
                    <MarkdownPreview
                        source={viewMarkdownSource}
                        className="mobile-entry-detail__markdown-preview"
                        wrapperElement={{'data-color-mode': colorMode}}
                    />
                </div>
            ) : (
                <div className="mobile-page__empty mobile-entry-detail__empty">
                    暂无正文内容
                </div>
            )}

            {hasConnections && (
                <div className="mobile-entry-detail__connections">
                    <h3 className="mobile-entry-detail__section-title">关联</h3>
                    {viewRelationDrafts.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">结构化关系</div>
                            {viewRelationDrafts.map((relation, index) => {
                                const target = relation.otherEntryId ? entryBriefById.get(relation.otherEntryId) : null
                                const directionLabel = relation.direction === 'two_way'
                                    ? '双向'
                                    : relation.direction === 'incoming' ? '来自对方' : '指向对方'
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={relation.id ?? `relation-${index}`}
                                        disabled={!target}
                                        onClick={() => relation.otherEntryId && onOpenLinkedEntry(relation.otherEntryId)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {target?.title ?? '词条不存在或已删除'}
                                        </span>
                                        <span className="mobile-entry-detail__connection-meta">
                                            {directionLabel}{relation.content ? ` · ${relation.content}` : ''}
                                        </span>
                                        {target?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(target.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    {outgoingLinks.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">正文提到</div>
                            {outgoingLinks.map(link => {
                                const target = entryBriefById.get(link.b_id)
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={link.id}
                                        disabled={!target}
                                        onClick={() => onOpenLinkedEntry(link.b_id)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {target?.title ?? '词条不存在或已删除'}
                                        </span>
                                        {target?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(target.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                    {incomingLinks.length > 0 && (
                        <div className="mobile-entry-detail__connection-group">
                            <div className="mobile-entry-detail__connection-label">被这些词条提到</div>
                            {incomingLinks.map(link => {
                                const source = entryBriefById.get(link.a_id)
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-card"
                                        key={link.id}
                                        disabled={!source}
                                        onClick={() => onOpenLinkedEntry(link.a_id)}
                                    >
                                        <span className="mobile-entry-detail__connection-title">
                                            {source?.title ?? '词条不存在或已删除'}
                                        </span>
                                        {source?.summary && (
                                            <span className="mobile-entry-detail__connection-excerpt">
                                                {buildExcerpt(source.summary)}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="词条操作"
                items={entryMenuItems}
            />
        </div>
    )
}
