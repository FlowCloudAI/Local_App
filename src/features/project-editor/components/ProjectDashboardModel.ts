import {
    entryTypeKey,
    type Category,
    type EntryTypeView,
    type ProjectStats,
    type TagSchema,
} from '../../../api'
import {formatDashboardNumber} from './ProjectDashboardFormat'
import type {
    DashboardActionItem,
    DashboardBarItem,
    DashboardKpiItem,
    DashboardSignalItem,
} from './ProjectDashboardParts'
import type {ProjectRiskSummary} from './ProjectOverview.types'

export interface ProjectDashboardModelInput {
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
    onOpenRelationGraph?: () => void
    onOpenTimeline?: () => void
    onOpenWorldMap?: () => void
    onOpenContradiction?: () => void
}

export interface ProjectDashboardModel {
    effectiveEntryCount: number
    safeImageCount: number
    averageWords: number
    assetRatio: number
    categoryDepth: number
    relationCount: number
    internalLinkCount: number
    structureScore: number
    structureChecks: Array<{ label: string; passed: boolean }>
    typeItems: DashboardBarItem[]
    categoryItems: DashboardBarItem[]
    tagTypeItems: DashboardBarItem[]
    kpiItems: DashboardKpiItem[]
    signalItems: DashboardSignalItem[]
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

function compactDistributionItems(
    items: DashboardBarItem[],
    options: { maxVisible: number; pinnedKey?: string; otherKey: string; otherLabel: string },
): DashboardBarItem[] {
    const pinned = options.pinnedKey
        ? items.find(item => item.key === options.pinnedKey && item.value > 0)
        : undefined
    const rankedItems = items.filter(item => item.key !== options.pinnedKey)
    const visibleItems = pinned
        ? [pinned, ...rankedItems.slice(0, Math.max(0, options.maxVisible - 1))]
        : rankedItems.slice(0, options.maxVisible)
    const visibleKeys = new Set(visibleItems.map(item => item.key))
    const otherTotal = items
        .filter(item => !visibleKeys.has(item.key))
        .reduce((sum, item) => sum + item.value, 0)

    return otherTotal > 0
        ? [...visibleItems, {key: options.otherKey, label: options.otherLabel, value: otherTotal, tone: 'muted'}]
        : visibleItems
}

function getTypeItems(
    input: ProjectDashboardModelInput,
    entryTypeNameMap: Map<string, string>,
    fallbackTypeItems: DashboardBarItem[],
): DashboardBarItem[] {
    if (!input.projectStats?.entriesByType.length) return fallbackTypeItems

    const items = input.projectStats.entriesByType
        .map(item => ({
            key: item.entryType ?? 'unset',
            label: item.entryType ? entryTypeNameMap.get(item.entryType) ?? item.entryType : '未设置类型',
            value: item.count,
            tone: item.entryType ? undefined : 'warning' as const,
        }))
        .sort((first, second) => second.value - first.value)

    return compactDistributionItems(items, {
        maxVisible: 3,
        pinnedKey: 'unset',
        otherKey: 'other-types',
        otherLabel: '其他类型',
    })
}

function getCategoryItems(
    input: ProjectDashboardModelInput,
    categoryNameMap: Map<string, string>,
    fallbackCategoryItems: DashboardBarItem[],
): DashboardBarItem[] {
    if (!input.projectStats?.entriesByCategory.length) return fallbackCategoryItems

    const items = input.projectStats.entriesByCategory
        .map(item => ({
            key: item.categoryId ?? 'uncategorized',
            label: item.categoryId ? categoryNameMap.get(item.categoryId) ?? '未知分类' : '未分类',
            value: item.count,
            tone: item.categoryId ? undefined : 'warning' as const,
        }))
        .sort((first, second) => second.value - first.value)

    return compactDistributionItems(items, {
        maxVisible: 3,
        pinnedKey: 'uncategorized',
        otherKey: 'other',
        otherLabel: '其他分类',
    })
}

function getDistributionItems(input: ProjectDashboardModelInput, categoryStats: ReturnType<typeof getCategoryDepthStats>) {
    const entryTypeNameMap = new Map(input.entryTypes.map(entryType => [entryTypeKey(entryType), entryType.name]))
    const categoryNameMap = new Map(input.categories.map(category => [category.id, category.name]))
    const builtinTypeCount = input.entryTypes.filter(entryType => entryType.kind === 'builtin').length
    const customTypeCount = input.entryTypes.length - builtinTypeCount
    const fallbackTypeItems = [
        {key: 'builtin', label: '内置类型', value: builtinTypeCount},
        {key: 'custom', label: '自定义类型', value: customTypeCount},
    ].filter(item => item.value > 0)
    const fallbackCategoryItems = [
        {key: 'root', label: '一级分类', value: categoryStats.rootCount},
        {key: 'nested', label: '子分类', value: categoryStats.nestedCount},
    ].filter(item => item.value > 0)

    return {
        typeItems: getTypeItems(input, entryTypeNameMap, fallbackTypeItems),
        categoryItems: getCategoryItems(input, categoryNameMap, fallbackCategoryItems),
        tagTypeItems: getTagTypeItems(input.tagSchemas),
    }
}

function getKpiItems(input: ProjectDashboardModelInput, model: {
    effectiveEntryCount: number
    safeWordCount: number
    averageWords: number
    relationCount: number
    internalLinkCount: number
    riskCount: number
    createdLast7Days: number
    updatedLast7Days: number
}): DashboardKpiItem[] {
    return [
        {key: 'entries', label: '词条', value: formatDashboardNumber(model.effectiveEntryCount), hint: '资料库规模'},
        {
            key: 'words',
            label: '总字数',
            value: formatDashboardNumber(model.safeWordCount),
            hint: `平均 ${formatDashboardNumber(model.averageWords)} 字`,
        },
        {
            key: 'relations',
            label: '关系',
            value: formatDashboardNumber(model.relationCount),
            hint: `${formatDashboardNumber(model.internalLinkCount)} 条正文内链`,
        },
        {
            key: 'risks',
            label: '待处理',
            value: formatDashboardNumber(model.riskCount),
            hint: '质量与 AI 质检项',
            tone: model.riskCount > 0 ? 'warn' : 'ok',
        },
        {
            key: 'activity',
            label: '7 天活跃',
            value: formatDashboardNumber(model.updatedLast7Days),
            hint: `${formatDashboardNumber(model.createdLast7Days)} 个新增词条`,
        },
        {
            key: 'versions',
            label: '版本',
            value: formatDashboardNumber(input.snapshotCount),
            hint: `${formatDashboardNumber(input.mapCount)} 张地图资产`,
        },
    ]
}

export interface ProjectQuickActionInput {
    mapCount?: number | null
    riskSummary?: ProjectRiskSummary | null
    projectStats?: ProjectStats | null
    onOpenRelationGraph?: () => void
    onOpenTimeline?: () => void
    onOpenWorldMap?: () => void
    onOpenContradiction?: () => void
}

export function buildProjectQuickActionItems(input: ProjectQuickActionInput): DashboardActionItem[] {
    const relationCount = input.projectStats?.relationCount ?? 0
    return getActionItems(input, relationCount)
}

function getActionItems(input: ProjectQuickActionInput, relationCount: number): DashboardActionItem[] {
    return [
        {
            key: 'relation',
            title: '关系图谱',
            description: '检查显式关系、正文内链和孤立节点。',
            tone: 'relation',
            badge: `${formatDashboardNumber(relationCount)} 关系`,
            onClick: input.onOpenRelationGraph,
            disabled: !input.onOpenRelationGraph,
        },
        {
            key: 'timeline',
            title: '时间线',
            description: '按事件顺序梳理世界进程和关键节点。',
            tone: 'timeline',
            badge: '时序',
            onClick: input.onOpenTimeline,
            disabled: !input.onOpenTimeline,
        },
        {
            key: 'map',
            title: '世界地图',
            description: '管理区域、路线、势力分布和空间资料。',
            tone: 'map',
            badge: `${formatDashboardNumber(input.mapCount)} 张`,
            onClick: input.onOpenWorldMap,
            disabled: !input.onOpenWorldMap,
        },
        {
            key: 'contradiction',
            title: 'AI 质检',
            description: '进入设定检测，复核冲突、契合度和出版风险。',
            tone: 'contradiction',
            badge: input.riskSummary?.reportCount ? `${input.riskSummary.reportCount} 份` : '质检',
            onClick: input.onOpenContradiction,
            disabled: !input.onOpenContradiction,
        },
    ]
}

export function buildProjectDashboardModel(input: ProjectDashboardModelInput): ProjectDashboardModel {
    const effectiveEntryCount = input.projectStats?.entryCount ?? input.entryCount
    const safeWordCount = input.projectStats?.wordCount ?? input.wordCount ?? 0
    const safeImageCount = input.projectStats?.imageCount ?? input.imageCount ?? 0
    const averageWords = effectiveEntryCount > 0 ? Math.round(safeWordCount / effectiveEntryCount) : 0
    const assetRatio = effectiveEntryCount > 0 ? safeImageCount / effectiveEntryCount : 0
    const categoryStats = getCategoryDepthStats(input.categories)
    const distributions = getDistributionItems(input, categoryStats)
    const relationCount = input.projectStats?.relationCount ?? 0
    const internalLinkCount = input.projectStats?.internalLinkCount ?? 0
    const createdLast7Days = input.projectStats?.createdLast7Days ?? 0
    const updatedLast7Days = input.projectStats?.updatedLast7Days ?? 0
    const qualityIssueCount = input.projectStats
        ? input.projectStats.uncategorizedEntryCount
        + input.projectStats.emptyContentEntryCount
        + input.projectStats.missingSummaryEntryCount
        + input.projectStats.isolatedEntryCount
        + input.projectStats.shortContentEntryCount
        : 0
    const riskCount = qualityIssueCount + (input.riskSummary?.issueCount ?? 0) + (input.riskSummary?.unresolvedCount ?? 0)

    return {
        effectiveEntryCount,
        safeImageCount,
        averageWords,
        assetRatio,
        categoryDepth: categoryStats.maxDepth,
        relationCount,
        internalLinkCount,
        structureScore: input.projectStats?.governanceScore.score ?? 0,
        structureChecks: input.projectStats?.governanceScore.checks ?? [],
        ...distributions,
        kpiItems: getKpiItems(input, {
            effectiveEntryCount,
            safeWordCount,
            averageWords,
            relationCount,
            internalLinkCount,
            riskCount,
            createdLast7Days,
            updatedLast7Days,
        }),
        signalItems: [
            {key: 'coverage', label: '分类覆盖', value: formatDashboardNumber(input.projectStats?.uncategorizedEntryCount), description: '未分类词条'},
            {key: 'content', label: '内容完整', value: formatDashboardNumber(input.projectStats?.emptyContentEntryCount), description: '空正文词条'},
            {key: 'summary', label: '检索摘要', value: formatDashboardNumber(input.projectStats?.missingSummaryEntryCount), description: '缺摘要词条'},
            {key: 'network', label: '结构连通', value: formatDashboardNumber(input.projectStats?.isolatedEntryCount), description: '孤立词条'},
        ],
    }
}
