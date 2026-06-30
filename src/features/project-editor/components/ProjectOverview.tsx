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
                             imageCount,
                             wordCount,
                             projectStats,
                             mapCount,
                             snapshotCount,
                             riskSummary,
                             onCreateTag,
                             onCreateEntryType,
                             onEditTag,
                             onEditEntryType,
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
        wordCount,
    ])

    return (
        <RollingBox axis="y" ref={setOverviewScrollRef} className="pe-overview" thumbSize="thin" showThumb="show">
            <ProjectOverviewHeader
                project={project}
                onEditCover={onEditCover}
                onClearCover={onClearCover}
                coverUpdating={coverUpdating}
                onRename={onRename}
                onExport={onExport}
                exporting={exporting}
                onDelete={onDelete}
                onDescriptionChange={onDescriptionChange}
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
