import {useCallback, useEffect, useState} from 'react'
import {formatApiError, toApiError} from '../../../api'
import {logger} from '../../../shared/logger'

export default function useMobileEntryDetailLoader(entryId: string, reloadEntry: () => Promise<unknown>) {
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        if (!entryId) return
        setLoading(true)
        setLoadError(null)
        try {
            await reloadEntry()
        } catch (error) {
            logger.error('加载词条失败', error)
            setLoadError(formatApiError(toApiError(error)))
        } finally {
            setLoading(false)
        }
    }, [entryId, reloadEntry])

    useEffect(() => {
        void reload()
    }, [reload])

    return {loading, loadError, reload, setLoadError}
}
