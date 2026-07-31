/**
 * 保存完成后，仅在用户没有继续编辑时用数据库结果刷新本地状态。
 */
export function resolveSavedState<T>(current: T, submitted: T, refreshed: T): T {
    return current === submitted ? refreshed : current
}

export function shouldAutoSave(
    active: boolean,
    editing: boolean,
    hasUserEdited: boolean,
    canSave: boolean,
): boolean {
    return active && editing && hasUserEdited && canSave
}
