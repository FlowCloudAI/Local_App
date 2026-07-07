import {useSyncExternalStore} from 'react'
import type {DocumentContextItem} from '../../../api'
import type {AiFocusContext} from '../model/AiControllerTypes'

type StateUpdate<T> = T | ((current: T) => T)

interface AiContextSnapshot {
    focusContext: AiFocusContext
    documentContextItemsByConversation: Record<string, DocumentContextItem[]>
    pendingDocumentAttachmentIdsByConversation: Record<string, string[]>
    version: number
}

const listeners = new Set<() => void>()

let snapshot: AiContextSnapshot = {
    focusContext: {
        projectId: null,
        projectName: null,
        entryId: null,
        entryTitle: null,
        editModeEnabled: true,
        webSearchEnabled: true,
    },
    documentContextItemsByConversation: {},
    pendingDocumentAttachmentIdsByConversation: {},
    version: 0,
}

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function setSnapshot(patch: Partial<Omit<AiContextSnapshot, 'version'>>) {
    snapshot = {
        ...snapshot,
        ...patch,
        version: snapshot.version + 1,
    }
    emit()
}

function resolveUpdate<T>(current: T, update: StateUpdate<T>) {
    return typeof update === 'function'
        ? (update as (current: T) => T)(current)
        : update
}

function subscribeAiContextStore(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function setAiFocusContext(update: StateUpdate<AiFocusContext>) {
    setSnapshot({focusContext: resolveUpdate(snapshot.focusContext, update)})
}

export function setAiDocumentContextItemsByConversation(
    update: StateUpdate<Record<string, DocumentContextItem[]>>,
) {
    setSnapshot({
        documentContextItemsByConversation: resolveUpdate(
            snapshot.documentContextItemsByConversation,
            update,
        ),
    })
}

export function setAiPendingDocumentAttachmentIdsByConversation(
    update: StateUpdate<Record<string, string[]>>,
) {
    setSnapshot({
        pendingDocumentAttachmentIdsByConversation: resolveUpdate(
            snapshot.pendingDocumentAttachmentIdsByConversation,
            update,
        ),
    })
}

export function useAiContextStore() {
    return useSyncExternalStore(
        subscribeAiContextStore,
        () => snapshot,
        () => snapshot,
    )
}
