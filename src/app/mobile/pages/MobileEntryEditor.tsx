import {useCallback, useEffect, useRef, useState} from 'react'
import {Button, Input, Select, useAlert} from 'flowcloudai-ui'
import {
    type Category,
    db_get_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_update_entry,
    entryTypeKey,
    type EntryTypeView,
} from '../../../api'
import {type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'

interface Props {
    pop: () => void
    replace: (page: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    params?: Record<string, unknown>
}

export default function MobileEntryEditor({pop, replace, setAiFocus, params}: Props) {
    const projectId = params?.projectId as string
    const entryId = params?.entryId as string
    const {showAlert} = useAlert()

    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [summary, setSummary] = useState('')
    const [entryType, setEntryType] = useState<string | null>(null)
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const [categories, setCategories] = useState<Category[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const initialLoaded = useRef(false)

    useEffect(() => {
        if (!entryId || initialLoaded.current) return
        setLoading(true)
        Promise.all([
            db_get_entry(entryId),
            db_list_categories(projectId),
            db_list_all_entry_types(projectId),
        ]).then(([entry, cats, types]) => {
            if (initialLoaded.current) return
            initialLoaded.current = true
            setTitle(entry.title)
            setContent(entry.content ?? '')
            setSummary(entry.summary ?? '')
            setEntryType(entry.type ?? null)
            setCategoryId(entry.category_id ?? null)
            setCategories(cats)
            setEntryTypes(types)
        }).catch(console.error).finally(() => setLoading(false))
    }, [entryId, projectId])

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
            setAiFocus({projectId, entryId})
            // replace 而非 pop，让用户保存后直接看到最新的详情页
            replace({type: 'entryDetail', params: {projectId, entryId, displayName: title.trim()}})
        } catch (e) {
            await showAlert(`保存失败：${String(e)}`, 'error', 'toast', 3000)
        } finally {
            setSaving(false)
        }
    }, [title, content, summary, entryType, categoryId, entryId, projectId, replace, setAiFocus, showAlert])

    if (loading) return <div className="mobile-page__loading">加载中…</div>

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
            {/* 保存按钮 */}
            <div style={{display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end'}}>
                <Button size="sm" variant="outline" onClick={pop} disabled={saving}>取消</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? '保存中…' : '保存'}
                </Button>
            </div>

            {/* 标题 */}
            <Input
                placeholder="词条标题"
                value={title}
                onValueChange={v => {
                    setTitle(v)
                }}
                style={{marginBottom: 12, fontWeight: 600, fontSize: 'var(--fc-font-size-lg)'}}
            />

            {/* 类型和分类 */}
            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                <Select
                    value={entryType ?? ''}
                    onChange={v => {
                        setEntryType(v ? String(v) : null)
                    }}
                    options={typeOptions}
                    placeholder="类型"
                    style={{flex: 1}}
                />
                <Select
                    value={categoryId ?? ''}
                    onChange={v => {
                        setCategoryId(v ? String(v) : null)
                    }}
                    options={categoryOptions}
                    placeholder="分类"
                    style={{flex: 1}}
                />
            </div>

            {/* 摘要 */}
            <Input
                placeholder="摘要（可选）"
                value={summary}
                onValueChange={v => {
                    setSummary(v)
                }}
                style={{marginBottom: 12}}
            />

            {/* 正文 */}
            <textarea
                placeholder="正文内容…"
                value={content}
                onChange={e => {
                    setContent(e.target.value)
                }}
                style={{
                    flex: '1 1 240px', minHeight: 200, width: '100%', padding: 10,
                    background: 'var(--fc-color-bg-secondary)',
                    color: 'var(--fc-color-text)',
                    border: '1px solid var(--fc-color-border)',
                    borderRadius: 'var(--fc-radius-sm)',
                    fontSize: 'var(--fc-font-size-md)',
                    lineHeight: 1.8, resize: 'vertical',
                    fontFamily: 'inherit',
                }}
            />
        </div>
    )
}
