import type {ContradictionEvidence, ContradictionIssue, ContradictionReport} from './contradiction'

export type WorldCheckKind = 'contradiction'

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
