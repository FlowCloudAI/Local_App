import {
    entryTypeKey,
    type Category,
    type EntryTypeView,
    type ProjectStats,
    type TagSchema,
} from '../../../api'
import {
    DashboardBarList,
    type DashboardBarItem,
    DashboardMetric,
    HealthMeter,
} from './ProjectDashboardParts'
import {
    formatDashboardNumber,
    formatDashboardRatio,
} from './ProjectDashboardFormat'
import ProjectDashboardRiskPanel from './ProjectDashboardRiskPanel'
import type {ProjectRiskSummary} from './ProjectOverview.types'
import './ProjectDashboard.css'

interface ProjectDashboardProps {
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    entryCount: number
    imageCount?: number | null
    wordCount?: number | null
    projectStats?: ProjectStats | null
    mapCount?: number | null
    snapshotCount?: number | null
    riskSummary?: ProjectRiskSummary | null
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

function getTagTypeItems(tagSchemas: TagSchema[]): DashboardBarItem[] {
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

function ProjectDashboard({
                              categories,
                              entryTypes,
                              tagSchemas,
                              entryCount,
                              imageCount,
                              wordCount,
                              projectStats,
                              mapCount,
                              snapshotCount,
                              riskSummary,
                          }: ProjectDashboardProps) {
    const effectiveEntryCount = projectStats?.entryCount ?? entryCount
    const safeWordCount = projectStats?.wordCount ?? wordCount ?? 0
    const safeImageCount = projectStats?.imageCount ?? imageCount ?? 0
    const averageWords = effectiveEntryCount > 0 ? Math.round(safeWordCount / effectiveEntryCount) : 0
    const assetRatio = effectiveEntryCount > 0 ? safeImageCount / effectiveEntryCount : 0
    const categoryStats = getCategoryDepthStats(categories)
    const entryTypeNameMap = new Map(entryTypes.map(entryType => [entryTypeKey(entryType), entryType.name]))
    const categoryNameMap = new Map(categories.map(category => [category.id, category.name]))
    const builtinTypeCount = entryTypes.filter(entryType => entryType.kind === 'builtin').length
    const customTypeCount = entryTypes.length - builtinTypeCount
    const fallbackTypeItems = [
        {key: 'builtin', label: '内置类型', value: builtinTypeCount},
        {key: 'custom', label: '自定义类型', value: customTypeCount},
    ].filter(item => item.value > 0)
    const typeItems = projectStats?.entriesByType.length
        ? projectStats.entriesByType.map(item => ({
            key: item.entryType ?? 'unset',
            label: item.entryType ? entryTypeNameMap.get(item.entryType) ?? item.entryType : '未设置类型',
            value: item.count,
        }))
        : fallbackTypeItems
    const fallbackCategoryItems = [
        {key: 'root', label: '一级分类', value: categoryStats.rootCount},
        {key: 'nested', label: '子分类', value: categoryStats.nestedCount},
    ].filter(item => item.value > 0)
    const categoryItems = projectStats?.entriesByCategory.length
        ? projectStats.entriesByCategory.slice(0, 6).map(item => ({
            key: item.categoryId ?? 'uncategorized',
            label: item.categoryId ? categoryNameMap.get(item.categoryId) ?? '未知分类' : '未分类',
            value: item.count,
        }))
        : fallbackCategoryItems
    const tagTypeItems = getTagTypeItems(tagSchemas)
    const structureChecks = [
        {label: '分类体系', passed: categories.length > 0},
        {label: '词条类型', passed: entryTypes.length > 0},
        {label: '标签字段', passed: tagSchemas.length > 0},
        {label: '内容资产', passed: effectiveEntryCount > 0},
        {label: '平均字数', passed: averageWords >= 100},
    ]
    const baseScore = Math.round(
        (structureChecks.filter(item => item.passed).length / structureChecks.length) * 100,
    )
    const healthIssueCount = projectStats
        ? projectStats.uncategorizedEntryCount
        + projectStats.emptyContentEntryCount
        + projectStats.missingSummaryEntryCount
        + projectStats.isolatedEntryCount
        : 0
    const healthPenalty = projectStats && effectiveEntryCount > 0
        ? Math.min(40, Math.round((healthIssueCount / (effectiveEntryCount * 4)) * 100))
        : 0
    const structureScore = Math.max(0, baseScore - healthPenalty)
    const relationCount = projectStats?.relationCount ?? 0
    const internalLinkCount = projectStats?.internalLinkCount ?? 0
    const updatedLast7Days = projectStats?.updatedLast7Days ?? 0

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
                        value={formatDashboardNumber(averageWords)}
                        hint="衡量设定资料的填充厚度"
                    />
                    <DashboardMetric
                        label="图文资源比"
                        value={formatDashboardRatio(assetRatio)}
                        hint="平均每个词条关联图片资源"
                    />
                    <DashboardMetric
                        label="关系总数"
                        value={formatDashboardNumber(relationCount)}
                        hint="词条之间的显式关系"
                    />
                    <DashboardMetric
                        label="内链总数"
                        value={formatDashboardNumber(internalLinkCount)}
                        hint="正文中维护的词条链接"
                    />
                    <DashboardMetric
                        label="地图数量"
                        value={formatDashboardNumber(mapCount)}
                        hint="项目空间资料资产"
                    />
                    <DashboardMetric
                        label="版本快照"
                        value={formatDashboardNumber(snapshotCount)}
                        hint="当前资料库版本沉淀"
                    />
                    <DashboardMetric
                        label="分类层级深度"
                        value={`${categoryStats.maxDepth || 0} 层`}
                        hint="观察资料结构的组织深度"
                    />
                </div>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>{projectStats ? '词条类型分布' : '词条类型配置'}</h3>
                        <span>{formatDashboardNumber(projectStats?.entriesByType.length ?? entryTypes.length)} 项</span>
                    </div>
                    <DashboardBarList items={typeItems}/>
                </article>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>{projectStats ? '分类词条分布' : '分类结构'}</h3>
                        <span>{formatDashboardNumber(projectStats?.entriesByCategory.length ?? categories.length)} 项</span>
                    </div>
                    <DashboardBarList items={categoryItems}/>
                </article>

                <article className="pe-dashboard-panel">
                    <div className="pe-dashboard-panel__header">
                        <h3>标签字段类型</h3>
                        <span>{formatDashboardNumber(tagSchemas.length)} 项</span>
                    </div>
                    <DashboardBarList items={tagTypeItems}/>
                </article>

                <ProjectDashboardRiskPanel projectStats={projectStats} riskSummary={riskSummary}/>

                <article className="pe-dashboard-panel pe-dashboard-panel--signals">
                    <div className="pe-dashboard-panel__header">
                        <h3>管理信号</h3>
                        <span>基础版</span>
                    </div>
                    <ul className="pe-dashboard-signals">
                        <li>当前已有 {formatDashboardNumber(effectiveEntryCount)} 个词条进入项目资料库。</li>
                        <li>最近 7 天更新 {formatDashboardNumber(updatedLast7Days)} 个词条。</li>
                        <li>未分类 {formatDashboardNumber(projectStats?.uncategorizedEntryCount)} 个，孤立词条 {formatDashboardNumber(projectStats?.isolatedEntryCount)} 个。</li>
                        <li>空正文 {formatDashboardNumber(projectStats?.emptyContentEntryCount)} 个，缺摘要 {formatDashboardNumber(projectStats?.missingSummaryEntryCount)} 个。</li>
                    </ul>
                </article>
            </div>
        </section>
    )
}

export default ProjectDashboard
