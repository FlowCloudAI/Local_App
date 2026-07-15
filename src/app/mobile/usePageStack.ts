import {useCallback, useMemo, useRef, useState} from 'react'

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

export interface MobileAiSettingsPageParams {
    pluginId?: string
}

export interface MobilePageParamsMap {
    projectList: undefined
    projectHome: MobileProjectPageParams
    entryList: MobileEntryListPageParams
    entryDetail: MobileEntryDetailPageParams
    typeManager: MobileProjectScopedPageParams
    tagManager: MobileProjectScopedPageParams
    categoryManager: MobileProjectScopedPageParams
    settingsAi: MobileAiSettingsPageParams
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
    /**
     * 栈顶页面的身份标识，用作页面组件的 React key。
     * 同类型页面互相 push（词条 A→点双链→词条 B）时类型不变，
     * 没有它 React 会复用同一个实例，本地 state（mode / 表单 / 滚动）会串页。
     */
    currentPageKey: string
    canGoBack: boolean
    stack: MobilePage[]
}

interface PageStackEntry {
    page: MobilePage
    key: string
}

let pageKeySeq = 0

function nextPageKey(): string {
    pageKeySeq += 1
    return `page-${pageKeySeq}`
}

export function usePageStack(): PageStack {
    const [entries, setEntries] = useState<PageStackEntry[]>([])
    const entriesRef = useRef<PageStackEntry[]>([])

    const push = useCallback((page: MobilePage) => {
        entriesRef.current = [...entriesRef.current, {page, key: nextPageKey()}]
        setEntries(entriesRef.current)
    }, [])

    const pop = useCallback(() => {
        if (entriesRef.current.length <= 1) {
            entriesRef.current = []
            setEntries([])
            return
        }
        entriesRef.current = entriesRef.current.slice(0, -1)
        setEntries(entriesRef.current)
    }, [])

    const back = useCallback((fallback: () => void) => {
        if (entriesRef.current.length > 0) {
            pop()
        } else {
            fallback()
        }
    }, [pop])

    // replace 沿用栈顶原 key：它表达的是「同一个页面换参数」（如词条保存后回写标题），
    // 换 key 会重挂载并丢掉正在编辑的内容。真正的换页请用 push / pop。
    const replace = useCallback((page: MobilePage) => {
        const current = entriesRef.current
        const next = current.length > 0
            ? [...current.slice(0, -1), {page, key: current[current.length - 1].key}]
            : [{page, key: nextPageKey()}]
        entriesRef.current = next
        setEntries(next)
    }, [])

    const stack = useMemo(() => entries.map(entry => entry.page), [entries])
    const currentEntry = entries.length > 0 ? entries[entries.length - 1] : null

    return {
        push,
        pop,
        back,
        replace,
        currentPage: currentEntry?.page ?? null,
        currentPageKey: currentEntry?.key ?? '',
        canGoBack: entries.length > 0,
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
