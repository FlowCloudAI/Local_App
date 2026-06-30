import {logger} from '../../../shared/logger'
import {convertFileSrc} from '../../../api/assets'
import {
    type CSSProperties,
    memo,
    type SyntheticEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {Button, Card, Input, RollingBox} from 'flowcloudai-ui'
import {db_list_entries, db_search_entries, type EntryBrief, entryTypeKey, type EntryTypeView,} from '../../../api'
import EntryTypeIcon from './EntryTypeIcon'
import {PROJECT_HOME_PERF_LOG_ENABLED, projectHomePerfInfo, projectHomePerfWarn} from './projectHomePerfDebug'

type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc'

const SORT_OPTIONS: Array<{ key: Exclude<SortMode, 'name-asc' | 'name-desc'>; label: string }> = [
    {key: 'updated-desc', label: '更新时间'},
    {key: 'updated-asc', label: '创建时间'},
]
const ENTRY_GRID_GAP = 16
const ENTRY_GRID_MIN_COLUMN_WIDTH = 248
const ENTRY_GRID_DEFAULT_WIDTH = 960
const ENTRY_GRID_FALLBACK_VIEWPORT_HEIGHT = 900
const ENTRY_GRID_OVERSCAN_ROWS = 1

function isThumbnailCover(cover?: string | null): boolean {
    if (!cover) return false
    const normalized = String(cover).replace(/\\/g, '/').toLowerCase()
    return normalized.includes('/thumbs/') || normalized.includes('%2fthumbs%2f')
}

function summarizeEntryCovers(entries: EntryBrief[]) {
    let withCover = 0
    let thumbnail = 0
    for (const entry of entries) {
        if (!entry.cover) continue
        withCover += 1
        if (isThumbnailCover(entry.cover)) thumbnail += 1
    }
    return {
        total: entries.length,
        withCover,
        thumbnail,
        nonThumbnail: withCover - thumbnail,
        withoutCover: entries.length - withCover,
    }
}

function parseDateMs(s?: string | null): number {
    if (!s) return 0
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? 0 : t
}

function formatDate(s?: string | null): string {
    const ms = parseDateMs(s)
    if (!ms) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(ms)
}

function placeholderMark(title: string): string {
    const trimmed = title.trim()
    return trimmed ? trimmed[0] : '词'
}

function toEntryCoverSrc(cover?: string | null): string | undefined {
    if (!cover) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(cover)) return cover
    return convertFileSrc(String(cover), 'fcimg')
}

function sortEntries(entries: EntryBrief[], mode: SortMode): EntryBrief[] {
    return [...entries].sort((a, b) => {
        switch (mode) {
            case 'updated-asc':
                return parseDateMs(a.updated_at) - parseDateMs(b.updated_at)
            case 'name-asc':
                return a.title.localeCompare(b.title, 'zh-CN')
            case 'name-desc':
                return b.title.localeCompare(a.title, 'zh-CN')
            case 'updated-desc':
            default:
                return parseDateMs(b.updated_at) - parseDateMs(a.updated_at)
        }
    })
}

interface EntryCardItemProps {
    entry: EntryBrief
    entryTypes: EntryTypeView[]
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function EntryCardItem({entry, entryTypes, onOpenEntry}: EntryCardItemProps) {
    const entryType = entry.type
        ? entryTypes.find((et) => entryTypeKey(et) === entry.type)
        : null
    const coverSrc = toEntryCoverSrc(entry.cover)
    const imageDebugProps = PROJECT_HOME_PERF_LOG_ENABLED
        ? {
            onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
                const image = event.currentTarget
                projectHomePerfInfo('词条封面加载成功', {
                    entryId: entry.id,
                    title: entry.title,
                    isThumbnail: isThumbnailCover(entry.cover),
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    cover: entry.cover,
                })
            },
            onError: () => {
                projectHomePerfWarn('词条封面加载失败', {
                    entryId: entry.id,
                    title: entry.title,
                    isThumbnail: isThumbnailCover(entry.cover),
                    cover: entry.cover,
                })
            },
        }
        : undefined

