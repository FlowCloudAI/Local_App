import {convertFileSrc} from '@tauri-apps/api/core'
import {type CSSProperties, memo, useCallback, useEffect, useRef, useState} from 'react'
import {Button, Card, Input, RollingBox} from 'flowcloudai-ui'
import {
    db_list_entries,
    db_search_entries,
    type EntryBrief,
    entryTypeKey,
    type EntryTypeView,
    type TagSchema,
} from '../../api'
import EntryCreator from '../EntryCreator'
import EntryTypeIcon from './EntryTypeIcon'

type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc'

const SORT_OPTIONS: Array<{key: Exclude<SortMode, 'name-asc' | 'name-desc'>; label: string}> = [
    {key: 'updated-desc', label: '更新时间'},
    {key: 'updated-asc', label: '创建时间'},
]

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

interface CategoryViewProps {
    categoryId: string
    projectId: string
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    refreshToken?: number
    onEntryCreated?: () => void | Promise<void>
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function CategoryView({categoryId, projectId, entryTypes, tagSchemas, refreshToken = 0, onEntryCreated, onOpenEntry}: CategoryViewProps) {
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [loading, setLoading] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const loadEntries = useCallback(async (query: string, type: string | null) => {
        setLoading(true)
        try {
            let result: EntryBrief[]
            if (query.trim()) {
                result = await db_search_entries({
                    projectId,
                    query: query.trim(),
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
            setEntries(result)
        } catch (e) {
            console.error('load entries failed', e)
        } finally {
            setLoading(false)
        }
    }, [projectId, categoryId])

    useEffect(() => {
        void loadEntries(searchText, typeFilter)
        // searchText changes are handled by handleSearchChange debounce
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, typeFilter, refreshToken, loadEntries])

    useEffect(() => () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
    }, [])

    const handleSearchChange = (value: string) => {
        setSearchText(value)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            void loadEntries(value, typeFilter)
        }, 300)
    }

    const displayed = sortEntries(entries, sortMode)

    return (
        <div className="pe-category-view">
            <div className="pe-category-toolbar">
                <Input
                    className="pe-search-input"
                    placeholder="搜索词条…"
                    value={searchText}
                    onChange={handleSearchChange}
                />
                <div className="pe-category-toolbar-actions">
                    <Button size="sm" onClick={() => setCreatorOpen(true)}>
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

            {loading ? (
                <div className="pe-entries-status">加载中…</div>
            ) : (
                <RollingBox className="pe-entries-scroll" thumbSize="thin">
                    <div className="pe-entry-grid">
                        {displayed.map((entry) => {
                            const entryType = entry.type
                                ? entryTypes.find((et) => entryTypeKey(et) === entry.type)
                                : null
                            const coverSrc = toEntryCoverSrc(entry.cover)

                            return (
                                <Card
                                    key={entry.id}
                                    className="pe-entry-card"
                                    imageSlot={(
                                        coverSrc ? (
                                            <img
                                                src={coverSrc}
                                                alt={entry.title}
                                                className="pe-entry-cover"
                                            />
                                        ) : (
                                            <div
                                                className="pe-entry-placeholder"
                                                style={{'--entry-accent-color': entryType?.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                                            >
                                                <div className="pe-entry-placeholder__icon">
                                                    {entryType ? (
                                                        <EntryTypeIcon entryType={entryType} className="pe-entry-placeholder__type-icon"/>
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
                                        <span
                                            className="pe-entry-type-badge"
                                            style={{'--badge-color': entryType.color} as CSSProperties}
                                        >
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
                        })}
                        <button
                            type="button"
                            className="pe-entry-create-card"
                            onClick={() => setCreatorOpen(true)}
                        >
                            <span className="pe-entry-create-card__plus">+</span>
                            <span className="pe-entry-create-card__label">新建词条</span>
                        </button>
                    </div>
                </RollingBox>
            )}

            <EntryCreator
                open={creatorOpen}
                projectId={projectId}
                categoryId={categoryId}
                entryTypes={entryTypes}
                tagSchemas={tagSchemas}
                onClose={() => setCreatorOpen(false)}
                onCreated={async (createdEntry) => {
                    await loadEntries(searchText, typeFilter)
                    await onEntryCreated?.()
                    onOpenEntry?.({id: createdEntry.id, title: createdEntry.title})
                }}
            />
        </div>
    )
}

export default memo(CategoryView)
