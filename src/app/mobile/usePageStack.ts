import {useCallback, useRef, useState} from 'react'

export interface MobilePage {
    type: string
    params?: Record<string, unknown>
}

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

export function createPage(type: string, params?: Record<string, unknown>): MobilePage {
    return {type, params}
}
