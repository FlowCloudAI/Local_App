import { command } from './base'

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
  apiKey: string
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
  apiKey: string
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
  apiKey: string
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

export interface AiEventToolCall {
  session_id: string
  index: number
  name: string
}

export interface AiEventTurnEnd {
  session_id: string
  status: string
}

export interface AiEventError {
  session_id: string
  error: string
}

export const AI_EVENT_READY = 'ai:ready'
export const AI_EVENT_DELTA = 'ai:delta'
export const AI_EVENT_REASONING = 'ai:reasoning'
export const AI_EVENT_TOOL_CALL = 'ai:tool_call'
export const AI_EVENT_TURN_END = 'ai:turn_end'
export const AI_EVENT_ERROR = 'ai:error'

export const ai_list_plugins = (kind: AiPluginKind) =>
  command<PluginInfo[]>('ai_list_plugins', { kind })

export const ai_create_llm_session = ({
  sessionId,
  pluginId,
  apiKey,
  model,
  temperature,
  maxTokens,
}: AiCreateLlmSessionParams) =>
  command<void>('ai_create_llm_session', {
    sessionId,
    pluginId,
    apiKey,
    model,
    temperature,
    maxTokens,
  })

export const ai_send_message = (sessionId: string, message: string) =>
  command<void>('ai_send_message', { sessionId, message })

export const ai_close_session = (sessionId: string) =>
  command<void>('ai_close_session', { sessionId })

export const ai_text_to_image = ({ pluginId, apiKey, model, prompt }: AiImageParams) =>
  command<ImageData[]>('ai_text_to_image', { pluginId, apiKey, model, prompt })

export const ai_edit_image = ({
  pluginId,
  apiKey,
  model,
  prompt,
  imageUrl,
}: AiEditImageParams) =>
  command<ImageData[]>('ai_edit_image', {
    pluginId,
    apiKey,
    model,
    prompt,
    imageUrl,
  })

export const ai_merge_images = ({
  pluginId,
  apiKey,
  model,
  prompt,
  imageUrls,
}: AiMergeImagesParams) =>
  command<ImageData[]>('ai_merge_images', {
    pluginId,
    apiKey,
    model,
    prompt,
    imageUrls,
  })

export const ai_speak = ({ pluginId, apiKey, model, text, voiceId }: AiSpeakParams) =>
  command<TtsResult>('ai_speak', { pluginId, apiKey, model, text, voiceId })

export const ai_play_tts = ({ pluginId, apiKey, model, text, voiceId }: AiSpeakParams) =>
  command<void>('ai_play_tts', { pluginId, apiKey, model, text, voiceId })
