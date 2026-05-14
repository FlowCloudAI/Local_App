import {logger} from '../../../shared/logger'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
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
import {type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

interface Props {
    push: (page: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
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

export default function MobileEntryList({push, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const categoryId = (params?.categoryId as string) || null

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
                    categoryId,
                    entryType: type,
                    limit: 200
                })
            } else {
                result = await db_list_entries({projectId, categoryId, entryType: type, limit: 200, offset: 0})
            }
            setEntries(result)
        } catch (e) {
            logger.error('加载词条失败', e)
        } finally {
            setLoading(false)
        }
    }, [projectId, categoryId])

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
            push({type: 'entryEditor', params: {projectId, entryId: created.id, displayName: '未命名词条'}})
        } catch (e) {
            logger.error('新建词条失败', e)
        }
    }

    const handleOpenEntry = (entry: EntryBrief) => {
        setAiFocus({projectId, entryId: entry.id})
        push({type: 'entryDetail', params: {projectId, entryId: entry.id, displayName: entry.title}})
    }

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                <Input
                    placeholder="搜索词条…"
                    value={searchText}
                    onValueChange={handleSearch}
                    style={{flex: 1}}
                />
                <Button type="button" size="sm" onClick={handleCreateEntry}>新建</Button>
            </div>

            {/* 类型筛选 */}
            {entryTypes.length > 0 && (
                <div style={{display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap'}}>
                    <button
                        className={typeFilter === null ? 'active' : ''}
                        onClick={() => setTypeFilter(null)}
                        style={{
                            padding: '4px 10px',
                            borderRadius: 999,
                            fontSize: 'var(--fc-font-size-xs)',
                            border: '1px solid var(--fc-color-border)',
                            background: typeFilter === null ? 'var(--fc-color-primary)' : undefined,
                            color: typeFilter === null ? '#fff' : 'var(--fc-color-text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        全部
                    </button>
                    {entryTypes.map(et => {
                        const key = entryTypeKey(et)
                        const active = typeFilter === key
                        return (
                            <button
                                key={key}
                                onClick={() => setTypeFilter(active ? null : key)}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: 999,
                                    fontSize: 'var(--fc-font-size-xs)',
                                    border: '1px solid var(--fc-color-border)',
                                    background: active ? (et.color ?? undefined) : undefined,
                                    color: active ? '#fff' : 'var(--fc-color-text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                }}
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
                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                    {entries
                        .sort((a, b) => {
                            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
                            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
                            return tb - ta
                        })
                        .map(entry => {
                            const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null
                            return (
                                <button
                                    type="button"
                                    className="mobile-list-card"
                                    key={entry.id}
                                    onClick={() => handleOpenEntry(entry)}
                                >
                                    <span className="mobile-list-card__row">
                                        <span className="mobile-list-card__main">
                                            <span className="mobile-list-card__title">{entry.title}</span>
                                            {entry.summary && (
                                                <span className="mobile-list-card__description">{entry.summary}</span>
                                            )}
                                        </span>
                                        <span className="mobile-list-card__meta">{formatDate(entry.updated_at)}</span>
                                    </span>
                                    {et && (
                                        <span className="mobile-list-card__tag" style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 3,
                                            background: et.color ? `${et.color}22` : 'var(--fc-color-bg-tertiary)',
                                            color: et.color ?? 'var(--fc-color-text)',
                                            padding: '2px 6px', borderRadius: 999, fontSize: 'var(--fc-font-size-xs)',
                                        }}>
                                            <EntryTypeIcon entryType={et} className=""/> {et.name}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                </div>
            )}
        </div>
    )
}
