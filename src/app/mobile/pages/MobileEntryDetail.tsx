import {logger} from '../../../shared/logger'
import MarkdownPreview from '@uiw/react-markdown-preview'
import {useCallback, useEffect, useState} from 'react'
import {Button, Input, Select, useAlert, useTheme} from 'flowcloudai-ui'
import {
    type Category,
    db_get_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_update_entry,
    type Entry,
    type EntryTypeView,
    entryTypeKey,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {type MobilePage} from '../usePageStack'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

interface Props {
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

type Mode = 'view' | 'edit'

/**
 * 词条页：查看 / 编辑同屏（mode 切换），避免「详情 → 编辑」再多压一级。
 * params.mode === 'edit' 时（如新建词条后）直接进入编辑态。
 */
export default function MobileEntryDetail({pop, replace, navigateToTab, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const entryId = params?.entryId as string
    const {showAlert} = useAlert()
    const {theme} = useTheme()

    const [entry, setEntry] = useState<Entry | null>(null)
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [mode, setMode] = useState<Mode>(params?.mode === 'edit' ? 'edit' : 'view')

    // 编辑表单字段
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [summary, setSummary] = useState('')
    const [entryType, setEntryType] = useState<string | null>(null)
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // wrapperElement 的 data-color-mode 只接受 "light" | "dark"，不接受 "auto"
    const colorMode: 'light' | 'dark' = theme === 'dark'
        ? 'dark'
        : theme === 'light'
            ? 'light'
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    const syncForm = useCallback((e: Entry) => {
        setTitle(e.title)
        setContent(e.content ?? '')
        setSummary(e.summary ?? '')
        setEntryType(e.type ?? null)
        setCategoryId(e.category_id ?? null)
    }, [])

    useEffect(() => {
        if (!entryId) return
        setLoading(true)
        Promise.all([
            db_get_entry(entryId),
            db_list_all_entry_types(projectId),
            db_list_categories(projectId),
        ]).then(([e, types, cats]) => {
            setEntry(e)
            setEntryTypes(types)
            setCategories(cats)
            syncForm(e)
        }).catch(logger.error).finally(() => setLoading(false))
    }, [entryId, projectId, syncForm])

    const enterEdit = useCallback(() => {
        if (entry) syncForm(entry)
        setMode('edit')
    }, [entry, syncForm])

    // 取消：已有可回退的查看态则回查看；否则（极端情况无 entry）回退页面。
    const handleCancel = useCallback(() => {
        if (entry) setMode('view')
        else pop()
    }, [entry, pop])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            await showAlert('请输入词条标题', 'warning', 'toast', 2000)
            return
        }
        setSaving(true)
        try {
            await db_update_entry({
                id: entryId,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                categoryId: categoryId || null,
            })
            setEntry(prev => prev ? {
                ...prev,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                category_id: categoryId || null,
            } : prev)
            setAiFocus({projectId, entryId})
            // 同步页面标题（顶部标题取自 params.displayName）。
            replace({type: 'entryDetail', params: {...(params ?? {}), projectId, entryId, displayName: title.trim(), mode: 'view'}})
            setMode('view')
        } catch (e) {
            await showAlert(`保存失败：${String(e)}`, 'error', 'toast', 3000)
        } finally {
            setSaving(false)
        }
    }, [title, content, summary, entryType, categoryId, entryId, projectId, params, replace, setAiFocus, showAlert])

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!entry) return <div className="mobile-page__error">词条不存在</div>

    // ---------- 编辑态 ----------
    if (mode === 'edit') {
        const categoryOptions = [
            {value: '', label: '无分类'},
            ...categories.map(c => ({value: c.id, label: c.name})),
        ]
        const typeOptions = [
            {value: '', label: '无类型'},
            ...entryTypes.map(et => ({value: entryTypeKey(et), label: et.name})),
        ]
        return (
            <div className="mobile-page"
                 style={{padding: '12px 16px', display: 'flex', flexDirection: 'column', minHeight: 0}}>
                <div style={{display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end'}}>
                    <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={saving}>取消</Button>
                    <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? '保存中…' : '保存'}
                    </Button>
                </div>

                <Input
                    placeholder="词条标题"
                    value={title}
                    onValueChange={setTitle}
                    style={{marginBottom: 12, fontWeight: 600, fontSize: 'var(--fc-font-size-lg)'}}
                />

                <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                    <Select
                        value={entryType ?? ''}
                        onChange={v => setEntryType(v ? String(v) : null)}
                        options={typeOptions}
                        placeholder="类型"
                        style={{flex: 1}}
                    />
                    <Select
                        value={categoryId ?? ''}
                        onChange={v => setCategoryId(v ? String(v) : null)}
                        options={categoryOptions}
                        placeholder="分类"
                        style={{flex: 1}}
                    />
                </div>

                <Input
                    placeholder="摘要（可选）"
                    value={summary}
                    onValueChange={setSummary}
                    style={{marginBottom: 12}}
                />

                <textarea
                    placeholder="正文内容…"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    style={{
                        flex: '1 1 240px', minHeight: 200, width: '100%', padding: 10,
                        background: 'var(--fc-color-bg-secondary)',
                        color: 'var(--fc-color-text)',
                        border: '1px solid var(--fc-color-border)',
                        borderRadius: 'var(--fc-radius-sm)',
                        fontSize: 'var(--fc-font-size-md)',
                        lineHeight: 1.8, resize: 'vertical',
                        fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                />
            </div>
        )
    }

    // ---------- 查看态 ----------
    const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null

    return (
        <div className="mobile-page" style={{padding: '12px 16px'}}>
            <h1 style={{fontSize: 'var(--fc-font-size-xl)', fontWeight: 700, margin: '0 0 8px'}}>
                {entry.title}
            </h1>

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

            <div className="mobile-bottom-bar" style={{marginTop: 24}}>
                <Button type="button" variant="outline" onClick={handleAiDiscuss}>AI 讨论</Button>
                <Button type="button" onClick={enterEdit}>编辑</Button>
            </div>
        </div>
    )
}
