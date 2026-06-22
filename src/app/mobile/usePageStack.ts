import {useCallback, useRef, useState} from 'react'

export interface MobileProjectPageParams {
    projectId: string
    displayName?: string
}

export interface MobileEntryListPageParams extends MobileProjectPageParams {
    categoryId?: string
    uncategorizedOnly?: boolean
}

export interface MobileEntryDetailPageParams extends MobileProjectPageParams {
    entryId?: string
    mode?: 'view' | 'edit'
}

export type MobileProjectScopedPageParams = MobileProjectPageParams

export interface MobilePageParamsMap {
    projectList: undefined
    projectHome: MobileProjectPageParams
    entryList: MobileEntryListPageParams
    entryDetail: MobileEntryDetailPageParams
    typeManager: MobileProjectScopedPageParams
    tagManager: MobileProjectScopedPageParams
    categoryManager: MobileProjectScopedPageParams
    settingsAi: undefined
    settingsPlugins: undefined
    settingsAppearance: undefined
    settingsUsage: undefined
    settingsAbout: undefined
}

export type MobilePageType = keyof MobilePageParamsMap

export type MobileSettingsPageType =
    | 'settingsAi'
    | 'settingsPlugins'
    | 'settingsAppearance'
    | 'settingsUsage'
    | 'settingsAbout'

export type MobilePageOf<T extends MobilePageType = MobilePageType> = {
    [K in T]: MobilePageParamsMap[K] extends undefined
        ? {type: K; params?: undefined}
        : {type: K; params: MobilePageParamsMap[K]}
}[T]

export type MobilePage = MobilePageOf

export interface PageStack {
    push: (page: MobilePage) => void
    pop: () => void
    back: (fallback: () => void) => void
    replace: (page: MobilePage) => void
    currentPage: MobilePage | null
    canGoBack: boolean
    stack: MobilePage[]
}

export function usePageStack(): PageStack {
    const [stack, setStack] = useState<MobilePage[]>([])
    const stackRef = useRef<MobilePage[]>([])

    const push = useCallback((page: MobilePage) => {
        stackRef.current = [...stackRef.current, page]
        setStack(stackRef.current)
    }, [])

    const pop = useCallback(() => {
        if (stackRef.current.length <= 1) {
            stackRef.current = []
            setStack([])
            return
        }
        stackRef.current = stackRef.current.slice(0, -1)
        setStack(stackRef.current)
    }, [])

    const back = useCallback((fallback: () => void) => {
        if (stackRef.current.length > 0) {
            pop()
        } else {
            fallback()
        }
    }, [pop])

    const replace = useCallback((page: MobilePage) => {
        const next = [...stackRef.current]
        next[next.length - 1] = page
        stackRef.current = next
        setStack(next)
    }, [])

    return {
        push,
        pop,
        back,
        replace,
        currentPage: stack.length > 0 ? stack[stack.length - 1] : null,
        canGoBack: stack.length > 0,
        stack,
    }
}

export function createPage<T extends MobilePageType>(
    type: T,
    ...args: MobilePageParamsMap[T] extends undefined ? [] : [params: MobilePageParamsMap[T]]
): MobilePageOf<T> {
    const params = args[0]
    return (params === undefined ? {type} : {type, params}) as MobilePageOf<T>
}
