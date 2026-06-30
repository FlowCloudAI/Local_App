import {
    Children,
    cloneElement,
    isValidElement,
    memo,
    useCallback,
    useEffect,
    useState,
} from 'react'
import {RollingBox} from 'flowcloudai-ui'
import ProjectConfigOverview from './ProjectConfigOverview'
import ProjectDashboard from './ProjectDashboard'
import ProjectOverviewHeader from './ProjectOverviewHeader'
import ProjectQuickActions from './ProjectQuickActions'
import type {ProjectOverviewProps, ProjectOverviewVirtualChildProps} from './ProjectOverview.types'
import {PROJECT_HOME_PERF_LOG_ENABLED, projectHomePerfInfo} from './projectHomePerfDebug'

function ProjectOverview({
                             project,
                             categories,
                             entryTypes,
                             tagSchemas,
                             entryCount,
                             tagCount,
                             imageCount,
                             wordCount,
                             projectStats,
                             mapCount,
                             snapshotCount,
                             riskSummary,
                             onCreateEntry,
                             onCreateTag,
                             onCreateEntryType,
                             onEditTag,
                             onEditEntryType,
                             onOpenProjectAi,
                             onOpenRelationGraph,
                             onOpenTimeline,
                             onOpenWorldMap,
                             onOpenContradiction,
                             onRename,
                             onEditCover,
                             onClearCover,
                             coverUpdating = false,
                             onExport,
                             exporting = false,
                             onDelete,
                             onDescriptionChange,
                             children,
                         }: ProjectOverviewProps) {
    const [overviewScrollElement, setOverviewScrollElement] = useState<HTMLDivElement | null>(null)
    const setOverviewScrollRef = useCallback((node: HTMLDivElement | null) => {
        setOverviewScrollElement(node)
    }, [])
    const childrenWithScrollElement = Children.map(children, child => {
        if (!isValidElement<ProjectOverviewVirtualChildProps>(child)) return child
        return cloneElement(child, {virtualScrollElement: overviewScrollElement})
    })

    useEffect(() => {
        if (!PROJECT_HOME_PERF_LOG_ENABLED) return
        projectHomePerfInfo('项目总览结构', {
            projectId: project.id,
            projectName: project.name,
            categoryCards: categories.length,
            entryTypeCards: entryTypes.length,
            tagCards: tagSchemas.length,
            entryCount,
            imageCount,
            wordCount,
            mapCount,
            snapshotCount,
            hasRiskSummary: Boolean(riskSummary),
            hasEntryGridChild: Boolean(children),
            scrollElementReady: Boolean(overviewScrollElement),
        })
    }, [
        categories.length,
        children,
        entryCount,
        entryTypes.length,
        imageCount,
        mapCount,
        overviewScrollElement,
        project.id,
        project.name,
        riskSummary,
        snapshotCount,
        tagSchemas.length,
        wordCount,
    ])

    return (
        <RollingBox axis="y" ref={setOverviewScrollRef} className="pe-overview" thumbSize="thin" showThumb="show">
            <ProjectOverviewHeader
                project={project}
                entryCount={entryCount}
                categoryCount={categories.length}
                entryTypeCount={entryTypes.length}
                tagCount={tagCount}
                imageCount={imageCount}
                wordCount={wordCount}
                onEditCover={onEditCover}
                onClearCover={onClearCover}
                coverUpdating={coverUpdating}
                onRename={onRename}
                onExport={onExport}
                exporting={exporting}
                onDelete={onDelete}
                onDescriptionChange={onDescriptionChange}
            />

            <ProjectNextSteps
                entryCount={entryCount}
                categoryCount={categories.length}
                tagCount={tagCount}
                hasDescription={Boolean(project.description?.trim())}
                riskSummary={riskSummary}
                onCreateEntry={onCreateEntry}
                onOpenProjectAi={onOpenProjectAi}
                onCreateTag={onCreateTag}
                onOpenContradiction={onOpenContradiction}
            />

            <ProjectQuickActions
                mapCount={mapCount}
                riskSummary={riskSummary}
                projectStats={projectStats}
                onOpenRelationGraph={onOpenRelationGraph}
                onOpenTimeline={onOpenTimeline}
                onOpenWorldMap={onOpenWorldMap}
                onOpenContradiction={onOpenContradiction}
            />

            <ProjectDashboard
                categories={categories}
                entryTypes={entryTypes}
                tagSchemas={tagSchemas}
                entryCount={entryCount}
                imageCount={imageCount}
                wordCount={wordCount}
                projectStats={projectStats}
                mapCount={mapCount}
                snapshotCount={snapshotCount}
                riskSummary={riskSummary}
                onOpenRelationGraph={onOpenRelationGraph}
                onOpenTimeline={onOpenTimeline}
                onOpenWorldMap={onOpenWorldMap}
                onOpenContradiction={onOpenContradiction}
            />

            <ProjectConfigOverview
                entryTypes={entryTypes}
                tagSchemas={tagSchemas}
                onCreateTag={onCreateTag}
                onCreateEntryType={onCreateEntryType}
                onEditTag={onEditTag}
                onEditEntryType={onEditEntryType}
            />

            {children && (
                <div className="pe-overview-entries" data-tour-id="project-overview-entries">
                    {childrenWithScrollElement}
                </div>
            )}
        </RollingBox>
    )
}

