import {type CSSProperties, useEffect, useMemo} from 'react'
import {Button, RollingBox} from 'flowcloudai-ui'
import {
    entryTypeKey,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import EntryTypeIcon from './EntryTypeIcon'
import {projectHomePerfInfo} from './projectHomePerfDebug'

function getTagTypeLabel(type: string): string {
    switch (type) {
        case 'string':
            return '文本'
        case 'number':
            return '数值'
        case 'boolean':
            return '布尔'
        default:
            return type
    }
}

function getEntryTypeNameMap(entryTypes: EntryTypeView[]): Map<string, string> {
    return new Map(entryTypes.map(entryType => [entryTypeKey(entryType), entryType.name]))
}

function normalizeTagTargets(target: TagSchema['target'] | string | null | undefined): string[] {
    if (Array.isArray(target)) return target
    if (typeof target !== 'string') return []

    try {
        const parsed = JSON.parse(target)
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
    } catch {
        return target
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
    }
}

function getTagTargetLabels(tag: TagSchema, entryTypeNameMap: Map<string, string>): string[] {
    return normalizeTagTargets(tag.target).map(target => entryTypeNameMap.get(target) ?? target)
}

function getCompactTagTargetLabels(tag: TagSchema, entryTypeNameMap: Map<string, string>): string[] {
    const labels = getTagTargetLabels(tag, entryTypeNameMap)
    if (labels.length <= 3) return labels
    return [...labels.slice(0, 2), `+${labels.length - 2}`]
}

function getTagDefaultValue(tag: TagSchema): string | null {
    if (tag.default_val == null || tag.default_val === '') return null
    return String(tag.default_val)
}

interface ProjectConfigOverviewProps {
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    onCreateTag?: () => void
    onCreateEntryType?: () => void
    onEditTag?: (tag: TagSchema) => void
    onEditEntryType?: (entryType: Extract<EntryTypeView, { kind: 'custom' }>) => void
}

function ProjectConfigOverview({
                                   entryTypes,
                                   tagSchemas,
                                   onCreateTag,
                                   onCreateEntryType,
                                   onEditTag,
                                   onEditEntryType,
}: ProjectConfigOverviewProps) {
    const entryTypeNameMap = useMemo(() => getEntryTypeNameMap(entryTypes), [entryTypes])

    useEffect(() => {
        projectHomePerfInfo('类型与标签配置卡片', {
            entryTypeCards: entryTypes.length,
            builtinEntryTypeCards: entryTypes.filter(entryType => entryType.kind === 'builtin').length,
            customEntryTypeCards: entryTypes.filter(entryType => entryType.kind === 'custom').length,
            tagCards: tagSchemas.length,
            tagTargetBindings: tagSchemas.reduce(
                (total, tag) => total + normalizeTagTargets(tag.target).length,
                0,
            ),
        })
    }, [entryTypes, tagSchemas])

    return (
        <div className="pe-config-grid" data-tour-id="project-overview-config">
            <section className="pe-config-section">
                <div className="pe-config-section__header">
                    <div>
                        <h2 className="pe-feature-section__title">词条类型</h2>
                        <p className="pe-feature-section__desc">
                            浏览全部词条类型；自定义类型可直接编辑。
                        </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onCreateEntryType}>+ 添加词条类型</Button>
                </div>

                <RollingBox axis="y" className="pe-config-list pe-config-list--entry-types" thumbSize="thin">
                    <div className="pe-config-list__inner pe-entry-type-grid">
                        {entryTypes.map(entryType => {
                            const isBuiltin = entryType.kind === 'builtin'
                            return (
                                <article
                                    key={entryTypeKey(entryType)}
                                    className="pe-entry-type-item"
                                    style={{'--pe-config-color': entryType.color} as CSSProperties}
                                >
                                    <div className="pe-entry-type-item__main">
                                        <div className="pe-entry-type-item__header">
                                            <div className="pe-entry-type-item__title-row">
                                                <span className="pe-entry-type-item__icon">
                                                    <EntryTypeIcon entryType={entryType}
                                                                   className="pe-config-item__entry-icon"/>
                                                </span>
                                                <span className="pe-config-item__title">{entryType.name}</span>
                                                <span className="pe-config-item__badge">
                                                    {isBuiltin ? '内置' : '自定义'}
                                                </span>
                                            </div>
                                            {!isBuiltin && onEditEntryType && (
                                                <Button type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onEditEntryType(entryType)}
                                                >
                                                    编辑
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {entryType.description && (
                                        <p className="pe-entry-type-item__desc">
                                            {entryType.description}
                                        </p>
                                    )}
                                </article>
                            )
                        })}
                    </div>
                </RollingBox>
            </section>

            <section className="pe-config-section">
                <div className="pe-config-section__header">
                    <div>
                        <h2 className="pe-feature-section__title">标签</h2>
                        <p className="pe-feature-section__desc">
                            管理标签类型、默认值和默认植入范围。
                        </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onCreateTag}>+ 添加标签</Button>
                </div>

                <RollingBox axis="y" className="pe-config-list pe-config-list--tags" thumbSize="thin">
                    <div className="pe-config-list__inner pe-entry-type-grid">
                        {tagSchemas.map(tag => {
                            const compactTargets = getCompactTagTargetLabels(tag, entryTypeNameMap)
                            const defaultValue = getTagDefaultValue(tag)
                            const hasDescription = Boolean(tag.description?.trim())
                            return (
                                <article key={tag.id} className="pe-entry-type-item pe-entry-type-item--tag">
                                    <div className="pe-entry-type-item__main">
                                        <div className="pe-entry-type-item__header">
                                            <div className="pe-entry-type-item__title-row">
                                                <span className="pe-entry-type-item__icon pe-entry-type-item__icon--tag">
                                                    #
                                                </span>
                                                <span className="pe-config-item__title">{tag.name}</span>
                                                <span className="pe-config-item__badge">{getTagTypeLabel(tag.type)}</span>
                                            </div>
                                            {onEditTag && (
                                                <Button type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onEditTag(tag)}
                                                >
                                                    编辑
                                                </Button>
                                            )}
                                        </div>
                                        <div className="pe-tag-config-item__meta-row">
                                            {defaultValue && (
                                                <span className="pe-config-item__badge is-muted">默认值：{defaultValue}</span>
                                            )}
                                            {compactTargets.length > 0 ? (
                                                compactTargets.map(target => (
                                                    <span key={`${tag.id}-${target}`}
                                                          className="pe-tag-target-chip">
                                                        {target}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="pe-tag-target-chip is-free">自由标签</span>
                                            )}
                                        </div>
                                    </div>
                                    {hasDescription && (
                                        <p className="pe-entry-type-item__desc">
                                            {tag.description}
                                        </p>
                                    )}
                                </article>
                            )
                        })}
                    </div>
                </RollingBox>
            </section>
        </div>
    )
}

export default ProjectConfigOverview