    return (
        <Card
            className="pe-entry-card"
            imageSlot={(
                coverSrc ? (
                    <img
                        src={coverSrc}
                        alt={entry.title}
                        className="pe-entry-cover"
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        {...imageDebugProps}
                    />
                ) : (
                    <div
                        className="pe-entry-placeholder"
                        style={{'--entry-accent-color': entryType?.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                    >
                        <div className="pe-entry-placeholder__icon">
                            {entryType ? (
                                <EntryTypeIcon entryType={entryType}
                                               className="pe-entry-placeholder__type-icon"/>
                            ) : (
                                <span className="pe-entry-placeholder__mark">{placeholderMark(entry.title)}</span>
                            )}
                        </div>
                        <div className="pe-entry-placeholder__mark pe-entry-placeholder__mark--ghost">
                            {placeholderMark(entry.title)}
                        </div>
                    </div>
                )
            )}
            title={entry.title}
            description={entry.summary || '这个词条还没有摘要，点击后可继续补充设定内容。'}
            extraInfo={<div className="pe-entry-date">更新于 {formatDate(entry.updated_at)}</div>}
            tag={entryType ? (
                <span className="pe-entry-type-badge"
                      style={{'--badge-color': entryType.color} as CSSProperties}>
                    <EntryTypeIcon entryType={entryType} className="pe-entry-type-badge-icon"/>
                    {entryType.name}
                </span>
            ) : undefined}
            variant="shadow"
            hoverable
            expandContentOnHover
            imageHeight="100%"
            contentAreaRatio={0.5}
            hoverContentAreaRatio={0.8}
            overlayStartOpacity={1}
            overlayEndOpacity={0}
            onClick={() => onOpenEntry?.({id: entry.id, title: entry.title})}
        />
    )
}

function CreateEntryCard({
                             categoryId,
                             onRequestCreateEntry,
                         }: {
    categoryId: string | null
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
}) {
    return (
        <button
            type="button"
            className="pe-entry-create-card"
            onClick={() => void onRequestCreateEntry?.(categoryId)}
        >
            <span className="pe-entry-create-card__plus">+</span>
            <span className="pe-entry-create-card__label">新建词条</span>
        </button>
    )
}

interface VirtualEntryGridProps {
    entries: EntryBrief[]
    entryTypes: EntryTypeView[]
    categoryId: string | null
    scrollElement?: HTMLElement | null
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

interface VirtualGridViewport {
    width: number
    top: number
    bottom: number
}

function VirtualEntryGrid({
                              entries,
                              entryTypes,
                              categoryId,
                              scrollElement,
                              onRequestCreateEntry,
                              onOpenEntry,
                          }: VirtualEntryGridProps) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const measureFrameRef = useRef<number | null>(null)
    const [viewport, setViewport] = useState<VirtualGridViewport>({
        width: ENTRY_GRID_DEFAULT_WIDTH,
        top: 0,
        bottom: ENTRY_GRID_FALLBACK_VIEWPORT_HEIGHT,
    })

    const measureViewport = useCallback(() => {
        const root = rootRef.current
        if (!root) return

        const rootRect = root.getBoundingClientRect()
        const scrollRect = scrollElement?.getBoundingClientRect()
        const nextWidth = rootRect.width || ENTRY_GRID_DEFAULT_WIDTH
        const nextTop = scrollRect ? scrollRect.top - rootRect.top : 0
        const nextBottom = scrollRect ? scrollRect.bottom - rootRect.top : window.innerHeight - rootRect.top

        setViewport(current => {
            if (
                Math.abs(current.width - nextWidth) < 1 &&
                Math.abs(current.top - nextTop) < 1 &&
                Math.abs(current.bottom - nextBottom) < 1
            ) {
                return current
            }
            return {
                width: nextWidth,
                top: nextTop,
                bottom: nextBottom,
            }
        })
    }, [scrollElement])

    const scheduleMeasure = useCallback(() => {
        if (measureFrameRef.current !== null) return
        measureFrameRef.current = window.requestAnimationFrame(() => {
            measureFrameRef.current = null
            measureViewport()
        })
    }, [measureViewport])

    useLayoutEffect(() => {
        measureViewport()

        const scrollTarget: HTMLElement | Window = scrollElement ?? window
        scrollTarget.addEventListener('scroll', scheduleMeasure, {passive: true})
        window.addEventListener('resize', scheduleMeasure)

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(scheduleMeasure)
            : null
        if (rootRef.current) resizeObserver?.observe(rootRef.current)
        if (scrollElement) resizeObserver?.observe(scrollElement)

        return () => {
            scrollTarget.removeEventListener('scroll', scheduleMeasure)
            window.removeEventListener('resize', scheduleMeasure)
            resizeObserver?.disconnect()
            if (measureFrameRef.current !== null) {
                window.cancelAnimationFrame(measureFrameRef.current)
                measureFrameRef.current = null
            }
        }
    }, [measureViewport, scheduleMeasure, scrollElement])

    const gridWidth = Math.max(1, viewport.width)
    const columnCount = Math.max(1, Math.floor((gridWidth + ENTRY_GRID_GAP) / (ENTRY_GRID_MIN_COLUMN_WIDTH + ENTRY_GRID_GAP)))
    const columnWidth = Math.max(1, Math.floor((gridWidth - ENTRY_GRID_GAP * (columnCount - 1)) / columnCount))
    const rowHeight = Math.round(columnWidth * 4 / 3)
    const rowPitch = rowHeight + ENTRY_GRID_GAP
    const itemCount = entries.length + 1
    const rowCount = Math.ceil(itemCount / columnCount)
    const gridHeight = rowCount > 0
        ? rowCount * rowHeight + Math.max(0, rowCount - 1) * ENTRY_GRID_GAP
        : rowHeight
    const visibleTop = Math.max(0, Math.min(gridHeight, viewport.top))
    const visibleBottom = Math.max(visibleTop, Math.min(gridHeight, viewport.bottom))
    const startRow = Math.max(0, Math.floor(visibleTop / rowPitch) - ENTRY_GRID_OVERSCAN_ROWS)
    const endRow = Math.min(rowCount - 1, Math.ceil(visibleBottom / rowPitch) + ENTRY_GRID_OVERSCAN_ROWS)
    const startIndex = startRow * columnCount
    const endIndex = Math.min(entries.length, (endRow + 1) * columnCount)
    const renderedEntryCount = Math.max(0, endIndex - startIndex)
    const renderedCreateCardCount = startIndex <= entries.length && (endRow + 1) * columnCount > entries.length ? 1 : 0
    const renderedCoverStats = useMemo(
        () => PROJECT_HOME_PERF_LOG_ENABLED ? summarizeEntryCovers(entries.slice(startIndex, endIndex)) : null,
        [endIndex, entries, startIndex],
    )
    const cells = []

    useEffect(() => {
        if (!PROJECT_HOME_PERF_LOG_ENABLED) return
        projectHomePerfInfo('虚拟词条卡片', {
            totalEntryCards: entries.length,
            renderedEntryCards: renderedEntryCount,
            renderedCreateCards: renderedCreateCardCount,
            renderedCoverStats,
            columnCount,
            rowCount,
            startRow,
            endRow,
            gridWidth: Math.round(gridWidth),
            columnWidth,
            rowHeight,
            gridHeight,
        })
    }, [
        columnCount,
        columnWidth,
        endIndex,
        endRow,
        entries.length,
        gridHeight,
        gridWidth,
        renderedCoverStats,
        renderedCreateCardCount,
        renderedEntryCount,
        rowCount,
        rowHeight,
        startRow,
    ])

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const itemIndex = rowIndex * columnCount + columnIndex
            if (itemIndex >= itemCount) break

            const entry = entries[itemIndex]
            const isCreateCard = itemIndex === entries.length
            cells.push((
                <div
                    key={isCreateCard ? '__create__' : entry.id}
                    className="pe-entry-virtual-cell"
                    style={{
                        left: columnIndex * (columnWidth + ENTRY_GRID_GAP),
                        top: rowIndex * rowPitch,
                        width: columnWidth,
                        height: rowHeight,
                    }}
                >
                    {isCreateCard ? (
                        <CreateEntryCard
                            categoryId={categoryId}
                            onRequestCreateEntry={onRequestCreateEntry}
                        />
                    ) : (
                        <EntryCardItem
                            entry={entry}
                            entryTypes={entryTypes}
                            onOpenEntry={onOpenEntry}
                        />
                    )}
                </div>
            ))
        }
    }

