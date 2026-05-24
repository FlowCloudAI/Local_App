import {ErrorCode, toApiError} from '../../../api/error'

export function isMissingBackendSessionError(error: unknown): boolean {
    return toApiError(error).code === ErrorCode.LlmSessionNotFound
}
