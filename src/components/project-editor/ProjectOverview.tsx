import {memo, type CSSProperties, type ReactNode} from 'react'
import { Button, RollingBox } from 'flowcloudai-ui'
import {
    entryTypeKey,
    type Category,
    type CustomEntryType,
    type EntryTypeView,
    type Project,
    type TagSchema,
} from '../../api'
import EntryTypeIcon from './EntryTypeIcon'

function parseDateMs(s?: string | null): number {
    if (!s) return 0
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? 0 : t
}

function formatDate(s?: string | null): string {
    const ms = parseDateMs(s)
    if (!ms) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(ms)
}

function StatCard({label, value}: {label: string; value: number | string}) {
    return (
        <div className="pe-stat-card">
            <span className="pe-stat-value">{value}</span>
            <span className="pe-stat-label">{label}</span>
        </div>
    )
}

interface ProjectOverviewProps {
    project: Project
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    entryCount: number
    tagCount: number
    imageCount?: number | null
    wordCount?: number | null
    onCreateTag?: () => void
    onCreateEntryType?: () => void
    onEditTag?: (tag: TagSchema) => void
    onEditEntryType?: (entryType: CustomEntryType) => void
    onOpenRelationGraph?: () => void
    onOpenTimeline?: () => void
}

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

function RelationGraphIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="6.5" r="2.25" fill="currentColor"/>
            <circle cx="18" cy="7" r="2.25" fill="currentColor"/>
            <circle cx="12" cy="17.5" r="2.25" fill="currentColor"/>
            <path
                d="M7.9 7.55L10.2 15M16.2 8.05L13.8 15M8.1 6.9H15.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
}

function TimelineIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M5 7.5H19M5 12H19M5 16.5H19"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <circle cx="8" cy="7.5" r="1.8" fill="currentColor"/>
            <circle cx="15" cy="12" r="1.8" fill="currentColor"/>
            <circle cx="11" cy="16.5" r="1.8" fill="currentColor"/>
        </svg>
    )
}

function ConflictIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M7 6L10.5 12L7 18M17 6L13.5 12L17 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M10.75 12H13.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
}

function WorldMapIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="12"
                cy="12"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path
                d="M4.8 12H19.2M12 4.2C14.45 6.15 15.85 8.9 15.85 12C15.85 15.1 14.45 17.85 12 19.8C9.55 17.85 8.15 15.1 8.15 12C8.15 8.9 9.55 6.15 12 4.2Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

interface FeatureEntryProps {
    title: string
    description: string
    badge?: string
    emphasized?: boolean
    disabled?: boolean
    onClick?: () => void
    children: ReactNode
}

function FeatureEntry({
    title,
    description,
    badge,
    emphasized = false,
    disabled = false,
    onClick,
    children,
}: FeatureEntryProps) {
    return (
        <button
            type="button"
            className={[
                'pe-feature-entry',
                emphasized ? 'is-emphasized' : '',
                disabled ? 'is-disabled' : '',
            ].filter(Boolean).join(' ')}
            onClick={onClick}
            disabled={disabled}
        >
            <span className="pe-feature-entry__icon" aria-hidden="true">
                {children}
            </span>
            <span className="pe-feature-entry__body">
                <span className="pe-feature-entry__topline">
                    <span className="pe-feature-entry__title">{title}</span>
                    {badge && <span className="pe-feature-entry__badge">{badge}</span>}
                </span>
                <span className="pe-feature-entry__desc">{description}</span>
            </span>
        </button>
    )
}

function ProjectOverview({
    project,
    categories,
    entryTypes,
    tagSchemas,
    entryCount,
    tagCount,
                             imageCount,
                             wordCount,
    onCreateTag,
    onCreateEntryType,
    onEditTag,
    onEditEntryType,
    onOpenRelationGraph,
                             onOpenTimeline,
}: ProjectOverviewProps) {
    const entryTypeNameMap = getEntryTypeNameMap(entryTypes)

    return (
        <RollingBox className="pe-overview" thumbSize="thin">
            <h1 className="pe-overview-title">{project.name}</h1>
            {project.description && (
                <p className="pe-overview-desc">{project.description}</p>
            )}
            <div className="pe-overview-meta">
                <span>创建于 {formatDate(project.created_at)}</span>
                <span className="pe-meta-sep">·</span>
                <span>更新于 {formatDate(project.updated_at)}</span>
            </div>

            <div className="pe-stats-grid">
                <StatCard label="词条数" value={entryCount}/>
                <StatCard label="分类数" value={categories.length}/>
                <StatCard label="词条类型" value={entryTypes.length}/>
                <StatCard label="标签数" value={tagCount}/>
                <StatCard label="图片数" value={imageCount ?? '--'}/>
                <StatCard label="总字数" value={wordCount ?? '--'}/>
            </div>

            <section className="pe-feature-section">
                <div className="pe-feature-section__header">
                    <h2 className="pe-feature-section__title">项目视图</h2>
                    <p className="pe-feature-section__desc">
                        这些入口会逐步成为项目的核心浏览方式，关系图谱已可用，其余模块先预留位置。
                    </p>
                </div>

                <div className="pe-feature-grid">
                    <FeatureEntry
                        title="词条关系图谱"
                        description="查看人物、组织、地点与关键物件之间的连接结构，直接观察整体关系网。"
                        badge="推荐"
                        emphasized
                        onClick={onOpenRelationGraph}
                    >
                        <RelationGraphIcon/>
                    </FeatureEntry>
                    <FeatureEntry
                        title="时间线"
                        description="按事件顺序梳理世界进程、角色行动和关键转折节点。"
                        badge="已接数据"
                        onClick={onOpenTimeline}
                    >
                        <TimelineIcon/>
                    </FeatureEntry>
                    <FeatureEntry
                        title="矛盾检测"
                        description="集中检查设定冲突、时间不一致和角色叙述互相打架的地方。"
                        badge="待开放"
                        disabled
                    >
                        <ConflictIcon/>
                    </FeatureEntry>
                    <FeatureEntry
                        title="世界地图"
                        description="在空间层面串联区域、航线、势力分布和事件发生位置。"
                        badge="待开放"
                        disabled
                    >
                        <WorldMapIcon/>
                    </FeatureEntry>
                </div>
            </section>

            <div className="pe-config-grid">
                <section className="pe-config-section">
                    <div className="pe-config-section__header">
                        <div>
                            <h2 className="pe-feature-section__title">词条类型</h2>
                            <p className="pe-feature-section__desc">
                                浏览全部词条类型；自定义类型可直接编辑。
                            </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={onCreateEntryType}>+ 添加词条类型</Button>
                    </div>

                    <RollingBox className="pe-config-list pe-config-list--entry-types" thumbSize="thin">
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
                                                        <EntryTypeIcon entryType={entryType} className="pe-config-item__entry-icon"/>
                                                    </span>
                                                    <span className="pe-config-item__title">{entryType.name}</span>
                                                    <span className="pe-config-item__badge">
                                                        {isBuiltin ? '内置' : '自定义'}
                                                    </span>
                                                </div>
                                                {!isBuiltin && onEditEntryType && (
                                                    <Button
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
                        <Button variant="outline" size="sm" onClick={onCreateTag}>+ 添加标签</Button>
                    </div>

                    <RollingBox className="pe-config-list pe-config-list--tags" thumbSize="thin">
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
                                                    <Button
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
                                                        <span key={`${tag.id}-${target}`} className="pe-tag-target-chip">
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
        </RollingBox>
    )
}

export default memo(ProjectOverview)
