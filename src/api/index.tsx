import {invoke} from "@tauri-apps/api/core";

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const log_message = (level:LogLevel, message:string) =>
    invoke<void>('log_message', {level, message});

export const showWindow = () => invoke<void>("show_main_window");

// ── 插件相关 ──────────────────────────────────────────────────────────────────

export interface PluginInfo {
  id: string
  name: string
  models: string[]
}

export const ai_list_plugins = (kind: 'llm' | 'image' | 'tts') => 
  invoke<PluginInfo[]>('ai_list_plugins', { kind })

// ── 设置相关 ──────────────────────────────────────────────────────────────────

export interface LlmDefaults {
  plugin_id: string | null
  default_model: string | null
  temperature: number
  max_tokens: number
  stream: boolean
  show_reasoning: boolean
}

export interface ImageDefaults {
  plugin_id: string | null
  default_model: string | null
}

export interface TtsDefaults {
  plugin_id: string | null
  default_model: string | null
  voice_id: string | null
  auto_play: boolean
}

export interface AppSettings {
  media_dir: string | null
  theme: string
  language: string
  editor_font_size: number
  auto_save_secs: number
  default_entry_type: string | null
  llm: LlmDefaults
  image: ImageDefaults
  tts: TtsDefaults
}

export const setting_get_settings = () => invoke<AppSettings>('setting_get_settings')
export const setting_update_settings = (newSettings: AppSettings) => 
  invoke<void>('setting_update_settings', { newSettings })
export const setting_get_media_dir = () => invoke<string>('setting_get_media_dir')

// ── API Key 管理 ──────────────────────────────────────────────────────────────

export const setting_set_api_key = (pluginId: string, apiKey: string) =>
  invoke<void>('setting_set_api_key', { pluginId, apiKey })

export const setting_has_api_key = (pluginId: string) =>
  invoke<boolean>('setting_has_api_key', { pluginId })

export const setting_delete_api_key = (pluginId: string) =>
  invoke<void>('setting_delete_api_key', { pluginId })