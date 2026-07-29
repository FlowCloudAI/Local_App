/**
 * 汇总词条编辑器的持久化状态；工具栏只消费稳定的状态类型，不直接推断保存条件。
 */
interface UseEntrySaveStatusOptions {
    entryLoaded: boolean
    hasChanges: boolean
    trimmedTitle: string
    hasInvalidRelationDrafts: boolean
    saving: boolean
    saveError: string | null
}

export interface EntrySaveStatus {
    kind: 'saved' | 'dirty' | 'saving' | 'blocked' | 'error'
    text: string
    detail?: string
}

export function resolveEntrySaveStatus({
                                           entryLoaded,
                                           hasChanges,
                                           trimmedTitle,
                                           hasInvalidRelationDrafts,
                                           saving,
                                           saveError,
                                       }: UseEntrySaveStatusOptions): EntrySaveStatus {
    if (saving) return {kind: 'saving', text: '正在保存…'}
    if (saveError) return {kind: 'error', text: '保存失败', detail: saveError}
    if (!entryLoaded || !hasChanges) return {kind: 'saved', text: '已保存'}
    if (!trimmedTitle) return {kind: 'blocked', text: '标题为空，无法保存'}
    if (hasInvalidRelationDrafts) {
        return {kind: 'blocked', text: '存在未完成关系，请处理后保存'}
    }
    return {kind: 'dirty', text: '存在未保存修改'}
}

export default function useEntrySaveStatus(options: UseEntrySaveStatusOptions) {
    return resolveEntrySaveStatus(options)
}
