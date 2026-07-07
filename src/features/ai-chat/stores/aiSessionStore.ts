import type {useAiSession} from '../hooks/useAiSession'

type AiSessionApi = ReturnType<typeof useAiSession>

const runtimeConversationByRun: Record<string, string> = {}
const autoCompactInFlight = new Set<string>()
let abortController: AbortController | null = null
let sessionApi: AiSessionApi | null = null

const runtimeConversationKey = (sessionId: string, runId: string) => `${sessionId}::${runId}`

export function findRuntimeConversation(sessionId: string, runId: string) {
    return runtimeConversationByRun[runtimeConversationKey(sessionId, runId)]
}

export function setRuntimeConversation(sessionId: string, runId: string, conversationId: string) {
    runtimeConversationByRun[runtimeConversationKey(sessionId, runId)] = conversationId
}

export function deleteRuntimeConversation(sessionId: string, runId: string) {
    delete runtimeConversationByRun[runtimeConversationKey(sessionId, runId)]
}

export function deleteRuntimeConversationsById(conversationId: string) {
    Object.entries(runtimeConversationByRun).forEach(([key, mappedConversationId]) => {
        if (mappedConversationId === conversationId) {
            delete runtimeConversationByRun[key]
        }
    })
}

export function setAiAbortController(controller: AbortController | null) {
    abortController = controller
}

export function abortAiStreamingController() {
    abortController?.abort()
}

export function setAiSessionApi(api: AiSessionApi | null) {
    sessionApi = api
}

export function getAiSessionApi() {
    return sessionApi
}

export function markAutoCompactInFlight(key: string) {
    if (autoCompactInFlight.has(key)) return false
    autoCompactInFlight.add(key)
    return true
}

export function clearAutoCompactInFlight(key: string) {
    autoCompactInFlight.delete(key)
}