export default memo(ProjectOverview)

interface ProjectNextStepsProps {
    entryCount: number
    categoryCount: number
    tagCount: number
    hasDescription: boolean
    riskSummary?: ProjectOverviewProps['riskSummary']
    onCreateEntry?: () => void | Promise<void>
    onOpenProjectAi?: () => void
    onCreateTag?: () => void
    onOpenContradiction?: () => void
}

function ProjectNextSteps({
                              entryCount,
                              categoryCount,
                              tagCount,
                              hasDescription,
                              riskSummary,
                              onCreateEntry,
                              onOpenProjectAi,
                              onCreateTag,
                              onOpenContradiction,
                          }: ProjectNextStepsProps) {
    const unresolvedCount = riskSummary?.unresolvedCount ?? 0
    const items = [
        {
            key: 'entry',
            title: entryCount > 0 ? '继续补充词条' : '创建第一条词条',
            description: entryCount > 0
                ? '把新的角色、地点、事件或物品写进当前世界，保持资料从创作入口自然增长。'
                : '先用一条词条落下世界的第一个实体，再围绕它扩展分类、关系和正文细节。',
            actionLabel: entryCount > 0 ? '新建词条' : '写第一条词条',
            onClick: onCreateEntry,
            tone: 'primary',
        },
        {
            key: 'ai',
            title: hasDescription ? '让 AI 梳理下一步' : '让 AI 起草世界框架',
            description: hasDescription
                ? '基于当前项目的描述和资料，让 AI 帮你扩写设定、整理灵感，或找出还缺哪类内容。'
                : '项目描述还很空，可以先让 AI 帮你生成世界方向、核心冲突和第一批设定清单。',
            actionLabel: 'AI 讨论项目',
            onClick: onOpenProjectAi,
            tone: 'ai',
        },
        unresolvedCount > 0 ? {
            key: 'risk',
            title: '处理设定矛盾',
            description: `还有 ${unresolvedCount} 个待处理问题，建议先复核影响剧情、角色动机或时间线连续性的冲突。`,
            actionLabel: '查看矛盾',
            onClick: onOpenContradiction,
            tone: 'warning',
        } : {
            key: 'structure',
            title: categoryCount > 0 && tagCount > 0 ? '完善资料结构' : '建立资料规则',
            description: categoryCount > 0 && tagCount > 0
                ? '继续补充标签和分类，让后续检索、筛选、关系梳理和 AI 上下文更稳定。'
                : '先准备分类和标签规则，给人物、地点、势力等资料预留清晰的整理方式。',
            actionLabel: '添加标签',
            onClick: onCreateTag,
            tone: 'structure',
        },
    ]

    return (
        <section className="pe-next-steps" data-tour-id="project-overview-next-steps">
            <div className="pe-next-steps__header">
                <div>
                    <h2>下一步建议</h2>
                    <p>按当前项目状态给出最直接的创作入口：先推进内容和结构，再回到项目总览查看规模与风险。</p>
                </div>
            </div>
            <div className="pe-next-steps__grid">
                {items.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        className={`pe-next-step-card pe-next-step-card--${item.tone}`}
                        onClick={() => void item.onClick?.()}
                        disabled={!item.onClick}
                    >
                        <span className="pe-next-step-card__title">{item.title}</span>
                        <span className="pe-next-step-card__desc">{item.description}</span>
                        <span className="pe-next-step-card__action">{item.actionLabel}</span>
                    </button>
                ))}
            </div>
        </section>
    )
}
