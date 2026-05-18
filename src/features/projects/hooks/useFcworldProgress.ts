import {useCallback, useEffect, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    FCWORLD_PROGRESS_EVENT,
    type FcworldProgressEvent,
    type FcworldProgressKind,
    type FcworldProgressStatus,
} from '../../../api'

export interface FcworldProgressState {
    operationId: string
    kind: FcworldProgressKind
    title: string
    phase: string
    message: string
    current: number
    total: number
    percent: number
    status: FcworldProgressStatus
}

function createOperationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `fcworld-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useFcworldProgress() {
    const activeOperationIdRef = useRef<string | null>(null)
    const [progress, setProgress] = useState<FcworldProgressState | null>(null)

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null

        void listen<FcworldProgressEvent>(FCWORLD_PROGRESS_EVENT, event => {
            if (disposed) return
            const payload = event.payload
            if (!payload.operationId || payload.operationId !== activeOperationIdRef.current) return
            setProgress(current => {
                if (!current || current.operationId !== payload.operationId) return current
                return {
                    ...current,
                    kind: payload.kind,
                    phase: payload.phase,
                    message: payload.message,
                    current: payload.current,
                    total: payload.total,
                    percent: Math.max(0, Math.min(100, payload.percent)),
                    status: payload.status,
                }
            })
        }).then(fn => {
            if (disposed) {
                fn()
                return
            }
            unlisten = fn
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    const startProgress = useCallback((kind: FcworldProgressKind, title: string) => {
        const operationId = createOperationId()
        activeOperationIdRef.current = operationId
        setProgress({
            operationId,
            kind,
            title,
            phase: 'start',
            message: '准备中…',
            current: 0,
            total: 0,
            percent: 0,
            status: 'running',
        })
        return operationId
    }, [])

    const closeProgress = useCallback(() => {
        activeOperationIdRef.current = null
        setProgress(null)
    }, [])

    return {
        progress,
        startProgress,
        closeProgress,
    }
}
