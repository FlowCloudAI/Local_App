import {logger} from '../../../shared/logger'
import {convertFileSrc} from '../../../api/assets'
import {type CSSProperties, useCallback, useEffect, useRef, useState} from 'react'
import {Button, Card, Input} from 'flowcloudai-ui'
import {
    db_create_entry,
    db_list_all_entry_types,
    db_list_entries,
    db_search_entries,
    type EntryBrief,
    entryTypeKey,
    type EntryTypeView,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {type MobileEntryListPageParams, type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {MobileBackIcon, MobileTopActionPill} from '../components/MobileTopControls'
import './MobileEntryList.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    setAiFocus: (focus: AiFocus) => void
    categoryDrawerOpen?: boolean
    onOpenCategoryDrawer?: () => void
    params: MobileEntryListPageParams
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

function CategoryDrawerIcon() {
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M5 7h14"/>
            <path d="M5 12h14"/>
            <path d="M5 17h14"/>
        </svg>
    )
}

export default function MobileEntryList({push, pop, setAiFocus, categoryDrawerOpen = false, onOpenCategoryDrawer, params}: Props) {
    const projectId = params.projectId
    const uncategorizedOnly = Boolean(params.uncategorizedOnly)
    const categoryId = params.categoryId || null
    const listTitle = params.displayName || '全部词条'

    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [loading, setLoading] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    return (
        <div className="mobile-page mobile-entry-list">
            <div className="mobile-entry-list__hero">
                <MobileTopActionPill
                    className="mobile-entry-list__hero-nav"
                    actions={[
                        {
                            key: 'back',
                            label: '返回项目主页',
                            icon: <MobileBackIcon/>,
                            onClick: pop,
                        },
                        {
                            key: 'categories',
                            label: '打开分类树',
                            icon: <CategoryDrawerIcon/>,
                            ariaExpanded: categoryDrawerOpen,
                            onClick: () => onOpenCategoryDrawer?.(),
                        },
                    ]}
                />
                <div className="mobile-entry-list__hero-copy">
                    <span className="mobile-entry-list__eyebrow">{loading ? '正在同步' : `${entries.length} 个词条`}</span>
                    <h2 className="mobile-entry-list__title">{listTitle}</h2>
                </div>
                <MobileTopActionPill
                    className="mobile-entry-list__create"
                    actions={[
                        {
                            key: 'create',
                            label: '新建词条',
                            icon: '+',
                            kind: 'add',
                            onClick: () => void handleCreateEntry(),
                        },
                    ]}
                />
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
                <div className="mobile-entry-list__filters" data-mobile-horizontal-scroll="true">
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
    )
}
