import {type MessageBoxBlock} from 'flowcloudai-ui'
import {type AiUsage, type DocumentContextItem, type PluginInfo, type ToolStatus} from '../../../api'

export interface Attachment {
    id: string
    name: string
    type: 'image' | 'file'
    data: string
    preview?: string
}

export interface ReportConversationContext {
    reportId: string
    projectId: string
    projectName: string
    scopeSummary: string
    sourceEntryIds: string[]
    truncated: boolean
    reportJson: string
}

export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    reasoning?: string
    blocks?: MessageBoxBlock[]
    attachments?: Attachment[]
    nodeId?: number
    usage?: AiUsage | null
}

export interface ConversationSettings {
    temperature: number
    topP: number
    frequencyPenaltyEnabled: boolean
    frequencyPenalty: number
    presencePenaltyEnabled: boolean
    presencePenalty: number
    systemPrompt: string
}

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
    temperature: 0.7,
    topP: 1,
    frequencyPenaltyEnabled: false,
    frequencyPenalty: 0,
    presencePenaltyEnabled: false,
    presencePenalty: 0,
    systemPrompt: '',
}

export const CONVERSATION_TEMPERATURE_MAX = 1.9

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return Math.min(max, Math.max(min, numberValue))
}

export function normalizeConversationSettings(
    settings?: Partial<ConversationSettings> | null,
): ConversationSettings {
    return {
        ...DEFAULT_CONVERSATION_SETTINGS,
        ...settings,
        temperature: clampNumber(
            settings?.temperature,
            DEFAULT_CONVERSATION_SETTINGS.temperature,
            0,
            CONVERSATION_TEMPERATURE_MAX,
        ),
        topP: clampNumber(settings?.topP, DEFAULT_CONVERSATION_SETTINGS.topP, 0, 1),
        frequencyPenalty: clampNumber(
            settings?.frequencyPenalty,
            DEFAULT_CONVERSATION_SETTINGS.frequencyPenalty,
            -2,
            2,
        ),
        presencePenalty: clampNumber(
            settings?.presencePenalty,
            DEFAULT_CONVERSATION_SETTINGS.presencePenalty,
            -2,
            2,
        ),
        frequencyPenaltyEnabled: Boolean(settings?.frequencyPenaltyEnabled),
        presencePenaltyEnabled: Boolean(settings?.presencePenaltyEnabled),
        systemPrompt: settings?.systemPrompt ?? DEFAULT_CONVERSATION_SETTINGS.systemPrompt,
    }
}

export interface Conversation {
    id: string
    title: string
    messages: Message[]
    pluginId: string
    model: string
    sessionId: string | null
    runId: string | null
    timestamp: number
    pinnedAt?: string | null
    archivedAt?: string | null
    mode?: 'default' | 'character' | 'report'
    characterEntryId?: string | null
    characterName?: string | null
    backgroundImageUrl?: string | null
    characterVoiceId?: string | null
    characterAutoPlay?: boolean | null
    reportContext?: ReportConversationContext | null
    reportSeeded?: boolean
    settings: ConversationSettings
}

export interface ConversationRuntimeState {
    isStreaming: boolean
    hasUnreadReply: boolean
}

export interface SessionParams {
    thinking: boolean
    maxToolRounds?: number | null
}

export interface AiFocusContext {
    projectId: string | null
    projectName: string | null
    entryId: string | null
    entryTitle: string | null
    editModeEnabled: boolean
    webSearchEnabled: boolean
}

export interface AiContextValue {
    plugins: PluginInfo[]
    pluginsReady: boolean
    selectedPlugin: string
    selectedModel: string
    setSelectedPlugin: (v: string) => void
    setSelectedModel: (v: string) => void

    conversations: Conversation[]
    activeConversationId: string | null
    setActiveConversationId: (id: string | null) => void

    messages: Message[]
    documentContextItems: DocumentContextItem[]
    addDocumentContextFiles: (filePaths: string[]) => Promise<void>
    removeDocumentContextItem: (itemId: string) => Promise<void>
    retryDocumentContextItem: (itemId: string) => Promise<void>
    sendMessage: (content: string) => Promise<void>
    stopStreaming: () => void
    regenerateMessage: (messageId: string) => Promise<void>
    editMessage: (messageId: string) => void

    inputValue: string
    setInputValue: (v: string) => void
    editingMessageId: string | null
    setEditingMessageId: (id: string | null) => void

    tools: ToolStatus[]
    webSearchEnabled: boolean
    editModeEnabled: boolean
    focusContext: AiFocusContext
    toggleWebSearch: () => Promise<void>
    toggleEditMode: () => Promise<void>
    sessionParams: SessionParams
    setSessionParams: (v: SessionParams | ((prev: SessionParams) => SessionParams)) => void

    isStreaming: boolean
    streamingBlocks: MessageBoxBlock[]
    conversationRuntime: Record<string, ConversationRuntimeState>

    sidebarCollapsed: boolean
    setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void
    autoScroll: boolean
    setAutoScroll: (v: boolean) => void

    createNewConversation: () => Promise<void>
    startReportDiscussion: (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => Promise<void>
    startCharacterConversation: (params: {
        projectId: string
        entryId: string
    }) => Promise<void>
    updateConversationCharacterAutoPlay: (convId: string, autoPlay: boolean) => void
    updateConversationSettings: (convId: string, patch: Partial<ConversationSettings>) => Promise<void>
    switchConversation: (convId: string) => Promise<void>
    deleteConversation: (convId: string, e?: React.MouseEvent) => Promise<void>
    renameConversation: (convId: string, title: string) => Promise<void>
    toggleConversationPinned: (convId: string, e?: React.MouseEvent) => void
    toggleConversationArchived: (convId: string, e?: React.MouseEvent) => void
    activeConversation: Conversation | undefined
    getBranchInfo: (nodeId: number) => { branchIndex: number; branchTotal: number } | null
    switchBranch: (nodeId: number, direction: 'prev' | 'next') => Promise<boolean>
}
