import type {CSSProperties} from 'react'
import {Button, Select, TagItem} from 'flowcloudai-ui'
import type {Category, Entry, EntryTypeView, TagSchema} from '../../../api'
import HighLightTagItem from './HighLightTagItem'
import EntryTypeIcon from '../../project-editor/components/EntryTypeIcon'
import {
    buildEntryPath,
    formatDate,
    getCategoryName,
    normalizeComparableText,
    normalizeComparableType,
} from '../lib/entryCommon'
import {getComparableTagValue, normalizeComparableTagValue} from '../lib/entryTag'
import type {EntryImage} from '../lib/entryImage'
import {getCoverImage, toEntryImageSrc} from '../lib/entryImage'
import {
    CHARACTER_VOICE_AUTO_PLAY_TAG,
    CHARACTER_VOICE_ID_TAG,
    readCharacterVoiceConfigFromDraftTags,
} from '../lib/characterVoice'

interface EntryEditorMetaPanelProps {
    entryId: string
    entry: Entry | null
    draft: {
        title: string
        summary: string
        content: string
        type: string | null
        tags: Record<string, string | number | boolean | null>
        images: EntryImage[]
    }
    editorMode: 'edit' | 'browse'
    loading: boolean
    saving: boolean
    generatingSummary: boolean
    projectName: string
    categories: Category[]
    entryTypes: EntryTypeView[]
    localTagSchemas: TagSchema[]
    visibleTagSchemas: TagSchema[]
    browseVisibleTagSchemas: TagSchema[]
    implantedTagSchemaIdSet: Set<string>
    availableTagSchemaOptions: { value: string; label: string }[]
    tagSchemaPickerValue: string | undefined
    ttsVoiceOptions: { value: string; label: string }[]
    ttsVoiceSelectable: boolean
    ttsVoicePluginName: string | null
    ttsVoiceHint: string
    onDraftChange: (updater: (prev: EntryEditorMetaPanelProps['draft']) => EntryEditorMetaPanelProps['draft']) => void
    onOpenImageAddModal: () => void
    onViewImageSet: () => void
    onGenerateSummary: () => void
    onAddVisibleTagSchema: (schemaId: string) => void
    onOpenTagCreator: () => void
    onStartCharacterChat?: () => void
}

