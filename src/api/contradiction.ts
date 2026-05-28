import {command} from './base'
import type {WorldCheckReport} from './world_check'

export interface ContradictionEvidence {
    entryId: string
    entryTitle: string
    quote: string
    note?: string | null
}

export type ContradictionCategory = 'timeline' | 'relationship' | 'geography' | 'ability' | 'faction' | 'other'

export interface ContradictionIssue {
    issueId: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    category?: ContradictionCategory | null
    title: string
    description: string
    relatedEntryIds: string[]
    evidence: ContradictionEvidence[]
    recommendation?: string | null
}

export interface ContradictionReport {
    overview: string
    issues: ContradictionIssue[]
    unresolvedQuestions: string[]
    suggestions: string[]
}

export interface ContradictionLoadRequest {
    projectId: string
    entryIds?: string[] | null
    categoryId?: string | null
    query?: string | null
    maxEntries?: number | null
    maxCharsPerEntry?: number | null
    maxTotalChars?: number | null
}

export interface ContradictionSessionRequest extends ContradictionLoadRequest {
    sessionId: string
    pluginId: string
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    maxToolRounds?: number | null
}

export interface ContradictionSessionResult {
    session_id: string
    conversation_id: string
    run_id: string
    reportId: string
    report: ContradictionReport
    projectId: string
    projectName: string
    pluginId: string
    model?: string | null
    scopeSummary: string
    sourceEntryIds: string[]
    truncated: boolean
    worldCheckReport: WorldCheckReport
}

export interface StoredContradictionReport {
    reportId: string
    sessionId: string
    conversationId: string
    pluginId: string
    model?: string | null
    projectId: string
    projectName: string
    createdAt: string
    scopeSummary: string
    sourceEntryIds: string[]
    truncated: boolean
    report: ContradictionReport
}

export interface ContradictionReportHistoryItem {
    reportId: string
    conversationId: string
    pluginId: string
    model?: string | null
    projectId: string
    projectName: string
    createdAt: string
    scopeSummary: string
    sourceEntryIds: string[]
    truncated: boolean
    issueCount: number
    unresolvedCount: number
    overview: string
}

export const ai_start_contradiction_session = (input: ContradictionSessionRequest) =>
    command<ContradictionSessionResult>('ai_start_contradiction_session', {request: input})

export const ai_get_contradiction_report = (sessionId: string) =>
    command<{
        report: ContradictionReport
        scopeSummary: string
        sourceEntryIds: string[]
        truncated: boolean
    } | null>('ai_get_contradiction_report', {sessionId})

export const ai_list_contradiction_reports = (projectId: string) =>
    command<ContradictionReportHistoryItem[]>('ai_list_contradiction_reports', {projectId})

export const ai_get_contradiction_report_entry = (reportId: string) =>
    command<StoredContradictionReport | null>('ai_get_contradiction_report_entry', {reportId})

export const ai_delete_contradiction_report = (reportId: string) =>
    command<boolean>('ai_delete_contradiction_report', {reportId})
