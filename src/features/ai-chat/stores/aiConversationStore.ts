import {useSyncExternalStore} from 'react'
import type {Conversation} from '../model/AiControllerTypes'

type StateUpdate<T> = T | ((current: T) => T)

interface AiConversationSnapshot {
    conversations: Conversation[]
    activeConversationId: string | null
    unreadConversationIds: Record<string, boolean>
    conversationMetaLoaded: boolean
    version: number
}

const listeners = new Set<() => void>()

let snapshot: AiConversationSnapshot = {
    conversations: [],
    activeConversationId: null,
    unreadConversationIds: {},
    conversationMetaLoaded: false,
    version: 0,
}

function emit() {
    for (const listener of listeners) {
        listener()
    }
}

function setSnapshot(patch: Partial<Omit<AiConversationSnapshot, 'version'>>) {
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

function subscribeAiConversationStore(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getAiConversationSnapshot() {
    return snapshot
}

export function setAiConversations(update: StateUpdate<Conversation[]>) {
    setSnapshot({conversations: resolveUpdate(snapshot.conversations, update)})
}

export function setAiActiveConversationId(update: StateUpdate<string | null>) {
    setSnapshot({activeConversationId: resolveUpdate(snapshot.activeConversationId, update)})
}

export function setAiUnreadConversationIds(update: StateUpdate<Record<string, boolean>>) {
    setSnapshot({unreadConversationIds: resolveUpdate(snapshot.unreadConversationIds, update)})
}

export function setAiConversationMetaLoaded(conversationMetaLoaded: boolean) {
    setSnapshot({conversationMetaLoaded})
}

export function useAiConversationStore() {
    return useSyncExternalStore(
        subscribeAiConversationStore,
        getAiConversationSnapshot,
        getAiConversationSnapshot,
    )
}