    return (
        <div
            ref={rootRef}
            className="pe-entry-virtual-grid"
            style={{height: gridHeight}}
        >
            {cells}
        </div>
    )
}

interface CategoryViewProps {
    categoryId: string | null
    categoryName?: string
    projectId: string
    entryTypes: EntryTypeView[]
    prefetchedEntries?: EntryBrief[]
    refreshToken?: number
    noScroll?: boolean
    virtualScrollElement?: HTMLElement | null
    onDefaultEntriesLoaded?: (categoryId: string | null, entries: EntryBrief[]) => void
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function CategoryView({
                          categoryId,
                          categoryName = '',
                          projectId,
                          entryTypes,
                          prefetchedEntries,
                          refreshToken = 0,
                          noScroll = false,
                          virtualScrollElement,
                          onDefaultEntriesLoaded,
                          onRequestCreateEntry,
                          onOpenEntry
                      }: CategoryViewProps) {
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [loading, setLoading] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const loadEntries = useCallback(async (
        query: string,
        type: string | null,
        options?: { silent?: boolean }
    ) => {
        const trimmedQuery = query.trim()
        const requestLabel = trimmedQuery ? 'search' : 'list'
        const silent = options?.silent ?? false
        logger.info('[CategoryView] 开始加载词条', {
            requestLabel,
            projectId,
            categoryId,
            typeFilter: type,
            rawQuery: query,
            trimmedQuery,
            silent,
        })
        if (!silent) setLoading(true)
        try {
            let result: EntryBrief[]
            if (trimmedQuery) {
                result = await db_search_entries({
                    projectId,
                    query: trimmedQuery,
                    categoryId,
                    entryType: type,
                    limit: 200,
                })
            } else {
                result = await db_list_entries({
                    projectId,
                    categoryId,
                    entryType: type,
                    limit: 200,
                    offset: 0,
                })
            }
            logger.info('[CategoryView] 词条加载完成', {
                requestLabel,
                resultCount: result.length,
                resultPreview: result.slice(0, 5).map((entry) => ({
                    id: entry.id,
                    title: entry.title,
                    type: entry.type,
                    categoryId: entry.category_id,
                })),
            })
            setEntries(result)
            if (!trimmedQuery && type === null) {
                onDefaultEntriesLoaded?.(categoryId, result)
            }
        } catch (e) {
            logger.error('[CategoryView] 词条加载失败', {
                requestLabel,
                projectId,
                categoryId,
                typeFilter: type,
                rawQuery: query,
                error: e,
            })
        } finally {
            if (!silent) setLoading(false)
        }
    }, [projectId, categoryId, onDefaultEntriesLoaded])

    useEffect(() => {
        if (!searchText.trim() && typeFilter === null && prefetchedEntries !== undefined) {
            setEntries(prefetchedEntries)
            setLoading(false)
            void loadEntries(searchText, typeFilter, {silent: true})
            return
        }
        void loadEntries(searchText, typeFilter)
        // searchText 变更由 handleSearchChange 的防抖处理
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, typeFilter, refreshToken, loadEntries, prefetchedEntries])

    useEffect(() => () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
    }, [])

