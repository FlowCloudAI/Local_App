import {type CSSProperties, useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    db_create_tag_schema,
    db_delete_tag_schema,
    db_update_tag_schema,
    entryTypeKey,
    type EntryTypeView,
    type TagSchema,
} from '../api'
import EntryTypeIcon from './project-editor/EntryTypeIcon'
import './TagCreator.css'

type TagValueType = 'string' | 'number' | 'boolean'

const TAG_TYPE_OPTIONS: {value: TagValueType; label: string; description: string}[] = [
    {value: 'string', label: '文本', description: '适合称号、派系、状态等文字标签'},
    {value: 'number', label: '数值', description: '适合等级、战力、年龄等可比较数值'},
    {value: 'boolean', label: '布尔', description: '适合是否掌握、是否公开等开关标签'},
]

function parseOptionalNumber(raw: string): number | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    return Number(trimmed)
}

function normalizeTagTargets(target: string[] | string | null | undefined): string[] {
    if (Array.isArray(target)) {
        return [...new Set(target.map(item => item.trim()).filter(Boolean))]
    }
    if (typeof target !== 'string') return []

    const trimmed = target.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (parsed !== target) return normalizeTagTargets(parsed as string[] | string | null | undefined)
    } catch {
        // 兼容旧数据里可能存在的逗号分隔字符串
    }

    return [...new Set(trimmed.split(',').map(item => item.trim()).filter(Boolean))]
}

interface TagCreatorProps {
    open: boolean
    projectId: string
    entryTypes: EntryTypeView[]
    initialTag?: TagSchema | null
    existingNames?: string[]
    existingCount?: number
    onClose: () => void
    onSaved?: (schema: TagSchema) => void
    onDeleted?: (schemaId: string) => void
}

