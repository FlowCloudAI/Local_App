/**
 * 为受控编辑状态提供有限历史记录；防抖期间的最新快照也必须参与撤销，避免快速操作失效。
 */
import {useCallback, useEffect, useRef, useState} from 'react'

const MAX_HISTORY = 100

export class UndoRedoHistory<T> {
    private history: T[]
    private cursor = 0
    private pendingState: T | undefined
    private hasPendingState = false

    constructor(initialState: T) {
        this.history = [initialState]
    }

    get canUndo(): boolean {
        return this.hasPendingState || this.cursor > 0
    }

    get canRedo(): boolean {
        return !this.hasPendingState && this.cursor < this.history.length - 1
    }

    setPending(state: T): void {
        this.pendingState = state
        this.hasPendingState = true
    }

    commitPending(): void {
        if (!this.hasPendingState) return
        const state = this.pendingState as T
        this.pendingState = undefined
        this.hasPendingState = false
        this.push(state)
    }

    push(state: T): void {
        this.pendingState = undefined
        this.hasPendingState = false
        this.history = this.history.slice(0, this.cursor + 1)
        this.history.push(state)
        if (this.history.length > MAX_HISTORY) {
            this.history.shift()
        } else {
            this.cursor++
        }
    }

    undo(): T | null {
        this.commitPending()
        if (this.cursor <= 0) return null
        this.cursor--
        return this.history[this.cursor]
    }

    redo(): T | null {
        if (this.hasPendingState) {
            this.commitPending()
            return null
        }
        if (this.cursor >= this.history.length - 1) return null
        this.cursor++
        return this.history[this.cursor]
    }

    reset(state: T): void {
        this.history = [state]
        this.cursor = 0
        this.pendingState = undefined
        this.hasPendingState = false
    }
}

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
    const historyRef = useRef<UndoRedoHistory<T> | null>(null)
    historyRef.current ??= new UndoRedoHistory(initialState)
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [canUndo, setCanUndo] = useState(false)
    const [canRedo, setCanRedo] = useState(false)

    const updateFlags = useCallback(() => {
        const history = historyRef.current!
        setCanUndo(history.canUndo)
        setCanRedo(history.canRedo)
    }, [])

    const clearDebounceTimer = useCallback(() => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
            debounceTimerRef.current = null
        }
    }, [])

    useEffect(() => clearDebounceTimer, [clearDebounceTimer])

    const push = useCallback((state: T) => {
        clearDebounceTimer()
        historyRef.current!.push(state)
        updateFlags()
    }, [clearDebounceTimer, updateFlags])

    const pushDebounced = useCallback((state: T, delayMs = 600) => {
        clearDebounceTimer()
        historyRef.current!.setPending(state)
        updateFlags()
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            historyRef.current!.commitPending()
            updateFlags()
        }, delayMs)
    }, [clearDebounceTimer, updateFlags])

    const flushDebounced = useCallback(() => {
        clearDebounceTimer()
        historyRef.current!.commitPending()
        updateFlags()
    }, [clearDebounceTimer, updateFlags])

    const undo = useCallback((): T | null => {
        clearDebounceTimer()
        const state = historyRef.current!.undo()
        updateFlags()
        return state
    }, [clearDebounceTimer, updateFlags])

    const redo = useCallback((): T | null => {
        clearDebounceTimer()
        const state = historyRef.current!.redo()
        updateFlags()
        return state
    }, [clearDebounceTimer, updateFlags])

    const reset = useCallback((state: T) => {
        clearDebounceTimer()
        historyRef.current!.reset(state)
        updateFlags()
    }, [clearDebounceTimer, updateFlags])

    return {push, pushDebounced, flushDebounced, undo, redo, reset, canUndo, canRedo}
}
