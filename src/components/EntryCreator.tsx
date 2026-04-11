import {type CSSProperties, useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    db_create_entry,
    entryTypeKey,
    type Entry,
    type TagSchema,
    type EntryTypeView,
} from '../api'
import {buildEntryTagsPayload, ensureTypeTargetTagValues} from './entryTagUtils'
import EntryTypeIcon from './project-editor/EntryTypeIcon'
import './EntryCreator.css'

interface EntryCreatorProps {
    open: boolean
    projectId: string
    categoryId?: string | null
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    onClose: () => void
    onCreated?: (entry: Entry) => void | Promise<void>
}

export default function EntryCreator({
    open,
    projectId,
    categoryId = null,
    entryTypes,
    tagSchemas,
    onClose,
    onCreated,
}: EntryCreatorProps) {
    const [title, setTitle] = useState('')
    const [summary, setSummary] = useState('')
    const [content, setContent] = useState('')
    const [selectedType, setSelectedType] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)
    const {showAlert} = useAlert()

    const typeOptions = useMemo(
        () => entryTypes.map(entryType => ({
            key: entryTypeKey(entryType),
            entryType,
        })),
        [entryTypes]
    )

    useEffect(() => {
        if (open) {
            setTitle('')
            setSummary('')
            setContent('')
            setSelectedType(null)
            setSubmitting(false)
            setApiError(null)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, submitting, onClose])

    const trimmedTitle = title.trim()
    const trimmedSummary = summary.trim()
    const trimmedContent = content.trim()
    const canSubmit = trimmedTitle.length > 0 && !submitting

    async function handleSubmit() {
        if (!canSubmit) return

        setSubmitting(true)
        setApiError(null)

        try {
            const initialTags = ensureTypeTargetTagValues({}, tagSchemas, selectedType).tags
            const entry = await db_create_entry({
                projectId,
                categoryId,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                content: trimmedContent || null,
                type: selectedType,
                tags: buildEntryTagsPayload(initialTags, tagSchemas),
                images: null,
            })
            void showAlert('词条已创建', 'success', 'toast', 1000)
            await onCreated?.(entry)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="entry-creator-backdrop"
            onClick={e => {
                if (e.target === e.currentTarget && !submitting) onClose()
            }}
        >
            <div className="entry-creator-dialog" role="dialog" aria-modal="true" aria-label="新建词条">
                <div className="entry-creator-header">
                    <span className="entry-creator-title">新建词条</span>
                    <button
                        className="entry-creator-close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="entry-creator-body">
                    <div className="entry-creator-field">
                        <label className="entry-creator-label">
                            标题
                            <span className="entry-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <input
                            className="entry-creator-input"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSubmit()
                            }}
                            placeholder="例如：银灰塔、归航者公会、晨星誓约"
                            disabled={submitting}
                            autoFocus
                            maxLength={160}
                        />
                    </div>

                    <div className="entry-creator-field">
                        <label className="entry-creator-label">词条类型</label>
                        <div className="entry-creator-type-grid">
                            <button
                                type="button"
                                className={`entry-creator-type-chip${selectedType === null ? ' active' : ''}`}
                                onClick={() => setSelectedType(null)}
                                disabled={submitting}
                            >
                                不设置
                            </button>
                            {typeOptions.map(({key, entryType}) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`entry-creator-type-chip${selectedType === key ? ' active' : ''}`}
                                    style={{'--entry-creator-chip-color': entryType.color} as CSSProperties}
                                    onClick={() => setSelectedType(selectedType === key ? null : key)}
                                    disabled={submitting}
                                >
                                    <EntryTypeIcon entryType={entryType} className="entry-creator-type-icon"/>
                                    <span>{entryType.name}</span>
                                </button>
                            ))}
                        </div>
                        <p className="entry-creator-field-hint">
                            先把词条放进当前分类，类型可以现在定，也可以之后慢慢整理。
                        </p>
                    </div>

                    <div className="entry-creator-field">
                        <label className="entry-creator-label">摘要</label>
                        <textarea
                            className="entry-creator-textarea"
                            value={summary}
                            onChange={e => setSummary(e.target.value)}
                            placeholder="用一两句话概括这个词条最重要的信息…"
                            rows={3}
                            disabled={submitting}
                            maxLength={400}
                        />
                    </div>

                    <div className="entry-creator-field">
                        <div className="entry-creator-label-row">
                            <label className="entry-creator-label">正文</label>
                            <span className="entry-creator-shortcut">Ctrl/Command + Enter 提交</span>
                        </div>
                        <textarea
                            className="entry-creator-textarea entry-creator-textarea--content"
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSubmit()
                            }}
                            placeholder="先写下第一段设定、人物介绍、地点氛围或关键规则，词条就有了起点。"
                            rows={8}
                            disabled={submitting}
                            maxLength={20000}
                        />
                    </div>

                    {apiError && (
                        <p className="entry-creator-api-error">创建失败：{apiError}</p>
                    )}
                </div>

                <div className="entry-creator-footer">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                        {submitting ? '创建中…' : '创建词条'}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    )
}
