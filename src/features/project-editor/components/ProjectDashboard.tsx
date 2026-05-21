import type {CSSProperties} from 'react'
import {
    type Category,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import './ProjectDashboard.css'

interface ProjectDashboardProps {
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    entryCount: number
    imageCount?: number | null
    wordCount?: number | null
}

interface BarItem {
    key: string
    label: string
    value: number
}

const numberFormatter = new Intl.NumberFormat('zh-CN')

function formatNumber(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '--'
    return numberFormatter.format(value)
}

function formatRatio(value: number): string {
    if (!Number.isFinite(value)) return '--'
    return `${Math.round(value * 100)}%`
}

function getBarStyle(value: number, total: number): CSSProperties {
    const percent = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0
    return {'--pe-dashboard-bar-width': `${percent}%`} as CSSProperties
}

function getCategoryDepthStats(categories: Category[]) {
    const categoryMap = new Map(categories.map(category => [category.id, category]))
    let maxDepth = 0

    categories.forEach(category => {
        let depth = 1
        let current = category.parent_id ? categoryMap.get(category.parent_id) : null
        const visited = new Set<string>([category.id])
        while (current && !visited.has(current.id)) {
            visited.add(current.id)
            depth += 1
            current = current.parent_id ? categoryMap.get(current.parent_id) : null
        }
        maxDepth = Math.max(maxDepth, depth)
    })

    const rootCount = categories.filter(category => !category.parent_id).length
    return {
        rootCount,
        nestedCount: Math.max(0, categories.length - rootCount),
        maxDepth,
    }
}

function getTagTypeItems(tagSchemas: TagSchema[]): BarItem[] {
    const counts = new Map<string, number>([
        ['文本', 0],
        ['数值', 0],
        ['布尔', 0],
        ['其他', 0],
    ])
    tagSchemas.forEach(tag => {
        if (tag.type === 'string') counts.set('文本', (counts.get('文本') ?? 0) + 1)
        else if (tag.type === 'number') counts.set('数值', (counts.get('数值') ?? 0) + 1)
        else if (tag.type === 'boolean') counts.set('布尔', (counts.get('布尔') ?? 0) + 1)
        else counts.set('其他', (counts.get('其他') ?? 0) + 1)
    })

    return [...counts.entries()]
        .map(([label, value]) => ({key: label, label, value}))
        .filter(item => item.value > 0)
}

function DashboardMetric({label, value, hint}: { label: string; value: string; hint: string }) {
    return (
        <article className="pe-dashboard-metric">
            <span className="pe-dashboard-metric__label">{label}</span>
            <strong className="pe-dashboard-metric__value">{value}</strong>
            <span className="pe-dashboard-metric__hint">{hint}</span>
        </article>
    )
}

function DashboardBarList({items}: { items: BarItem[] }) {
    const total = items.reduce((sum, item) => sum + item.value, 0)

    if (items.length === 0) {
        return <p className="pe-dashboard-empty">暂无可统计数据</p>
    }

    return (
        <div className="pe-dashboard-bars">
            {items.map(item => (
                <div className="pe-dashboard-bar-row" key={item.key}>
                    <div className="pe-dashboard-bar-row__topline">
                        <span>{item.label}</span>
                        <span>{formatNumber(item.value)}</span>
                    </div>
                    <div className="pe-dashboard-bar-track">
                        <span className="pe-dashboard-bar-fill" style={getBarStyle(item.value, total)}/>
                    </div>
                </div>
            ))}
        </div>
    )
}

function HealthMeter({score}: { score: number }) {
    const status = score >= 80 ? '结构稳定' : score >= 55 ? '仍需补强' : '基础偏弱'
    return (
        <div className="pe-dashboard-health">
            <div className="pe-dashboard-health__ring" style={getBarStyle(score, 100)}>
                <span>{score}</span>
            </div>
            <div className="pe-dashboard-health__body">
                <span className="pe-dashboard-health__label">世界观结构化评分</span>
                <strong>{status}</strong>
                <span>基于分类、词条类型、标签体系、内容体量和平均字数估算。</span>
            </div>
        </div>
    )
}

function ProjectDashboard({
                              categories,
                              entryTypes,
                              tagSchemas,
                              entryCount,
                              imageCount,
                              wordCount,
                          }: ProjectDashboardProps) {
    const safeWordCount = wordCount ?? 0
    const safeImageCount = imageCount ?? 0
    const averageWords = entryCount > 0 ? Math.round(safeWordCount / entryCount) : 0
    const assetRatio = entryCount > 0 ? safeImageCount / entryCount : 0
    const categoryStats = getCategoryDepthStats(categories)
    const builtinTypeCount = entryTypes.filter(entryType => entryType.kind === 'builtin').length
    const customTypeCount = entryTypes.length - builtinTypeCount
    const typeItems = [
        {key: 'builtin', label: '内置类型', value: builtinTypeCount},
        {key: 'custom', label: '自定义类型', value: customTypeCount},
    ].filter(item => item.value > 0)
    const categoryItems = [
        {key: 'root', label: '一级分类', value: categoryStats.rootCount},
        {key: 'nested', label: '子分类', value: categoryStats.nestedCount},
    ].filter(item => item.value > 0)
    const tagTypeItems = getTagTypeItems(tagSchemas)
    const customTypeNames = entryTypes
        .filter(entryType => entryType.kind === 'custom')
        .slice(0, 4)
        .map(entryType => entryType.name)
    const structureChecks = [
        {label: '分类体系', passed: categories.length > 0},
        {label: '词条类型', passed: entryTypes.length > 0},
        {label: '标签字段', passed: tagSchemas.length > 0},
        {label: '内容资产', passed: entryCount > 0},
        {label: '平均字数', passed: averageWords >= 100},
    ]
    const structureScore = Math.round(
        (structureChecks.filter(item => item.passed).length / structureChecks.length) * 100,
    )

    return (
        <section className="pe-dashboard-section">
            <div className="pe-dashboard-section__header">
                <div>
                    <h2 className="pe-feature-section__title">项目驾驶舱</h2>
                    <p className="pe-feature-section__desc">
                        从管理视角观察世界观规模、结构化程度和资料配置状态。
                    </p>
                </div>
                <div className="pe-dashboard-section__badge">MIS 视图</div>
            </div>

            <div className="pe-dashboard-grid">
                <div className="pe-dashboard-panel pe-dashboard-panel--health">
                    <HealthMeter score={structureScore}/>
                    <div className="pe-dashboard-checks">
                        {structureChecks.map(item => (
                            <span
                                key={item.label}
                                className={`pe-dashboard-check ${item.passed ? 'is-passed' : 'is-missing'}`}
                            >
                                {item.label}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="pe-dashboard-metric-grid">
                    <DashboardMetric
                        label="平均词条字数"
                        value={formatNumber(averageWords)}
                        hint="衡量设定资料的填充厚度"
                    />
                    <DashboardMetric
                        label="图文资源比"
                        value={formatRatio(assetRatio)}
                        hint="平均每个词条关联图片资源"
                    />
                    <DashboardMetric
                        label="分类层级深度"
                        value={`${categoryStats.maxDepth || 0} 层`}
                        hint="观察资料结构的组织深度"
                    />
                    <DashboardMetric
                        label="自定义类型"
                        value={formatNumber(customTypeCount)}
                        hint={customTypeNames.length > 0 ? customTypeNames.join('、') : '尚未扩展'}
                    />
                </div>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>词条类型配置</h3>
                        <span>{formatNumber(entryTypes.length)} 项</span>
                    </div>
                    <DashboardBarList items={typeItems}/>
                </article>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>分类结构</h3>
                        <span>{formatNumber(categories.length)} 项</span>
                    </div>
                    <DashboardBarList items={categoryItems}/>
                </article>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>标签字段类型</h3>
                        <span>{formatNumber(tagSchemas.length)} 项</span>
                    </div>
                    <DashboardBarList items={tagTypeItems}/>
                </article>

                <article className="pe-dashboard-panel pe-dashboard-panel--signals">
                    <div className="pe-dashboard-panel__header">
                        <h3>管理信号</h3>
                        <span>基础版</span>
                    </div>
                    <ul className="pe-dashboard-signals">
                        <li>当前已有 {formatNumber(entryCount)} 个词条进入项目资料库。</li>
                        <li>结构配置项共 {formatNumber(categories.length + entryTypes.length + tagSchemas.length)} 个。</li>
                        <li>下一阶段将接入类型词条数、孤立词条、短正文词条等健康指标。</li>
                    </ul>
                </article>
            </div>
        </section>
    )
}

export default ProjectDashboard
