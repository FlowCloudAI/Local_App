import MarkdownPreview from '@uiw/react-markdown-preview'
import {useCallback, useEffect, useState} from 'react'
import {Button, useTheme} from 'flowcloudai-ui'
import {
    db_get_entry,
    db_list_all_entry_types,
    type Entry,
    type EntryTypeView,
    entryTypeKey,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

interface Props {
    push: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

export default function MobileEntryDetail({push, navigateToTab, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const entryId = params?.entryId as string
    const [entry, setEntry] = useState<Entry | null>(null)
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [loading, setLoading] = useState(true)
    const {theme} = useTheme()
    // wrapperElement 的 data-color-mode 只接受 "light" | "dark"，不接受 "auto"
    const colorMode: 'light' | 'dark' = theme === 'dark'
        ? 'dark'
        : theme === 'light'
            ? 'light'
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    useEffect(() => {
        if (!entryId) return
        setLoading(true)
        Promise.all([
            db_get_entry(entryId),
            db_list_all_entry_types(projectId),
        ]).then(([e, types]) => {
            setEntry(e)
            setEntryTypes(types)
        }).catch(console.error).finally(() => setLoading(false))
    }, [entryId, projectId])

    const handleEdit = useCallback(() => {
        push({type: 'entryEditor', params: {projectId, entryId, displayName: entry?.title}})
    }, [push, projectId, entryId, entry?.title])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!entry) return <div className="mobile-page__error">词条不存在</div>

    const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            {/* 标题 */}
            <h1 style={{fontSize: 'var(--fc-font-size-xl)', fontWeight: 700, margin: '0 0 8px'}}>
                {entry.title}
            </h1>

            {/* 类型标签 */}
            {et && (
                <div style={{marginBottom: 12}}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: et.color ? `${et.color}22` : 'var(--fc-color-bg-tertiary)',
                        color: et.color ?? 'var(--fc-color-text)',
                        padding: '4px 10px', borderRadius: 999,
                        fontSize: 'var(--fc-font-size-xs)', fontWeight: 500,
                    }}>
                        <EntryTypeIcon entryType={et} className=""/> {et.name}
                    </span>
                </div>
            )}

            {/* 摘要 */}
            {entry.summary && (
                <p style={{
                    color: 'var(--fc-color-text-secondary)',
                    fontSize: 'var(--fc-font-size-sm)',
                    fontStyle: 'italic',
                    margin: '0 0 16px',
                    padding: '8px 12px',
                    background: 'var(--fc-color-bg-secondary)',
                    borderRadius: 'var(--fc-radius-sm)',
                }}>
                    {entry.summary}
                </p>
            )}

            {/* 正文 */}
            {entry.content ? (
                <div data-color-mode={colorMode} style={{fontSize: 'var(--fc-font-size-md)'}}>
                    <MarkdownPreview
                        source={entry.content}
                        style={{background: 'transparent', color: 'var(--fc-color-text)'}}
                        wrapperElement={{'data-color-mode': colorMode}}
                    />
                </div>
            ) : (
                <div className="mobile-page__empty" style={{height: 120, marginTop: 24}}>
                    暂无正文内容
                </div>
            )}

            {/* 底部操作栏 */}
            <div className="mobile-bottom-bar" style={{marginTop: 24}}>
                <Button variant="outline" onClick={handleAiDiscuss}>AI 讨论</Button>
                <Button onClick={handleEdit}>编辑</Button>
            </div>
        </div>
    )
}
