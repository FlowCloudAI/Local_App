import {command} from './base'

export type AiPluginKind = 'llm' | 'image' | 'tts'

export interface PluginInfo {
  id: string
  name: string
  kind: string
  models: string[]
  default_model: string | null
    supported_sizes: string[]
    supported_voices: string[]
}

export interface AiCreateLlmSessionParams {
  sessionId: string
  pluginId: string
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  /** 续聊已有对话时传入其 ID，后端将回放历史并覆写原文件 */
  conversationId?: string | null
}

export interface AiCreateLlmSessionResult {
  session_id: string
  conversation_id: string
  run_id: string
}

export interface CharacterChatProjectMeta {
    id: string
    name: string
    description?: string | null
}

export interface CharacterChatCategorySnapshot {
    id: string
    name: string
    parentId?: string | null
    path: string[]
}

export interface CharacterChatTagSchemaSnapshot {
    id: string
    name: string
    description?: string | null
    type: string
    target: string[]
}

export interface CharacterChatTagSnapshot {
    schemaId?: string | null
    name: string
    value: string
}

export interface CharacterChatEntrySnapshot {
    id: string
    title: string
    summary?: string | null
    content?: string | null
    entryType?: string | null
    categoryId?: string | null
    categoryPath: string[]
    tags: CharacterChatTagSnapshot[]
}

export interface CharacterChatRelationSnapshot {
    id: string
    fromEntryId: string
    toEntryId: string
    relation: string
    content: string
}

export interface CharacterChatProjectSnapshot {
    project: CharacterChatProjectMeta
    targetCharacter: CharacterChatEntrySnapshot
    categories: CharacterChatCategorySnapshot[]
    tagSchemas: CharacterChatTagSchemaSnapshot[]
    entries: CharacterChatEntrySnapshot[]
    relations: CharacterChatRelationSnapshot[]
}

export interface AiCreateCharacterSessionParams {
    sessionId: string
    pluginId: string
    characterName: string
    projectSnapshot: CharacterChatProjectSnapshot
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
}

export interface ImageData {
  url: string | null
  size: string | null
}

export interface AiImageParams {
  pluginId: string
  model: string
  prompt: string
    size?: string | null
}

export interface AiEditImageParams extends AiImageParams {
  imageUrl: string
}

export interface AiMergeImagesParams extends AiImageParams {
  imageUrls: string[]
}

export interface TtsResult {
  audio_base64: string
    audio_url: string | null
  format: string
  duration_ms: number | null
}

export interface AiSpeakParams {
  pluginId: string
  model: string
  text: string
  voiceId: string
}

export interface AiEventReady {
  session_id: string
  run_id: string
}

export interface AiEventDelta {
  session_id: string
  run_id: string
  text: string
}

export interface AiEventReasoning {
  session_id: string
  run_id: string
  text: string
}

export interface AiEventToolCall {
  session_id: string
  run_id: string
  index: number
  name: string
  arguments?: string
}

export interface AiEventTurnEnd {
  session_id: string
  run_id: string
  status: string
  node_id: number
}

export interface AiEventTurnBegin {
  session_id: string
  run_id: string
  turn_id: number
  node_id: number
}

export interface AiEventToolResult {
  session_id: string
  run_id: string
  index: number
  output: string
  result?: string
  is_error: boolean
}

export interface AiEventError {
  session_id: string
  run_id: string
  error: string
}

export const AI_EVENT_READY = 'ai:ready'
export const AI_EVENT_DELTA = 'ai:delta'
export const AI_EVENT_REASONING = 'ai:reasoning'
export const AI_EVENT_TURN_BEGIN = 'ai:turn_begin'
export const AI_EVENT_TOOL_CALL = 'ai:tool_call'
export const AI_EVENT_TOOL_RESULT = 'ai:tool_result'
export const AI_EVENT_TURN_END = 'ai:turn_end'
export const AI_EVENT_ERROR = 'ai:error'

export interface ToolStatus {
    name: string
    enabled: boolean
}

export const ai_list_plugins = (kind: AiPluginKind) =>
  command<PluginInfo[]>('ai_list_plugins', { kind })

export const ai_create_llm_session = ({
  sessionId,
  pluginId,
  model,
  temperature,
  maxTokens,
                                        conversationId,
}: AiCreateLlmSessionParams) =>
    command<AiCreateLlmSessionResult>('ai_create_llm_session', {
    sessionId,
    pluginId,
    model,
    temperature,
    maxTokens,
      conversationId,
  })

export const ai_create_character_session = ({
                                                sessionId,
                                                pluginId,
                                                characterName,
                                                projectSnapshot,
                                                model,
                                                temperature,
                                                maxTokens,
                                            }: AiCreateCharacterSessionParams) =>
    command<AiCreateLlmSessionResult>('ai_create_character_session', {
        input: {
            sessionId,
            pluginId,
            characterName,
            projectSnapshot,
            model,
            temperature,
            maxTokens,
        },
    })

export const ai_send_message = (sessionId: string, message: string) =>
  command<void>('ai_send_message', { sessionId, message })

export const ai_close_session = (sessionId: string) =>
  command<void>('ai_close_session', { sessionId })

export const ai_close_all_sessions = () =>
    command<number>('ai_close_all_sessions')

export const ai_cancel_session = (sessionId: string) =>
    command<void>('ai_cancel_session', {sessionId})

export const ai_checkout = (sessionId: string, nodeId: number) =>
    command<void>('ai_checkout', {sessionId, nodeId})

export const ai_switch_plugin = (sessionId: string, pluginId: string) =>
    command<void>('ai_switch_plugin', {sessionId, pluginId})

