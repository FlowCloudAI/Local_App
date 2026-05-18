import {command} from './base'

export interface PublicFeedbackPayload {
    kind: 'suggestion' | 'issue'
    title?: string
    content: string
    contact?: string
    app_version?: string
    page?: string
}

export interface PublicFeedbackResult {
    id?: string
    ok: boolean
}

export const submit_public_feedback = (payload: PublicFeedbackPayload) =>
    command<PublicFeedbackResult>('submit_public_feedback', {payload})
