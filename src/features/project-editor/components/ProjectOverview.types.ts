import type {ReactNode} from 'react'
import type {
    Category,
    CustomEntryType,
    EntryTypeView,
    Project,
    ProjectStats,
    TagSchema,
} from '../../../api'

export interface ProjectOverviewProps {
    project: Project
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    entryCount: number
    tagCount: number
    imageCount?: number | null
    wordCount?: number | null
    projectStats?: ProjectStats | null
    mapCount?: number | null
    snapshotCount?: number | null
    riskSummary?: ProjectRiskSummary | null
    onCreateTag?: () => void
    onCreateEntryType?: () => void
    onCreateEntry?: () => void | Promise<void>
    onEditTag?: (tag: TagSchema) => void
    onEditEntryType?: (entryType: CustomEntryType) => void
    onOpenProjectAi?: () => void
    onOpenRelationGraph?: () => void
    onOpenTimeline?: () => void
    onOpenWorldMap?: () => void
    onOpenContradiction?: () => void
    onRename?: (name: string) => void | Promise<void>
    onEditCover?: () => void
    onClearCover?: () => void
    coverUpdating?: boolean
    onExport?: () => void | Promise<void>
    exporting?: boolean
    onDelete?: () => void | Promise<void>
    onDescriptionChange?: (description: string) => void | Promise<void>
    children?: ReactNode
}

export interface ProjectOverviewVirtualChildProps {
    virtualScrollElement?: HTMLElement | null
}

export interface ProjectRiskSummary {
    reportCount: number
    issueCount: number
    unresolvedCount: number
    latestOverview?: string | null
}