export default function TagCreator({
    open,
    projectId,
    entryTypes,
    initialTag = null,
    existingNames = [],
    existingCount = 0,
    onClose,
    onSaved,
    onDeleted,
}: TagCreatorProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [valueType, setValueType] = useState<TagValueType>('string')
    const [defaultValue, setDefaultValue] = useState('')
    const [rangeMin, setRangeMin] = useState('')
    const [rangeMax, setRangeMax] = useState('')
    const [selectedTargets, setSelectedTargets] = useState<string[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)
    const {showAlert} = useAlert()
    const isEditMode = Boolean(initialTag)

    const allTargetKeys = useMemo(
        () => entryTypes.map(entryType => entryTypeKey(entryType)),
        [entryTypes]
    )

    useEffect(() => {
        if (open) {
            queueMicrotask(() => {
                setName(initialTag?.name ?? '')
                setDescription(initialTag?.description ?? '')
                setValueType((initialTag?.type as TagValueType | undefined) ?? 'string')
                setDefaultValue(initialTag?.default_val ?? '')
                setRangeMin(initialTag?.range_min != null ? String(initialTag.range_min) : '')
                setRangeMax(initialTag?.range_max != null ? String(initialTag.range_max) : '')
                setSelectedTargets(normalizeTagTargets(initialTag?.target))
                setApiError(null)
                setSubmitting(false)
            })
        }
    }, [open, initialTag, allTargetKeys])

    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, submitting, onClose])

    const trimmedName = name.trim()
    const trimmedDefaultValue = defaultValue.trim()
    const trimmedDescription = description.trim()
    const originalName = initialTag?.name.trim().toLowerCase() ?? ''

    const isDuplicate = trimmedName.length > 0 &&
        existingNames.some(existing => {
            const normalized = existing.trim().toLowerCase()
            return normalized === trimmedName.toLowerCase() && normalized !== originalName
        })

    const parsedRangeMin = parseOptionalNumber(rangeMin)
    const parsedRangeMax = parseOptionalNumber(rangeMax)
    const hasInvalidRangeMin = rangeMin.trim() !== '' && !Number.isFinite(parsedRangeMin)
    const hasInvalidRangeMax = rangeMax.trim() !== '' && !Number.isFinite(parsedRangeMax)
    const hasInvalidRangeOrder = Number.isFinite(parsedRangeMin) &&
        Number.isFinite(parsedRangeMax) &&
        (parsedRangeMin as number) > (parsedRangeMax as number)

    let normalizedDefaultValue: string | null = trimmedDefaultValue || null
    let defaultValueError: string | null = null

    if (valueType === 'number' && normalizedDefaultValue !== null) {
        const parsed = Number(normalizedDefaultValue)
        if (!Number.isFinite(parsed)) {
            defaultValueError = '默认值必须是合法数字'
        } else {
            if (Number.isFinite(parsedRangeMin) && parsed < (parsedRangeMin as number)) {
                defaultValueError = '默认值不能小于最小值'
            }
            if (!defaultValueError && Number.isFinite(parsedRangeMax) && parsed > (parsedRangeMax as number)) {
                defaultValueError = '默认值不能大于最大值'
            }
        }
    }

    if (valueType === 'boolean' && normalizedDefaultValue !== null) {
        const lowered = normalizedDefaultValue.toLowerCase()
        if (lowered !== 'true' && lowered !== 'false') {
            defaultValueError = '布尔默认值只能是 true 或 false'
        } else {
            normalizedDefaultValue = lowered
        }
    }

    const canSubmit = trimmedName.length > 0 &&
        !isDuplicate &&
        !hasInvalidRangeMin &&
        !hasInvalidRangeMax &&
        !hasInvalidRangeOrder &&
        !defaultValueError &&
        !submitting

    const typeDescription = TAG_TYPE_OPTIONS.find(option => option.value === valueType)?.description

    function toggleTarget(targetKey: string) {
        setSelectedTargets(prev =>
            prev.includes(targetKey)
                ? prev.filter(key => key !== targetKey)
                : [...prev, targetKey]
        )
    }

    async function handleSubmit() {
        if (!canSubmit) return

        setSubmitting(true)
        setApiError(null)

        try {
            const payload = {
                projectId,
                name: trimmedName,
                description: trimmedDescription || null,
                type: valueType,
                target: normalizeTagTargets(selectedTargets),
                defaultVal: normalizedDefaultValue,
                rangeMin: valueType === 'number' ? parsedRangeMin : null,
                rangeMax: valueType === 'number' ? parsedRangeMax : null,
                sortOrder: initialTag?.sort_order ?? existingCount,
            }
            const schema = initialTag
                ? await db_update_tag_schema({
                    id: initialTag.id,
                    ...payload,
                })
                : await db_create_tag_schema(payload)
            void showAlert(isEditMode ? '标签已更新' : '标签已创建', 'success', 'toast', 1000)
            onSaved?.(schema)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    async function handleDelete() {
        if (!initialTag || submitting) return

        const confirmed = await showAlert(`确认删除标签“${initialTag.name}”？`, 'warning', 'confirm')
        if (!confirmed) return

        setSubmitting(true)
        setApiError(null)

        try {
            await db_delete_tag_schema(initialTag.id)
            void showAlert('标签已删除', 'success', 'toast', 1000)
            onDeleted?.(initialTag.id)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="tag-creator-backdrop"
            onClick={e => {
                if (e.target === e.currentTarget && !submitting) onClose()
            }}
        >
            <div
                className="tag-creator-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={isEditMode ? '编辑标签' : '新建标签'}
            >
                <div className="tag-creator-header">
                    <span className="tag-creator-title">{isEditMode ? '编辑标签' : '新建标签'}</span>
                    <button
                        className="tag-creator-close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="tag-creator-body">
                    <div className="tag-creator-field">
                        <label className="tag-creator-label">
                            标签名称
                            <span className="tag-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <input
                            className="tag-creator-input"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') void handleSubmit()
                            }}
                            placeholder="例如：阵营、危险等级、是否公开"
                            disabled={submitting}
                            autoFocus
                            maxLength={120}
                        />
                        {isDuplicate && (
                            <p className="tag-creator-field-hint error">已有同名标签，请换一个名字</p>
                        )}
                    </div>

                    <div className="tag-creator-field">
                        <label className="tag-creator-label">
                            标签类型
                            <span className="tag-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <div className="tag-creator-option-grid">
                            {TAG_TYPE_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={`tag-creator-option-card${valueType === option.value ? ' active' : ''}`}
                                    onClick={() => setValueType(option.value)}
                                    disabled={submitting}
                                >
                                    <span className="tag-creator-option-title">{option.label}</span>
                                    <span className="tag-creator-option-description">{option.description}</span>
                                </button>
                            ))}
                        </div>
                        {typeDescription && (
                            <p className="tag-creator-field-hint">{typeDescription}</p>
                        )}
                    </div>

                    <div className="tag-creator-field">
                        <div className="tag-creator-label-row">
                            <label className="tag-creator-label">植入词条类型</label>
                            <div className="tag-creator-mini-actions">
                                <button
                                    type="button"
                                    className="tag-creator-mini-action"
                                    onClick={() => setSelectedTargets(allTargetKeys)}
                                    disabled={submitting}
                                >
                                    全选
                                </button>
                                <button
                                    type="button"
                                    className="tag-creator-mini-action"
                                    onClick={() => setSelectedTargets([])}
                                    disabled={submitting}
                                >
                                    清空
                                </button>
                            </div>
                        </div>
                        <p className="tag-creator-field-hint">
                            选中的词条类型会默认植入这个标签；不植入的情况下，它会作为可手动添加的自由标签。
                        </p>

                        <div className="tag-creator-target-grid">
                            {entryTypes.map(entryType => {
                                const key = entryTypeKey(entryType)
                                const active = selectedTargets.includes(key)
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`tag-creator-target-chip${active ? ' active' : ''}`}
                                        style={{'--tag-creator-chip-color': entryType.color} as CSSProperties}
                                        onClick={() => toggleTarget(key)}
                                        disabled={submitting}
                                        aria-pressed={active}
                                    >
                                        <EntryTypeIcon entryType={entryType} className="tag-creator-target-icon"/>
                                        <span>{entryType.name}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="tag-creator-field">
                        <label className="tag-creator-label">默认值</label>
                        {valueType === 'boolean' ? (
                            <div className="tag-creator-bool-options">
                                <button
                                    type="button"
                                    className={`tag-creator-bool-chip${trimmedDefaultValue === '' ? ' active' : ''}`}
                                    onClick={() => setDefaultValue('')}
                                    disabled={submitting}
                                >
                                    不设置
                                </button>
                                <button
                                    type="button"
                                    className={`tag-creator-bool-chip${trimmedDefaultValue === 'true' ? ' active' : ''}`}
                                    onClick={() => setDefaultValue('true')}
                                    disabled={submitting}
                                >
                                    true
                                </button>
                                <button
                                    type="button"
                                    className={`tag-creator-bool-chip${trimmedDefaultValue === 'false' ? ' active' : ''}`}
                                    onClick={() => setDefaultValue('false')}
                                    disabled={submitting}
                                >
                                    false
                                </button>
                            </div>
                        ) : (
                            <input
                                className="tag-creator-input"
                                value={defaultValue}
                                onChange={e => setDefaultValue(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') void handleSubmit()
                                }}
                                placeholder={valueType === 'number' ? '例如：100' : '例如：机密'}
                                disabled={submitting}
                                inputMode={valueType === 'number' ? 'decimal' : 'text'}
                            />
                        )}
                        {defaultValueError && (
                            <p className="tag-creator-field-hint error">{defaultValueError}</p>
                        )}
                    </div>

                    {valueType === 'number' && (
                        <div className="tag-creator-field">
                            <label className="tag-creator-label">数值范围</label>
                            <div className="tag-creator-range-row">
                                <input
                                    className="tag-creator-input"
                                    value={rangeMin}
                                    onChange={e => setRangeMin(e.target.value)}
                                    placeholder="最小值"
                                    disabled={submitting}
                                    inputMode="decimal"
                                />
                                <span className="tag-creator-range-sep">至</span>
                                <input
                                    className="tag-creator-input"
                                    value={rangeMax}
                                    onChange={e => setRangeMax(e.target.value)}
                                    placeholder="最大值"
                                    disabled={submitting}
                                    inputMode="decimal"
                                />
                            </div>
                            {hasInvalidRangeMin && (
                                <p className="tag-creator-field-hint error">最小值必须是合法数字</p>
                            )}
                            {!hasInvalidRangeMin && hasInvalidRangeMax && (
                                <p className="tag-creator-field-hint error">最大值必须是合法数字</p>
                            )}
                            {!hasInvalidRangeMin && !hasInvalidRangeMax && hasInvalidRangeOrder && (
                                <p className="tag-creator-field-hint error">最小值不能大于最大值</p>
                            )}
                        </div>
                    )}

                    <div className="tag-creator-field">
                        <label className="tag-creator-label">描述</label>
                        <textarea
                            className="tag-creator-textarea"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="说明这个标签用来描述什么…（可选）"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                    </div>

                    {apiError && (
                        <p className="tag-creator-api-error">{isEditMode ? '保存失败' : '创建失败'}：{apiError}</p>
                    )}
                </div>

                <div className="tag-creator-footer">
                    {isEditMode ? (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete()} disabled={submitting}>
                            删除
                        </Button>
                    ) : (
                        <span />
                    )}
                    <div className="tag-creator-footer__actions">
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
