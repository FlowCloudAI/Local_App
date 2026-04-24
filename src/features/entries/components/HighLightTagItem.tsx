import './HighLightTagItem.css'

type HighLightTagType = 'number' | 'string' | 'boolean'

type HighLightTagValue = string | number | boolean | null

interface HighLightTagSchema {
    id: string
    name: string
    type: HighLightTagType
    range_min?: number | null
    range_max?: number | null
}

interface HighLightTagItemProps {
    schema: HighLightTagSchema
    value?: HighLightTagValue
    implanted?: boolean
    mode?: 'show' | 'edit'
    onChange?: (value: HighLightTagValue) => void
}

function getTypeLabel(type: HighLightTagType): string {
    if (type === 'number') return '数值'
    if (type === 'boolean') return '布尔'
    return '文本'
}

function getRangeText(schema: HighLightTagSchema): string | null {
    if (schema.type !== 'number') return null
    const hasMin = typeof schema.range_min === 'number'
    const hasMax = typeof schema.range_max === 'number'
    if (!hasMin && !hasMax) return null
    if (hasMin && hasMax) return `建议范围 ${schema.range_min} - ${schema.range_max}`
    if (hasMin) return `建议不小于 ${schema.range_min}`
    return `建议不大于 ${schema.range_max}`
}

function formatValue(value?: HighLightTagValue): string {
    if (value == null || value === '') return '未填写'
    if (typeof value === 'boolean') return value ? '是' : '否'
    return String(value)
}

export default function HighLightTagItem({
                                             schema,
                                             value = null,
                                             implanted = false,
                                             mode = 'show',
                                             onChange,
                                         }: HighLightTagItemProps) {
    const rangeText = getRangeText(schema)
    const isEditMode = mode === 'edit'

    return (
        <div className={`highlight-tag-item${isEditMode ? ' is-edit' : ' is-show'}`}>
            <div className="highlight-tag-item__header">
                <div className="highlight-tag-item__title-group">
                    <span className="highlight-tag-item__title">{schema.name}</span>
                    {implanted && <span className="highlight-tag-item__badge">植入</span>}
                </div>
                <span className={`highlight-tag-item__type is-${schema.type}`}>{getTypeLabel(schema.type)}</span>
            </div>

            {rangeText && (
                <p className="highlight-tag-item__hint">{rangeText}</p>
            )}

            {isEditMode ? (
                schema.type === 'boolean' ? (
                    <div className="highlight-tag-item__bool-group highlight-tag-item__bool-group--edit">
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value == null ? ' active' : ''}`}
                            onClick={() => onChange?.(null)}
                        >
                            未填写
                        </button>
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value === true ? ' active' : ''}`}
                            onClick={() => onChange?.(true)}
                        >
                            是
                        </button>
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value === false ? ' active' : ''}`}
                            onClick={() => onChange?.(false)}
                        >
                            否
                        </button>
                    </div>
                ) : (
                    <div className="highlight-tag-item__editor highlight-tag-item__editor--edit">
                        <input
                            className="highlight-tag-item__input"
                            type={schema.type === 'number' ? 'number' : 'text'}
                            inputMode={schema.type === 'number' ? 'decimal' : 'text'}
                            value={value == null ? '' : String(value)}
                            onChange={(event) => {
                                const raw = event.target.value
                                if (!raw.trim()) {
                                    onChange?.(null)
                                    return
                                }

                                if (schema.type === 'number') {
                                    const parsed = Number(raw)
                                    if (Number.isFinite(parsed)) {
                                        onChange?.(parsed)
                                    }
                                    return
                                }

                                onChange?.(raw)
                            }}
                            placeholder={schema.type === 'number' ? '输入数值' : '输入标签内容'}
                        />
                        <button
                            type="button"
                            className="highlight-tag-item__clear"
                            onClick={() => onChange?.(null)}
                            disabled={value == null || value === ''}
                        >
                            清空
                        </button>
                    </div>
                )
            ) : (
                <div
                    className={`highlight-tag-item__value highlight-tag-item__value--show${value == null || value === '' ? ' is-empty' : ''}`}>
                    {formatValue(value)}
                </div>
            )}
        </div>
    )
}
