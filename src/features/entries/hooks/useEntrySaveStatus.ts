import {useMemo} from 'react'

interface UseEntrySaveStatusOptions {
    entryLoaded: boolean
    hasChanges: boolean
    trimmedTitle: string
    hasInvalidRelationDrafts: boolean
    saving: boolean
}

export default function useEntrySaveStatus({
                                               entryLoaded,
                                               hasChanges,
                                               trimmedTitle,
                                               hasInvalidRelationDrafts,
                                               saving,
                                           }: UseEntrySaveStatusOptions) {
    return useMemo(() => {
        if (!entryLoaded || !hasChanges) return ''
        if (!trimmedTitle) return '标题为空，无法保存'
        if (hasInvalidRelationDrafts) return '存在未完成关系，请处理后手动保存'
        if (saving) return ''
        return '存在未保存修改'
    }, [entryLoaded, hasChanges, hasInvalidRelationDrafts, saving, trimmedTitle])
}
