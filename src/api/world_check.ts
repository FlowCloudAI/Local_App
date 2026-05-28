import type {ContradictionEvidence, ContradictionIssue, ContradictionReport} from './contradiction'
import {command} from './base'

export type WorldCheckKind = 'contradiction' | 'entry_alignment' | 'publication_risk'

export type WorldCheckSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface WorldCheckEvidence {
    entryId: string
    entryTitle: string
    quote: string
    note?: string | null
}

export interface WorldCheckFinding {
    findingId: string
    severity: WorldCheckSeverity
    category?: string | null
    title: string
    description: string
    relatedEntryIds: string[]
    evidence: WorldCheckEvidence[]
    recommendation?: string | null
    metadata?: Record<string, unknown> | null
}

export interface WorldCheckReport {
    checkKind: WorldCheckKind
    overview: string
    score?: number | null
    findings: WorldCheckFinding[]
    unresolvedQuestions: string[]
    suggestions: string[]
    metadata?: Record<string, unknown> | null
}

export interface WorldCheckLoadRequest {
    projectId: string
    entryIds?: string[] | null
    targetEntryId?: string | null
    categoryId?: string | null
    query?: string | null
    maxEntries?: number | null
    maxCharsPerEntry?: number | null
    maxTotalChars?: number | null
}

export interface WorldCheckSessionRequest extends WorldCheckLoadRequest {
    sessionId: string
    pluginId: string
    checkKind: WorldCheckKind
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    maxToolRounds?: number | null
}

export interface WorldCheckSessionResult {
    session_id: string
    conversation_id: string
    run_id: string
    reportId: string
    checkKind: WorldCheckKind
    report: WorldCheckReport
    projectId: string
    projectName: string
    pluginId: string
    model?: string | null
    scopeSummary: string
    sourceEntryIds: string[]
    targetEntryId?: string | null
    truncated: boolean
}

export interface StoredWorldCheckReport {
    reportId: string
    sessionId: string
    conversationId: string
    checkKind: WorldCheckKind
    pluginId: string
    model?: string | null
    projectId: string
    projectName: string
    createdAt: string
    scopeSummary: string
    sourceEntryIds: string[]
    targetEntryId?: string | null
    truncated: boolean
    report: WorldCheckReport
}

export interface WorldCheckReportHistoryItem {
    reportId: string
    conversationId: string
    checkKind: WorldCheckKind
    pluginId: string
    model?: string | null
    projectId: string
    projectName: string
    createdAt: string
    scopeSummary: string
    sourceEntryIds: string[]
    targetEntryId?: string | null
    truncated: boolean
    findingCount: number
    unresolvedCount: number
    overview: string
}

export const ai_start_world_check_session = (input: WorldCheckSessionRequest) =>
    command<WorldCheckSessionResult>('ai_start_world_check_session', {request: input})

export const ai_get_world_check_report = (sessionId: string) =>
    command<{
        report: WorldCheckReport
        scopeSummary: string
        sourceEntryIds: string[]
        targetEntryId?: string | null
        truncated: boolean
    } | null>('ai_get_world_check_report', {sessionId})

export const ai_list_world_check_reports = (projectId: string, checkKind?: WorldCheckKind | null) =>
    command<WorldCheckReportHistoryItem[]>('ai_list_world_check_reports', {projectId, checkKind})

export const ai_get_world_check_report_entry = (reportId: string) =>
    command<StoredWorldCheckReport | null>('ai_get_world_check_report_entry', {reportId})

export const ai_delete_world_check_report = (reportId: string) =>
    command<boolean>('ai_delete_world_check_report', {reportId})

const contradictionEvidenceToWorldCheckEvidence = (
    evidence: ContradictionEvidence,
): WorldCheckEvidence => ({
    entryId: evidence.entryId,
    entryTitle: evidence.entryTitle,
    quote: evidence.quote,
    note: evidence.note,
})

const contradictionIssueToWorldCheckFinding = (
    issue: ContradictionIssue,
): WorldCheckFinding => ({
    findingId: issue.issueId,
    severity: issue.severity,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    relatedEntryIds: issue.relatedEntryIds,
    evidence: issue.evidence.map(contradictionEvidenceToWorldCheckEvidence),
    recommendation: issue.recommendation,
    metadata: null,
})

export const contradictionReportToWorldCheckReport = (
    report: ContradictionReport,
): WorldCheckReport => ({
    checkKind: 'contradiction',
    overview: report.overview,
    score: null,
    findings: report.issues.map(contradictionIssueToWorldCheckFinding),
    unresolvedQuestions: report.unresolvedQuestions,
    suggestions: report.suggestions,
    metadata: null,
})
