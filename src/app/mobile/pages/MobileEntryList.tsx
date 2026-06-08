import {logger} from '../../../shared/logger'
import {convertFileSrc} from '@tauri-apps/api/core'
import {type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Card, Input} from 'flowcloudai-ui'
import {
    db_get_project_stats,
    db_list_categories,
    db_create_entry,
    db_list_all_entry_types,
    db_list_entries,
    db_search_entries,
    type Category,
    type EntryBrief,
    entryTypeKey,
    type EntryTypeView,
    type ProjectStats,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import MobileCategoryDrawer, {type MobileCategoryDrawerSelection} from '../components/MobileCategoryDrawer'
import './MobileEntryList.css'

interface Props {
    push: (page: MobilePage) => void
    replace: (page: MobilePage) => void
    setBeforeBack: (handler: (() => boolean | Promise<boolean>) | null) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

interface DragState {
    pointerId: number
    startX: number
    startY: number
    baseOffset: number
    tracking: boolean
}

function formatDate(s?: string | null): string {
    if (!s) return '未知'
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? '未知' : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(t)
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function getDrawerWidth(): number {
    if (typeof window === 'undefined') return 320
    const width = window.innerWidth || 360
    return clamp(width - 54, 260, 360)
}

function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]'))
}

export default function MobileEntryList({push, replace, setBeforeBack, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const uncategorizedOnly = Boolean(params?.uncategorizedOnly)
    const categoryId = (params?.categoryId as string) || null
    const listTitle = (params?.displayName as string | undefined) || '全部词条'

    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [projectStats, setProjectStats] = useState<ProjectStats | null>(null)
    const [loading, setLoading] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [drawerWidth, setDrawerWidth] = useState(getDrawerWidth)
    const [dragOffset, setDragOffset] = useState<number | null>(null)
    const [dragging, setDragging] = useState(false)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dragStateRef = useRef<DragState | null>(null)
    const surfaceRef = useRef<HTMLDivElement>(null)

    const load = useCallback(async (query: string, type: string | null) => {
        setLoading(true)
        try {
            let result: EntryBrief[]
            if (query.trim()) {
                result = await db_search_entries({
                    projectId,
                    query: query.trim(),
                    categoryId: uncategorizedOnly ? null : categoryId,
                    entryType: type,
                    limit: 200
                })
            } else {
                result = await db_list_entries({
                    projectId,
                    categoryId: uncategorizedOnly ? null : categoryId,
                    entryType: type,
                    limit: 200,
                    offset: 0,
                })
            }
            setEntries(uncategorizedOnly ? result.filter(entry => !entry.category_id) : result)
        } catch (e) {
            logger.error('加载词条失败', e)
        } finally {
            setLoading(false)
        }
    }, [projectId, categoryId, uncategorizedOnly])

    useEffect(() => {
        void load(searchText, typeFilter)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, typeFilter])

    useEffect(() => {
        db_list_all_entry_types(projectId).then(setEntryTypes).catch(() => {
        })
    }, [projectId])

    useEffect(() => {
        if (!projectId) return
        Promise.all([
            db_list_categories(projectId),
            db_get_project_stats(projectId),
        ]).then(([nextCategories, nextStats]) => {
            setCategories(nextCategories)
            setProjectStats(nextStats)
        }).catch(error => {
            logger.error('加载分类树失败', error)
        })
    }, [projectId])

    useEffect(() => {
        const updateDrawerWidth = () => {
            setDrawerWidth(getDrawerWidth())
        }
        updateDrawerWidth()
        window.addEventListener('resize', updateDrawerWidth)
        window.visualViewport?.addEventListener('resize', updateDrawerWidth)
        return () => {
            window.removeEventListener('resize', updateDrawerWidth)
            window.visualViewport?.removeEventListener('resize', updateDrawerWidth)
        }
    }, [])

    const closeDrawer = useCallback(() => {
        setDrawerOpen(false)
        setDragOffset(null)
        setDragging(false)
        dragStateRef.current = null
    }, [])

    useEffect(() => {
        if (!drawerOpen) return undefined
        setBeforeBack(() => {
            closeDrawer()
            return false
        })
        return () => setBeforeBack(null)
    }, [closeDrawer, drawerOpen, setBeforeBack])

    const selectedCategory = useMemo<MobileCategoryDrawerSelection>(() => {
        if (uncategorizedOnly) return {kind: 'uncategorized'}
        if (categoryId) return {kind: 'category', categoryId}
        return {kind: 'all'}
    }, [categoryId, uncategorizedOnly])

    const handleSelectCategory = useCallback((selection: MobileCategoryDrawerSelection, label: string) => {
        closeDrawer()
        if (selection.kind === 'all') {
            replace({type: 'entryList', params: {projectId, categoryId: '', displayName: label}})
            return
        }
        if (selection.kind === 'uncategorized') {
            replace({
                type: 'entryList',
                params: {
                    projectId,
                    categoryId: '',
                    uncategorizedOnly: true,
                    displayName: label,
                },
            })
            return
        }
        replace({type: 'entryList', params: {projectId, categoryId: selection.categoryId, displayName: label}})
    }, [closeDrawer, projectId, replace])

    const handleDrawerToggle = useCallback(() => {
        setDragOffset(null)
        setDrawerOpen(open => !open)
    }, [])

    const handleSurfacePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (!drawerOpen && isInteractiveTarget(event.target)) return
        const baseOffset = drawerOpen ? drawerWidth : 0
        dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseOffset,
            tracking: false,
        }
        surfaceRef.current?.setPointerCapture(event.pointerId)
    }, [drawerOpen, drawerWidth])

    const handleSurfacePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return
        const dx = event.clientX - dragState.startX
        const dy = event.clientY - dragState.startY
        const horizontal = Math.abs(dx)
        const vertical = Math.abs(dy)

        if (!dragState.tracking) {
            if (vertical > 16 && vertical > horizontal) {
                dragStateRef.current = null
                if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
                    surfaceRef.current.releasePointerCapture(event.pointerId)
                }
                return
            }
            if (horizontal < 18 || horizontal < vertical * 1.45) return
            if (!drawerOpen && dx < 0) {
                dragStateRef.current = null
                if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
                    surfaceRef.current.releasePointerCapture(event.pointerId)
                }
                return
            }
            dragState.tracking = true
            setDragging(true)
        }

        event.preventDefault()
        setDragOffset(clamp(dragState.baseOffset + dx, 0, drawerWidth))
    }, [drawerOpen, drawerWidth])

    const finishSurfaceDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return
        const currentOffset = dragOffset ?? (drawerOpen ? drawerWidth : 0)
        const shouldOpen = dragState.tracking
            ? currentOffset > drawerWidth * 0.46
            : drawerOpen
        dragStateRef.current = null
        setDragOffset(null)
        setDragging(false)
        setDrawerOpen(shouldOpen)
        if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
            surfaceRef.current.releasePointerCapture(event.pointerId)
        }
    }, [dragOffset, drawerOpen, drawerWidth])

    const handleSearch = (value: string) => {
        setSearchText(value)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => void load(value, typeFilter), 300)
    }

    const handleCreateEntry = async () => {
        try {
            const created = await db_create_entry({projectId, categoryId, title: '未命名词条'})
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit'}})
        } catch (e) {
            logger.error('新建词条失败', e)
        }
    }

    const handleOpenEntry = (entry: EntryBrief) => {
        setAiFocus({projectId, entryId: entry.id})
        push({type: 'entryDetail', params: {projectId, entryId: entry.id, displayName: entry.title}})
    }

    const surfaceOffset = dragOffset ?? (drawerOpen ? drawerWidth : 0)

    return (
        <div
            className={`mobile-entry-list-shell${drawerOpen ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
            style={{
                '--mobile-entry-drawer-width': `${drawerWidth}px`,
                '--mobile-entry-drawer-shift': `${surfaceOffset}px`,
            } as CSSProperties}
        >
            <div className="mobile-entry-list-shell__drawer">
                <MobileCategoryDrawer
                    categories={categories}
                    stats={projectStats}
                    selected={selectedCategory}
                    onSelect={handleSelectCategory}
                />
            </div>
            <div
                ref={surfaceRef}
                className="mobile-page mobile-entry-list mobile-entry-list-shell__surface"
                onPointerDown={handleSurfacePointerDown}
                onPointerMove={handleSurfacePointerMove}
                onPointerUp={finishSurfaceDrag}
                onPointerCancel={finishSurfaceDrag}
                onPointerLeave={finishSurfaceDrag}
            >
            <button
                type="button"
                className="mobile-entry-list-shell__surface-close"
                aria-label="关闭分类树"
                tabIndex={drawerOpen ? 0 : -1}
                onClick={closeDrawer}
            />
            <div className="mobile-entry-list__hero">
                <button
                    type="button"
                    className="mobile-entry-list__drawer-toggle"
                    aria-label={drawerOpen ? '关闭分类树' : '打开分类树'}
                    aria-expanded={drawerOpen}
                    onClick={handleDrawerToggle}
                >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <path d="M5 7h14"/>
                        <path d="M5 12h14"/>
                        <path d="M5 17h14"/>
                    </svg>
                </button>
                <div className="mobile-entry-list__hero-copy">
                    <span className="mobile-entry-list__eyebrow">{loading ? '正在同步' : `${entries.length} 个词条`}</span>
                    <h2 className="mobile-entry-list__title">{listTitle}</h2>
                </div>
                <button
                    type="button"
                    className="mobile-entry-list__create"
                    onClick={handleCreateEntry}
                    aria-label="新建词条"
                >
                    +
                </button>
            </div>

            <div className="mobile-entry-list__toolbar">
                <Input
                    placeholder="搜索词条…"
                    value={searchText}
                    onValueChange={handleSearch}
                    className="mobile-entry-list__search"
                    radius="full"
                    size="lg"
                    allowClear
                />
            </div>

            {/* 类型筛选 */}
            {entryTypes.length > 0 && (
                <div className="mobile-entry-list__filters">
                    <button
                        type="button"
                        className={`mobile-entry-list__filter${typeFilter === null ? ' active' : ''}`}
                        onClick={() => setTypeFilter(null)}
                    >
                        全部
                    </button>
                    {entryTypes.map(et => {
                        const key = entryTypeKey(et)
                        const active = typeFilter === key
                        return (
                            <button
                                key={key}
                                type="button"
                                className={`mobile-entry-list__filter${active ? ' active' : ''}`}
                                onClick={() => setTypeFilter(active ? null : key)}
                                style={{'--mobile-entry-type-color': et.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                            >
                                <EntryTypeIcon entryType={et} className=""/>
                                {et.name}
                            </button>
                        )
                    })}
                </div>
            )}

            {loading ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : entries.length === 0 ? (
                <div className="mobile-page__empty">
                    <p>暂无词条</p>
                    <Button type="button" size="sm" onClick={handleCreateEntry}>新建第一个词条</Button>
                </div>
            ) : (
                <div className="mobile-entry-list__grid">
                    {entries
                        .sort((a, b) => {
                            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
                            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
                            return tb - ta
                        })
                        .map(entry => {
                            const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null
                            const coverSrc = toEntryCoverSrc(entry.cover)
                            return (
                                <Card
                                    className="mobile-entry-card"
                                    key={entry.id}
                                    style={{'--mobile-entry-card-color': et?.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                                    imageSlot={coverSrc ? (
                                        <img
                                            src={coverSrc}
                                            alt={entry.title}
                                            className="mobile-entry-card__cover"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    ) : (
                                        <span className="mobile-entry-card__placeholder">
                                            <span className="mobile-entry-card__placeholder-icon">
                                                {et ? (
                                                    <EntryTypeIcon entryType={et} className="mobile-entry-card__placeholder-type-icon"/>
                                                ) : (
                                                    <span className="mobile-entry-card__placeholder-mark">{placeholderMark(entry.title)}</span>
                                                )}
                                            </span>
                                            <span className="mobile-entry-card__placeholder-ghost">
                                                {placeholderMark(entry.title)}
                                            </span>
                                        </span>
                                    )}
                                    title={entry.title}
                                    description={entry.summary || '这个词条还没有摘要，点击后可继续补充设定内容。'}
                                    extraInfo={<div className="mobile-entry-date">更新于 {formatDate(entry.updated_at)}</div>}
                                    tag={et ? (
                                        <span className="mobile-entry-card__tag">
                                            <EntryTypeIcon entryType={et} className="mobile-entry-card__tag-icon"/> {et.name}
                                        </span>
                                    ) : undefined}
                                    variant="shadow"
                                    hoverable
                                    imageHeight="58%"
                                    onClick={() => handleOpenEntry(entry)}
                                />
                            )
                        })}
                </div>
            )}
            </div>
        </div>
    )
}
