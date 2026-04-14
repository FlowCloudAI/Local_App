import {useCallback, useRef, useState} from 'react'

const MAX_HISTORY = 100

export interface UndoRedoHandle<T> {
    push: (state: T) => void
    pushDebounced: (state: T, delayMs?: number) => void
    flushDebounced: () => void
    undo: () => T | null
    redo: () => T | null
    reset: (state: T) => void
    canUndo: boolean
    canRedo: boolean
}

export function useUndoRedo<T>(initialState: T): UndoRedoHandle<T> {
    const historyRef = useRef<T[]>([initialState])
    const cursorRef = useRef(0)
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [canUndo, setCanUndo] = useState(false)
    const [canRedo, setCanRedo] = useState(false)

    const updateFlags = useCallback(() => {
        setCanUndo(cursorRef.current > 0)
        setCanRedo(cursorRef.current < historyRef.current.length - 1)
    }, [])

    const push = useCallback((state: T) => {
        // Truncate any forward history
        historyRef.current = historyRef.current.slice(0, cursorRef.current + 1)
        historyRef.current.push(state)
        if (historyRef.current.length > MAX_HISTORY) {
            historyRef.current.shift()
        } else {
            cursorRef.current++
        }
        updateFlags()
    }, [updateFlags])

    const pushDebounced = useCallback((state: T, delayMs = 600) => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            push(state)
        }, delayMs)
    }, [push])

    const flushDebounced = useCallback(() => {
        // No-op if no pending debounce — caller shouldn't need to check
        if (debounceTimerRef.current === null) return
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
        // The state to commit is unknown here; callers must push explicitly after flush
    }, [])

    const undo = useCallback((): T | null => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
            debounceTimerRef.current = null
        }
        if (cursorRef.current <= 0) return null
        cursorRef.current--
        updateFlags()
        return historyRef.current[cursorRef.current]
    }, [updateFlags])

    const redo = useCallback((): T | null => {
        if (cursorRef.current >= historyRef.current.length - 1) return null
        cursorRef.current++
        updateFlags()
        return historyRef.current[cursorRef.current]
    }, [updateFlags])

    const reset = useCallback((state: T) => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
            debounceTimerRef.current = null
        }
        historyRef.current = [state]
        cursorRef.current = 0
        updateFlags()
    }, [updateFlags])

    return {push, pushDebounced, flushDebounced, undo, redo, reset, canUndo, canRedo}
}
