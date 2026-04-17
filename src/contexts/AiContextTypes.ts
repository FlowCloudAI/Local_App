import {type MessageBoxBlock} from 'flowcloudai-ui'
import {type PluginInfo, type ToolStatus} from '../api'

export interface Attachment {
    id: string
    name: string
    type: 'image' | 'file'
    data: string
    preview?: string
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
}

export interface SessionParams {
    thinking: boolean
}

export interface AiContextValue {
    plugins: PluginInfo[]
    selectedPlugin: string
    selectedModel: string
    setSelectedPlugin: (v: string) => void
    setSelectedModel: (v: string) => void

    conversations: Conversation[]
    activeConversationId: string | null
    setActiveConversationId: (id: string | null) => void

    messages: Message[]
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
    toggleWebSearch: () => Promise<void>
    toggleEditMode: () => Promise<void>
    sessionParams: SessionParams
    setSessionParams: (v: SessionParams | ((prev: SessionParams) => SessionParams)) => void

    isStreaming: boolean
    streamingBlocks: MessageBoxBlock[]

    sidebarCollapsed: boolean
    setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void
    autoScroll: boolean
    setAutoScroll: (v: boolean) => void

    createNewConversation: () => Promise<void>
    switchConversation: (convId: string) => Promise<void>
    deleteConversation: (convId: string, e?: React.MouseEvent) => Promise<void>
    renameConversation: (convId: string, title: string) => Promise<void>
    activeConversation: Conversation | undefined
}
