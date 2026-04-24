import {type CSSProperties, useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, useAlert} from 'flowcloudai-ui'
import {type CustomEntryType, db_create_entry_type, db_delete_entry_type, db_update_entry_type,} from '../../../api'
import './EntryTypeCreator.css'

const DEFAULT_COLOR = '#6B7280'

function isValidHexColor(value: string): boolean {
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

interface EntryTypeCreatorProps {
    open: boolean
    projectId: string
    initialEntryType?: CustomEntryType | null
    existingNames?: string[]
    onClose: () => void
    onSaved?: (entryType: CustomEntryType) => void
    onDeleted?: (entryTypeId: string) => void
}

export default function EntryTypeCreator({
                                             open,
                                             projectId,
                                             initialEntryType = null,
                                             existingNames = [],
                                             onClose,
                                             onSaved,
                                             onDeleted,
                                         }: EntryTypeCreatorProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [icon, setIcon] = useState('')
    const [color, setColor] = useState(DEFAULT_COLOR)
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)
    const {showAlert} = useAlert()
    const isEditMode = Boolean(initialEntryType)

    useEffect(() => {
        if (open) {
            queueMicrotask(() => {
                setName(initialEntryType?.name ?? '')
                setDescription(initialEntryType?.description ?? '')
                setIcon(initialEntryType?.icon ?? '')
                setColor(initialEntryType?.color ?? DEFAULT_COLOR)
                setApiError(null)
                setSubmitting(false)
            })
        }
    }, [open, initialEntryType])

    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, submitting, onClose])

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedIcon = icon.trim()
    const trimmedColor = color.trim()
    const originalName = initialEntryType?.name.trim().toLowerCase() ?? ''

    const isDuplicate = trimmedName.length > 0 &&
        existingNames.some(existing => {
            const normalized = existing.trim().toLowerCase()
            return normalized === trimmedName.toLowerCase() && normalized !== originalName
        })
    const hasInvalidColor = trimmedColor.length > 0 && !isValidHexColor(trimmedColor)
    const canSubmit = trimmedName.length > 0 && !isDuplicate && !hasInvalidColor && !submitting

    async function handleSubmit() {
        if (!canSubmit) return

        setSubmitting(true)
        setApiError(null)

        try {
            const payload = {
                name: trimmedName,
                description: trimmedDescription || null,
                icon: trimmedIcon || null,
                color: trimmedColor || null,
            }
            const entryType = initialEntryType
                ? await db_update_entry_type({
                    id: initialEntryType.id,
                    ...payload,
                })
                : await db_create_entry_type({
                    projectId,
                    ...payload,
                })
            void showAlert(isEditMode ? '词条类型已更新' : '词条类型已创建', 'success', 'toast', 1000)
            onSaved?.(entryType)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    async function handleDelete() {
        if (!initialEntryType || submitting) return

        const confirmed = await showAlert(`确认删除词条类型“${initialEntryType.name}”？`, 'warning', 'confirm')
        if (!confirmed) return

        setSubmitting(true)
        setApiError(null)

        try {
            await db_delete_entry_type(initialEntryType.id)
            void showAlert('词条类型已删除', 'success', 'toast', 1000)
            onDeleted?.(initialEntryType.id)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="entry-type-creator-backdrop"
            onClick={e => {
                if (e.target === e.currentTarget && !submitting) onClose()
            }}
        >
            <div
                className="entry-type-creator-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={isEditMode ? '编辑词条类型' : '新建词条类型'}
            >
                <div className="entry-type-creator-header">
                    <span className="entry-type-creator-title">{isEditMode ? '编辑词条类型' : '新建词条类型'}</span>
                    <button
                        className="entry-type-creator-close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75"
                                  strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="entry-type-creator-body">
                    <div className="entry-type-creator-field">
                        <label className="entry-type-creator-label">
                            类型名称
                            <span className="entry-type-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <input
                            className="entry-type-creator-input"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') void handleSubmit()
                            }}
                            placeholder="例如：魔法体系、信仰、法术"
                            disabled={submitting}
                            autoFocus
                            maxLength={120}
                        />
                        {isDuplicate && (
                            <p className="entry-type-creator-field-hint error">已有同名词条类型，请换一个名字</p>
                        )}
                    </div>

                    <div className="entry-type-creator-field">
                        <label className="entry-type-creator-label">图标</label>
                        <input
                            className="entry-type-creator-input"
                            value={icon}
                            onChange={e => setIcon(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') void handleSubmit()
                            }}
                            placeholder="支持 emoji 或短文本，例如：✨、术、宗"
                            disabled={submitting}
                            maxLength={8}
                        />
                        <p className="entry-type-creator-field-hint">留空也可以，类型仍可正常创建</p>
                    </div>

                    <div className="entry-type-creator-field">
                        <label className="entry-type-creator-label">颜色</label>
                        <div className="entry-type-creator-color-row">
                            <input
                                className="entry-type-creator-input"
                                value={color}
                                onChange={e => setColor(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') void handleSubmit()
                                }}
                                placeholder="#6B7280"
                                disabled={submitting}
                                maxLength={7}
                            />
                            <input
                                className="entry-type-creator-color-picker"
                                type="color"
                                value={isValidHexColor(trimmedColor) ? trimmedColor : DEFAULT_COLOR}
                                onChange={e => setColor(e.target.value)}
                                disabled={submitting}
                                aria-label="选择颜色"
                            />
                        </div>
                        {hasInvalidColor ? (
                            <p className="entry-type-creator-field-hint error">颜色必须是合法十六进制值，例如 #6B7280</p>
                        ) : (
                            <p className="entry-type-creator-field-hint">将用于词条筛选和标签颜色展示</p>
                        )}
                    </div>

                    <div className="entry-type-creator-preview">
                        <span
                            className="entry-type-creator-preview-chip"
                            style={{'--entry-type-creator-color': hasInvalidColor ? DEFAULT_COLOR : trimmedColor || DEFAULT_COLOR} as CSSProperties}
                        >
                            <span className="entry-type-creator-preview-icon">
                                {trimmedIcon || '•'}
                            </span>
                            <span>{trimmedName || '预览类型'}</span>
                        </span>
                    </div>

                    <div className="entry-type-creator-field">
                        <label className="entry-type-creator-label">描述</label>
                        <textarea
                            className="entry-type-creator-textarea"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="说明这个词条类型主要承载什么内容…（可选）"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                    </div>

                    {apiError && (
                        <p className="entry-type-creator-api-error">{isEditMode ? '保存失败' : '创建失败'}：{apiError}</p>
                    )}
                </div>

                <div className="entry-type-creator-footer">
                    {isEditMode ? (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete()} disabled={submitting}>
                            删除
                        </Button>
                    ) : (
                        <span/>
                    )}
                    <div className="entry-type-creator-footer__actions">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                            取消
                        </Button>
                        <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                            {submitting ? (isEditMode ? '保存中…' : '创建中…') : (isEditMode ? '保存' : '创建')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}