export default function EntryEditorMetaPanel({
                                                 entryId,
                                                 entry,
                                                 draft,
                                                 editorMode,
                                                 loading,
                                                 saving,
                                                 generatingSummary,
                                                 projectName,
                                                 categories,
                                                 entryTypes,
                                                 localTagSchemas,
                                                 visibleTagSchemas,
                                                 browseVisibleTagSchemas,
                                                 implantedTagSchemaIdSet,
                                                 availableTagSchemaOptions,
                                                 tagSchemaPickerValue,
                                                 ttsVoiceOptions,
                                                 ttsVoiceSelectable,
                                                 ttsVoicePluginName,
                                                 ttsVoiceHint,
                                                 onDraftChange,
                                                 onOpenImageAddModal,
                                                 onViewImageSet,
                                                 onGenerateSummary,
                                                 onAddVisibleTagSchema,
                                                 onOpenTagCreator,
                                                 onStartCharacterChat,
                                             }: EntryEditorMetaPanelProps) {
    const isBrowseMode = editorMode === 'browse'
    const trimmedTitle = normalizeComparableText(draft.title)
    const trimmedSummary = normalizeComparableText(draft.summary)
    const infoTitle = trimmedTitle || entry?.title || '未命名词条'
    const coverImage = getCoverImage(draft.images)
    const coverSrc = toEntryImageSrc(coverImage)
    const coverHintText = isBrowseMode ? '暂无主图' : '点击添加图片'
    const entryPathLabel = buildEntryPath(projectName, categories, entry?.category_id ?? null, infoTitle)
    const entryCreatedAtText = formatDate(entry?.['created_at'] as string | null | undefined)
    const entryUpdatedAtText = formatDate(entry?.updated_at as string | null | undefined)
    const isCharacterEntry = normalizeComparableType(draft.type) === 'character'
    const characterVoiceConfig = readCharacterVoiceConfigFromDraftTags(draft.tags)

    const typeOptions = entryTypes.map((entryType) => {
        const kind = entryType.kind
        const name = entryType.name
        const color = entryType.color
        const key = kind === 'builtin' ? (entryType as { key: string }).key : (entryType as { id: string }).id
        return {key, entryType: {...entryType, kind, name, color} as EntryTypeView}
    })
    const builtinTypeOptions = typeOptions.filter(({entryType}) => entryType.kind === 'builtin')
    const customTypeOptions = typeOptions
        .filter(({entryType}) => entryType.kind === 'custom')
        .map(({key, entryType}) => ({value: key, label: entryType.name}))

    return (
        <div className="entry-editor-meta-layout">
            <div className="entry-editor-cover-panel">
                <button
                    type="button"
                    className={`entry-editor-cover ${coverSrc ? 'has-image' : ''}`}
                    onClick={() => {
                        if (draft.images.length) {
                            // lightbox open handled by parent
                        } else if (!isBrowseMode) {
                            onOpenImageAddModal()
                        }
                    }}
                >
                    {coverSrc ? (
                        <img src={coverSrc} alt={coverImage?.alt || infoTitle} className="entry-editor-cover__image"/>
                    ) : (
                        <div className="entry-editor-cover__placeholder">
                            <span className="entry-editor-cover__mark">{infoTitle[0] ?? '词'}</span>
                            <span className="entry-editor-cover__hint">{coverHintText}</span>
                        </div>
                    )}
                </button>

                <div className="entry-editor-cover__toolbar">
                    {!isBrowseMode && (
                        <Button variant="outline" size="sm" onClick={() => onOpenImageAddModal()}>
                            添加图片
                        </Button>
                    )}
                    {coverImage && (
                        <Button variant="ghost" size="sm" onClick={onViewImageSet}>
                            查看设定集
                        </Button>
                    )}
                </div>
            </div>

            <div className="entry-editor-meta-panel">
                <div className="entry-editor-meta-panel__section">
                    <label className="entry-editor-field-label">
                        标题
                        {!isBrowseMode && (
                            <span className="entry-editor-required" aria-hidden="true"> *</span>
                        )}
                    </label>
                    {isBrowseMode ? (
                        <div className="entry-editor-readonly-title">{infoTitle}</div>
                    ) : (
                        <>
                            <input
                                className={`entry-editor-title-input${trimmedTitle ? '' : ' is-missing'}`}
                                value={draft.title}
                                onChange={(event) => onDraftChange((current) => (
                                    normalizeComparableText(current.title) === normalizeComparableText(event.target.value)
                                        ? current
                                        : {...current, title: event.target.value}
                                ))}
                                placeholder="输入词条标题"
                                disabled={saving || loading}
                                autoFocus={!trimmedTitle}
                            />
                            {!trimmedTitle && (
                                <div className="entry-editor-field-hint entry-editor-field-hint--required">
                                    请填写标题，标题不能为空。
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="entry-editor-meta-panel__section">
                    <div className="entry-editor-field-label-row">
                        <label className="entry-editor-field-label">摘要</label>
                        {!isBrowseMode && (
                            <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                disabled={saving || loading || generatingSummary}
                                onClick={onGenerateSummary}
                            >
                                {generatingSummary ? '总结中…' : 'AI总结'}
                            </Button>
                        )}
                    </div>
                    {isBrowseMode ? (
                        <div className={`entry-editor-readonly-summary${trimmedSummary ? '' : ' is-empty'}`}>
                            {trimmedSummary || '暂无摘要'}
                        </div>
                    ) : (
                        <textarea
                            className="entry-editor-summary-input"
                            value={draft.summary}
                            onChange={(event) => onDraftChange((current) => (
                                normalizeComparableText(current.summary) === normalizeComparableText(event.target.value)
                                    ? current
                                    : {...current, summary: event.target.value}
                            ))}
                            placeholder="用一两句话概括这个词条的核心信息"
                            rows={2}
                            disabled={saving || loading}
                        />
                    )}
                </div>

                {isBrowseMode && isCharacterEntry && onStartCharacterChat && (
                    <div className="entry-editor-meta-panel__section">
                        <div className="entry-editor-field-label-row">
                            <label className="entry-editor-field-label">角色对话</label>
                            <span className="entry-editor-field-note">以该角色身份在 AI 对话中继续交流</span>
                        </div>
                        <Button variant="outline" size="sm" type="button" onClick={onStartCharacterChat}>
                            和 TA 聊天
                        </Button>
                    </div>
                )}

                {isCharacterEntry && (
                    <div className="entry-editor-meta-panel__section">
                        <div className="entry-editor-field-label-row">
                            <label className="entry-editor-field-label">角色语音</label>
                            <span
                                className="entry-editor-field-note">留空时跟随全局 TTS 默认音色{ttsVoicePluginName ? ` · 当前来源：${ttsVoicePluginName}` : ''}</span>
                        </div>
                        {isBrowseMode ? (
                            <div className="entry-editor-readonly-summary">
                                <div>音色 ID：{characterVoiceConfig.voiceId || '跟随全局默认'}</div>
                                <div style={{marginTop: '0.35rem'}}>
                                    自动播放：{characterVoiceConfig.autoPlay == null ? '跟随全局设置' : (characterVoiceConfig.autoPlay ? '开启' : '关闭')}
                                </div>
                            </div>
                        ) : (
                            <div className="entry-editor-character-voice">
                                <Select
                                    options={ttsVoiceOptions}
                                    value={characterVoiceConfig.voiceId ?? ''}
                                    onChange={(value) => onDraftChange((current) => {
                                        const nextVoiceId = value ? normalizeComparableText(String(value)) : ''
                                        const nextTags = {...current.tags}
                                        if (nextVoiceId) {
                                            nextTags[CHARACTER_VOICE_ID_TAG] = nextVoiceId
                                        } else {
                                            delete nextTags[CHARACTER_VOICE_ID_TAG]
                                        }
                                        return {
                                            ...current,
                                            tags: nextTags,
                                        }
                                    })}
                                    disabled={saving || loading || !ttsVoiceSelectable}
                                />
                                <div className="entry-editor-field-note">{ttsVoiceHint}</div>
                                <label className="entry-editor-character-voice__toggle">
                                    <input
                                        type="checkbox"
                                        checked={characterVoiceConfig.autoPlay ?? false}
                                        onChange={(event) => onDraftChange((current) => ({
                                            ...current,
                                            tags: {
                                                ...current.tags,
                                                [CHARACTER_VOICE_AUTO_PLAY_TAG]: event.target.checked,
                                            },
                                        }))}
                                        disabled={saving || loading}
                                    />
                                    <span>自动播放角色回复</span>
                                </label>
                                {characterVoiceConfig.autoPlay == null && (
                                    <button
                                        type="button"
                                        className="entry-editor-character-voice__reset"
                                        onClick={() => onDraftChange((current) => {
                                            const nextTags = {...current.tags}
                                            delete nextTags[CHARACTER_VOICE_AUTO_PLAY_TAG]
                                            return {
                                                ...current,
                                                tags: nextTags,
                                            }
                                        })}
                                        disabled={saving || loading}
                                    >
                                        当前：跟随全局设置
                                    </button>
                                )}
                                {characterVoiceConfig.autoPlay != null && (
                                    <button
                                        type="button"
                                        className="entry-editor-character-voice__reset"
                                        onClick={() => onDraftChange((current) => {
                                            const nextTags = {...current.tags}
                                            delete nextTags[CHARACTER_VOICE_AUTO_PLAY_TAG]
                                            return {
                                                ...current,
                                                tags: nextTags,
                                            }
                                        })}
                                        disabled={saving || loading}
                                    >
                                        改为跟随全局自动播放设置
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="entry-editor-meta-panel__section">
                    <div className="entry-editor-field-label-row">
                        <label className="entry-editor-field-label">词条类型</label>
                        {!isBrowseMode &&
                            <span className="entry-editor-field-note">切换后会同步影响植入标签的重点显示</span>}
                    </div>
                    {isBrowseMode ? (
                        <div className="entry-editor-type-grid">
                            {draft.type ? (
                                (() => {
                                    const selectedType = typeOptions.find(({key}) => key === draft.type)
                                    return selectedType ? (
                                        <span
                                            className="entry-editor-type-chip active is-readonly"
                                            style={{'--entry-editor-chip-color': selectedType.entryType.color} as CSSProperties}
                                        >
                                            <EntryTypeIcon entryType={selectedType.entryType}
                                                           className="entry-editor-type-chip__icon"/>
                                            <span>{selectedType.entryType.name}</span>
                                        </span>
                                    ) : (
                                        <span className="entry-editor-type-chip is-readonly">未设置</span>
                                    )
                                })()
                            ) : (
                                <span className="entry-editor-type-chip is-readonly">未设置</span>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="entry-editor-type-grid">
                                <button
                                    type="button"
                                    className={`entry-editor-type-chip${draft.type === null ? ' active' : ''}`}
                                    onClick={() => onDraftChange((current) => (
                                        normalizeComparableType(current.type) === null
                                            ? current
                                            : {...current, type: null}
                                    ))}
                                >
                                    不设置
                                </button>
                                {builtinTypeOptions.map(({key, entryType}) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`entry-editor-type-chip${draft.type === key ? ' active' : ''}`}
                                        style={{'--entry-editor-chip-color': entryType.color} as CSSProperties}
                                        onClick={() => onDraftChange((current) => ({
                                            ...current,
                                            type: normalizeComparableType(current.type) === key ? null : key,
                                        }))}
                                    >
                                        <EntryTypeIcon entryType={entryType} className="entry-editor-type-chip__icon"/>
                                        <span>{entryType.name}</span>
                                    </button>
                                ))}
                            </div>
                            {customTypeOptions.length > 0 && (
                                <div className="entry-editor-custom-type">
                                    <label className="entry-editor-field-label">自定义类型</label>
                                    <Select
                                        className="entry-editor-select"
                                        options={customTypeOptions}
                                        value={draft.type && customTypeOptions.some(option => option.value === draft.type) ? draft.type : undefined}
                                        onChange={(value) => onDraftChange((current) => {
                                            const nextType = normalizeComparableType(typeof value === 'string' ? value : null)
                                            return normalizeComparableType(current.type) === nextType
                                                ? current
                                                : {
                                                    ...current,
                                                    type: nextType,
                                                }
                                        })}
                                        placeholder="搜索并选择自定义词条类型"
                                        searchable
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="entry-editor-meta-panel__section">
                    <div className="entry-editor-field-label-row">
                        <label className="entry-editor-field-label">标签</label>
                        {!isBrowseMode && (
                            <div className="entry-editor-tag-actions">
                                {availableTagSchemaOptions.length > 0 && (
                                    <div className="entry-editor-tag-picker">
                                        <Select
                                            className="entry-editor-select"
                                            options={availableTagSchemaOptions}
                                            value={tagSchemaPickerValue}
                                            onChange={(value) => {
                                                if (typeof value !== 'string') return
                                                onAddVisibleTagSchema(value)
                                            }}
                                            placeholder="添加已有标签"
                                            searchable
                                        />
                                    </div>
                                )}
                                <Button variant="ghost" size="sm" onClick={onOpenTagCreator}>
                                    + 新建标签
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="entry-editor-field-note">
                        {draft.type
                            ? '当前词条类型的植入标签会重点显示；切换类型后，原有标签只会取消强调，不会被删除。'
                            : '未设置词条类型时，仅显示已添加的标签。'}
                    </div>
                    {localTagSchemas.length === 0 ? (
                        <div className="entry-editor-empty-tip">当前项目还没有标签定义，先创建一个再给词条填写。</div>
                    ) : isBrowseMode ? (
                        browseVisibleTagSchemas.length > 0 ? (
                            <div className="entry-editor-tags-grid entry-editor-tags-grid--browse">
                                {browseVisibleTagSchemas.map((schema) => {
                                    const value = getComparableTagValue(draft.tags, schema)
                                    const isImplanted = implantedTagSchemaIdSet.has(schema.id)
                                    return (
                                        <div
                                            key={`${entryId}-${schema.id}`}
                                            className="entry-editor-tag-card"
                                        >
                                            {isImplanted ? (
                                                <HighLightTagItem
                                                    schema={{
                                                        id: schema.id,
                                                        name: schema.name,
                                                        type: schema.type as 'number' | 'string' | 'boolean',
                                                        range_min: schema.range_min ?? null,
                                                        range_max: schema.range_max ?? null,
                                                    }}
                                                    value={value}
                                                    implanted
                                                    mode="show"
                                                />
                                            ) : (
                                                <TagItem
                                                    schema={{
                                                        id: schema.id,
                                                        name: schema.name,
                                                        type: schema.type as 'number' | 'string' | 'boolean',
                                                        range_min: schema.range_min ?? null,
                                                        range_max: schema.range_max ?? null,
                                                    }}
                                                    value={value ?? undefined}
                                                    mode="show"
                                                />
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="entry-editor-empty-tip">当前词条还没有标签值。</div>
                        )
                    ) : (
                        visibleTagSchemas.length > 0 ? (
                            <div className="entry-editor-tags-grid entry-editor-tags-grid--edit">
                                {visibleTagSchemas.map((schema) => (
                                    <div
                                        key={`${entryId}-${schema.id}`}
                                        className="entry-editor-tag-card"
                                    >
                                        {implantedTagSchemaIdSet.has(schema.id) ? (
                                            <HighLightTagItem
                                                schema={{
                                                    id: schema.id,
                                                    name: schema.name,
                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                    range_min: schema.range_min ?? null,
                                                    range_max: schema.range_max ?? null,
                                                }}
                                                value={draft.tags[schema.id] ?? draft.tags[schema.name] ?? null}
                                                implanted
                                                mode="edit"
                                                onChange={(value) => onDraftChange((current) => {
                                                    const nextValue = normalizeComparableTagValue(value)
                                                    const currentValue = getComparableTagValue(current.tags, schema)
                                                    if (currentValue === nextValue) return current
                                                    return {
                                                        ...current,
                                                        tags: {
                                                            ...current.tags,
                                                            [schema.id]: nextValue,
                                                        },
                                                    }
                                                })}
                                            />
                                        ) : (
                                            <TagItem
                                                schema={{
                                                    id: schema.id,
                                                    name: schema.name,
                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                    range_min: schema.range_min ?? null,
                                                    range_max: schema.range_max ?? null,
                                                }}
                                                value={draft.tags[schema.id] ?? draft.tags[schema.name] ?? undefined}
                                                mode="edit"
                                                onChange={(value) => onDraftChange((current) => {
                                                    const nextValue = normalizeComparableTagValue(value)
                                                    const currentValue = getComparableTagValue(current.tags, schema)
                                                    if (currentValue === nextValue) return current
                                                    return {
                                                        ...current,
                                                        tags: {
                                                            ...current.tags,
                                                            [schema.id]: nextValue,
                                                        },
                                                    }
                                                })}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div
                                className="entry-editor-empty-tip">当前词条还没有已添加标签，可从已有标签中选择，或新建一个标签。</div>
                        )
                    )}
                    <div className="entry-editor-entry-meta">
                        <span>路径：{entryPathLabel}</span>
                        <span>分类：{getCategoryName(categories, entry?.category_id ?? null)}</span>
                        <span>创建于 {entryCreatedAtText}</span>
                        <span>更新于 {entryUpdatedAtText}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
