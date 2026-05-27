import {command} from './base'

export type DocumentContextStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export interface DocumentContextItem {
    id: string
    conversationId?: string | null
    fileName: string
    sourcePath: string
    sha256: string
    extension: string
    parserId?: string | null
    status: DocumentContextStatus
    markdownPath?: string | null
    textPath?: string | null
    chunksPath?: string | null
    createdAt: string
    updatedAt: string
    error?: string | null
}

export interface DocumentContextUpdatedEvent {
    item: DocumentContextItem
}

export interface DocumentContextSource {
    itemId: string
    fileName: string
    parserId?: string | null
    format?: string | null
    includedChunks: number
    includedChars: number
}

export interface DocumentContextBuildResult {
    markdown: string
    sources: DocumentContextSource[]
    truncated: boolean
}

export interface BuildDocumentContextRequest {
    conversationId: string
    itemIds?: string[]
    maxChars?: number | null
}

export const DOCCTX_UPDATED = 'docctx:updated'

export const docctx_supported_extensions = () =>
    command<string[]>('docctx_supported_extensions')

export const docctx_add_files = (conversationId: string | null, filePaths: string[]) =>
    command<DocumentContextItem[]>('docctx_add_files', {conversationId, filePaths})

export const docctx_list_items = (conversationId?: string | null) =>
    command<DocumentContextItem[]>('docctx_list_items', {conversationId: conversationId ?? null})

export const docctx_remove_item = (itemId: string) =>
    command<void>('docctx_remove_item', {itemId})

export const docctx_retry_item = (itemId: string) =>
    command<DocumentContextItem>('docctx_retry_item', {itemId})

export const docctx_build_context = (request: BuildDocumentContextRequest) =>
    command<DocumentContextBuildResult>('docctx_build_context', {
        request: {
            conversationId: request.conversationId,
            itemIds: request.itemIds ?? [],
            maxChars: request.maxChars ?? null,
        },
    })