export interface UpdateSessionParams {
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  thinking?: boolean
  frequencyPenalty?: number
  presencePenalty?: number
  topP?: number
  stop?: string[]
  responseFormat?: Record<string, unknown>
  n?: number
  toolChoice?: string
  logprobs?: boolean
  topLogprobs?: number
}

export const ai_update_session = (sessionId: string, params: UpdateSessionParams) =>
    command<void>('ai_update_session', {sessionId, params})

export const ai_text_to_image = ({pluginId, model, prompt, size}: AiImageParams) =>
    command<ImageData[]>('ai_text_to_image', {pluginId, model, prompt, size})

export const ai_edit_image = ({
  pluginId,
  model,
  prompt,
  imageUrl,
}: AiEditImageParams) =>
    command<ImageData[]>('ai_edit_image', {pluginId, model, prompt, imageUrl})

export const ai_merge_images = ({
  pluginId,
  model,
  prompt,
  imageUrls,
}: AiMergeImagesParams) =>
    command<ImageData[]>('ai_merge_images', {pluginId, model, prompt, imageUrls})

export const ai_speak = ({pluginId, model, text, voiceId}: AiSpeakParams) =>
    command<TtsResult>('ai_speak', {pluginId, model, text, voiceId})

export const ai_play_tts = ({pluginId, model, text, voiceId}: AiSpeakParams) =>
    command<void>('ai_play_tts', {pluginId, model, text, voiceId})

// ── 对话历史管理 ──────────────────────────────────────────────────────────────

export interface ConversationMeta {
  id: string
  title: string
  plugin_id: string
  model: string
  created_at: string
  updated_at: string
}

export interface StoredMessage {
  message_id?: string | null
  node_id?: number | null
  turn_id?: number | null
  role: string
  content: string | null
  reasoning: string | null
  timestamp: string
  tool_call_id?: string | null
  tool_calls?: {
    id?: string | null
    index: number
    type?: string | null
    name?: string
    arguments?: string
    function?: {
      name?: string
      arguments?: string
    }
  }[]
}

export interface StoredConversation extends ConversationMeta {
  schema_version?: number
  messages: StoredMessage[]
}

export interface SummaryResult {
    summaryMarkdown: string
    highlights: string[]
    sourceEntryIds: string[]
    warnings: string[]
}

export interface SummaryDraftEntry {
    entryId: string
    title?: string | null
    summary?: string | null
    content?: string | null
    entryType?: string | null
}

export interface GenerateEntrySummaryParams {
    pluginId: string
    projectId: string
    entryIds: string[]
    focus?: string | null
    outputMode?: string | null
    draftEntry?: SummaryDraftEntry | null
    model?: string | null
    maxTokens?: number | null
}

export const ai_generate_entry_summary = ({
                                              pluginId,
                                              projectId,
                                              entryIds,
                                              focus,
                                              outputMode,
                                              draftEntry,
                                              model,
                                              maxTokens,
                                          }: GenerateEntrySummaryParams) =>
    command<SummaryResult>('ai_generate_entry_summary', {
        request: {
            pluginId,
            projectId,
            entryIds,
            focus,
            outputMode,
            draftEntry,
            model,
            maxTokens,
        },
    })

export const ai_list_conversations = () =>
    command<ConversationMeta[]>('ai_list_conversations')

export const ai_get_conversation = (id: string) =>
    command<StoredConversation | null>('ai_get_conversation', {id})

export const ai_delete_conversation = (id: string) =>
    command<void>('ai_delete_conversation', {id})

export const ai_rename_conversation = (id: string, title: string) =>
    command<void>('ai_rename_conversation', {id, title})

// ── 编辑确认 ──────────────────────────────────────────────────────────────────

export interface EntryEditRequestEvent {
  request_id: string
  entry_id: string
  entry_title: string
  before_content: string
  after_content: string
}

export interface EntryUpdatedEvent {
  entry_id: string
}

export interface EntryDeleteRequestEvent {
    request_id: string
    entry_id: string
    entry_title: string
    entry_summary: string | null
}

export interface EntryDeletedEvent {
    entry_id: string
}

export interface CategoryDeleteRequestEvent {
    request_id: string
    category_id: string
    category_name: string
    mode: 'move_to_parent'
}

export interface CategoryCascadeDeleteRequestEvent {
    request_id: string
    category_id: string
    category_name: string
    entry_count: number
    subcategory_count: number
    step: 1 | 2
}

export const ENTRY_EDIT_REQUEST = 'entry:edit-request'
export const ENTRY_UPDATED = 'entry:updated'
export const ENTRY_DELETE_REQUEST = 'entry:delete-request'
export const ENTRY_DELETED = 'entry:deleted'
export const CATEGORY_DELETE_REQUEST = 'category:delete-request'
export const CATEGORY_CASCADE_DELETE_REQUEST = 'category:cascade-delete-request'

/** 统一确认回调，所有 AI 确认类型均复用此命令 */
export const confirm_entry_edit = (requestId: string, confirmed: boolean) =>
    command<void>('confirm_entry_edit', {requestId, confirmed})

// ── 工具管理 ──────────────────────────────────────────────────────────────────

export const ai_enable_tool = (name: string) =>
    command<boolean>('ai_enable_tool', {name})

export const ai_disable_tool = (name: string) =>
    command<boolean>('ai_disable_tool', {name})

export const ai_is_enabled = (name: string) =>
    command<boolean>('ai_is_enabled', {name})

export const ai_list_tools = () =>
    command<ToolStatus[]>('ai_list_tools')

// ── 编排上下文 ────────────────────────────────────────────────────────────────

export interface TaskContextPayload {
    projectId?: string | null
    taskType?: string | null
    attributes?: Record<string, string>
    flags?: Record<string, boolean>
}

export const ai_set_task_context = (sessionId: string, ctx: TaskContextPayload) =>
    command<void>('ai_set_task_context', {sessionId, ctx})