    const handleSearchChange = (value: string) => {
        logger.info('[CategoryView] 搜索框输入变化', {
            value,
            trimmedValue: value.trim(),
            categoryId,
            typeFilter,
        })
        setSearchText(value)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            logger.info('[CategoryView] 触发防抖搜索', {
                value,
                trimmedValue: value.trim(),
                categoryId,
                typeFilter,
            })
            void loadEntries(value, typeFilter)
        }, 300)
    }

    const displayed = useMemo(() => sortEntries(entries, sortMode), [entries, sortMode])
    const coverStats = useMemo(
        () => PROJECT_HOME_PERF_LOG_ENABLED ? summarizeEntryCovers(displayed) : null,
        [displayed],
    )
    const hasVisibleEntries = displayed.length > 0
    const showLoadingOverlay = loading && hasVisibleEntries

    useEffect(() => {
        if (!PROJECT_HOME_PERF_LOG_ENABLED) return
        projectHomePerfInfo('词条卡片数据', {
            projectId,
            categoryId,
            categoryName,
            mode: noScroll ? '项目主页内联虚拟网格' : '独立滚动网格',
            loadedEntryCards: entries.length,
            displayedEntryCards: displayed.length,
            createCards: 1,
            coverStats,
            entryTypeCount: entryTypes.length,
            typeFilter,
            sortMode,
            searchText: searchText.trim(),
            usingPrefetchedEntries: prefetchedEntries !== undefined,
        })
    }, [
        categoryId,
        categoryName,
        coverStats,
        displayed.length,
        entries.length,
        entryTypes.length,
        noScroll,
        prefetchedEntries,
        projectId,
        searchText,
        sortMode,
        typeFilter,
    ])

    const renderEntryGrid = () => (
        <div className="pe-entry-grid">
            {displayed.map((entry) => (
                <EntryCardItem
                    key={entry.id}
                    entry={entry}
                    entryTypes={entryTypes}
                    onOpenEntry={onOpenEntry}
                />
            ))}
            <CreateEntryCard
                categoryId={categoryId}
                onRequestCreateEntry={onRequestCreateEntry}
            />
        </div>
    )

    return (
        <div className="pe-category-view">
            <div className="pe-category-toolbar">
                <div className="pe-category-title">{categoryId ? categoryName : (categoryName || '全部词条')}</div>
                <div className="pe-category-toolbar-right">
                    <Input
                        className="pe-search-input"
                        placeholder="搜索词条…"
                        value={searchText}
                        onValueChange={handleSearchChange}
                    />
                    <div className="pe-category-toolbar-actions">
                        <Button type="button" size="sm" onClick={() => void onRequestCreateEntry?.(categoryId)}>
                            + 新建词条
                        </Button>
                    </div>
                    <div className="pe-sort-tabs">
                        {SORT_OPTIONS.map((opt) => (
                            <button
                                key={opt.key}
                                className={`pe-sort-tab${sortMode === opt.key ? ' active' : ''}`}
                                onClick={() => setSortMode(opt.key)}
                            >
                                {opt.label}
                            </button>
                        ))}
                        <button
                            className={`pe-sort-tab${sortMode === 'name-asc' || sortMode === 'name-desc' ? ' active' : ''}`}
                            onClick={() => setSortMode(current => current === 'name-asc' ? 'name-desc' : 'name-asc')}
                        >
                            {sortMode === 'name-desc' ? '标题 Z-A' : '标题 A-Z'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="pe-type-filter">
                <button
                    className={`pe-type-chip${typeFilter === null ? ' active' : ''}`}
                    onClick={() => setTypeFilter(null)}
                >
                    全部
                </button>
                {entryTypes.map((et) => {
                    const key = entryTypeKey(et)
                    return (
                        <button
                            key={key}
                            className={`pe-type-chip${typeFilter === key ? ' active' : ''}`}
                            style={{'--chip-color': et.color} as CSSProperties}
                            onClick={() => setTypeFilter(typeFilter === key ? null : key)}
                        >
                            <EntryTypeIcon entryType={et} className="pe-type-chip-icon"/>
                            {et.name}
                        </button>
                    )
                })}
            </div>

            <div className={`pe-entries-region${noScroll ? ' is-inline' : ' is-scrollable'}`}>
                {hasVisibleEntries ? (
                    noScroll ? (
                        <VirtualEntryGrid
                            entries={displayed}
                            entryTypes={entryTypes}
                            categoryId={categoryId}
                            scrollElement={virtualScrollElement}
                            onRequestCreateEntry={onRequestCreateEntry}
                            onOpenEntry={onOpenEntry}
                        />
                    ) : (
                        <RollingBox axis="y" className="pe-entries-scroll" thumbSize="thin">
                            {renderEntryGrid()}
                        </RollingBox>
                    )
                ) : (
                    <div className="pe-entries-status">
                        {loading ? '加载中…' : '暂无符合条件的词条'}
                    </div>
                )}
                {showLoadingOverlay && (
                    <div className="pe-entries-overlay" aria-hidden="true">
                        <span className="pe-entries-overlay__label">刷新词条中…</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default memo(CategoryView)
