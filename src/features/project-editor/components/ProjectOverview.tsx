import {
    Children,
    cloneElement,
    isValidElement,
    memo,
    useCallback,
    useState,
} from 'react'
import {RollingBox} from 'flowcloudai-ui'
import ProjectConfigOverview from './ProjectConfigOverview'
import ProjectDashboard from './ProjectDashboard'
import ProjectOverviewHeader from './ProjectOverviewHeader'
import type {ProjectOverviewProps, ProjectOverviewVirtualChildProps} from './ProjectOverview.types'

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
                             onCreateTag,
                             onCreateEntryType,
                             onEditTag,
                             onEditEntryType,
                             onOpenRelationGraph,
                             onOpenTimeline,
                             onOpenWorldMap,
                             onOpenContradiction,
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

    return (
        <RollingBox axis="y" ref={setOverviewScrollRef} className="pe-overview" thumbSize="thin">
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
                onExport={onExport}
                exporting={exporting}
                onDelete={onDelete}
                onDescriptionChange={onDescriptionChange}
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
                <div className="pe-overview-entries">
                    {childrenWithScrollElement}
                </div>
            )}
        </RollingBox>
    )
}

export default memo(ProjectOverview)
