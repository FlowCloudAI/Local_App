import type {ReactNode} from 'react'
import type {
    Category,
    CustomEntryType,
    EntryTypeView,
    Project,
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
    onCreateTag?: () => void
    onCreateEntryType?: () => void
    onEditTag?: (tag: TagSchema) => void
    onEditEntryType?: (entryType: CustomEntryType) => void
    onOpenRelationGraph?: () => void
    onOpenTimeline?: () => void
    onOpenWorldMap?: () => void
    onOpenContradiction?: () => void
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
