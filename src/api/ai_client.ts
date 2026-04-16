import {command} from './base'

export type AiPluginKind = 'llm' | 'image' | 'tts'

export interface PluginInfo {
  id: string
  name: string
  kind: string
  models: string[]
  default_model: string | null
}

export interface AiCreateLlmSessionParams {
  sessionId: string
  pluginId: string
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
}

export interface AiEditImageParams extends AiImageParams {
  imageUrl: string
}

export interface AiMergeImagesParams extends AiImageParams {
  imageUrls: string[]
}

export interface TtsResult {
  audio_base64: string
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
}

export interface AiEventDelta {
  session_id: string
  text: string
}

export interface AiEventReasoning {
  session_id: string
  text: string
}

export interface AiEventToolCall {
  session_id: string
  index: number
  name: string
}

export interface AiEventTurnEnd {
  session_id: string
  status: string
  node_id: number
}

export interface AiEventTurnBegin {
  session_id: string
  turn_id: number
  node_id: number
}

export interface AiEventToolResult {
  session_id: string
  index: number
  output: string
  is_error: boolean
}

export interface AiEventError {
  session_id: string
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
}: AiCreateLlmSessionParams) =>
  command<void>('ai_create_llm_session', {
    sessionId,
    pluginId,
    model,
    temperature,
    maxTokens,
  })

export const ai_send_message = (sessionId: string, message: string) =>
  command<void>('ai_send_message', { sessionId, message })

export const ai_close_session = (sessionId: string) =>
  command<void>('ai_close_session', { sessionId })

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

export const ai_text_to_image = ({pluginId, model, prompt}: AiImageParams) =>
    command<ImageData[]>('ai_text_to_image', {pluginId, model, prompt})

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
  role: string
  content: string | null
  reasoning: string | null
  timestamp: string
}

export interface StoredConversation extends ConversationMeta {
  messages: StoredMessage[]
}

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

export const ENTRY_EDIT_REQUEST = 'entry:edit-request'

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
