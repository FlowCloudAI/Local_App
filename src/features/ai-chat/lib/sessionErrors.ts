export function isMissingBackendSessionError(error: unknown): boolean {
    const message = String(error)
    return message.includes('Session') && message.includes('不存在')
}
