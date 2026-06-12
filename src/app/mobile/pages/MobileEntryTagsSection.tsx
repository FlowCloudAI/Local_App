import {type ComponentProps, type Dispatch, type SetStateAction} from 'react'
import {Button, Select, TagItem} from 'flowcloudai-ui'
import {type TagSchema} from '../../../api'
import {
    getComparableTagValue,
    normalizeComparableTagValue,
} from '../../../features/entries/lib/entryTag'
import {type TagValueMap} from './MobileEntryDetailUtils'

type SelectOptions = NonNullable<ComponentProps<typeof Select>['options']>

interface MobileEntryTagsSectionProps {
    hasTagDefinitions: boolean
    availableTagSchemaOptions: SelectOptions
    tagSchemaPickerValue?: string
    editTagSchemas: TagSchema[]
    tagDraft: TagValueMap
    onAddVisibleTagSchema: (schemaId: string) => void
    onTagDraftChange: Dispatch<SetStateAction<TagValueMap>>
    onOpenTagCreator: () => void
}

export function MobileEntryTagsSection({
    hasTagDefinitions,
    availableTagSchemaOptions,
    tagSchemaPickerValue,
    editTagSchemas,
    tagDraft,
    onAddVisibleTagSchema,
    onTagDraftChange,
    onOpenTagCreator,
}: MobileEntryTagsSectionProps) {
    return (
        <section className="mobile-entry-detail__tags mobile-entry-detail__form-section">
            <div className="mobile-entry-detail__tags-header">
                <div className="mobile-entry-detail__tags-label">标签</div>
                <div className="mobile-entry-detail__tags-actions">
                    {availableTagSchemaOptions.length > 0 && (
                        <Select
                            value={tagSchemaPickerValue}
                            onChange={(value) => {
                                if (typeof value !== 'string') return
                                onAddVisibleTagSchema(value)
                            }}
                            options={availableTagSchemaOptions}
                            placeholder="添加已有标签"
                            searchable
                            className="mobile-entry-detail__tag-select"
                        />
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={onOpenTagCreator}>
                        + 新建标签
                    </Button>
                </div>
            </div>
            {!hasTagDefinitions ? (
                <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前项目还没有标签定义</div>
            ) : editTagSchemas.length > 0 ? (
                <div className="mobile-entry-detail__tags-list">
                    {editTagSchemas.map(schema => (
                        <TagItem
                            key={schema.id}
                            schema={{
                                id: schema.id,
                                name: schema.name,
                                type: schema.type as 'number' | 'string' | 'boolean',
                                range_min: schema.range_min ?? null,
                                range_max: schema.range_max ?? null,
                            }}
                            value={tagDraft[schema.id] ?? tagDraft[schema.name] ?? undefined}
                            mode="edit"
                            onChange={(value) => onTagDraftChange(prev => {
                                const nextValue = normalizeComparableTagValue(value)
                                if (getComparableTagValue(prev, schema) === nextValue) return prev
                                return {...prev, [schema.id]: nextValue}
                            })}
                        />
                    ))}
                </div>
            ) : (
                <div className="mobile-page__empty mobile-entry-detail__tags-empty">当前词条还没有已添加标签</div>
            )}
        </section>
    )
}
