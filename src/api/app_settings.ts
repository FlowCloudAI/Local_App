import { command } from './base'

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
  db_path: string | null
  plugins_path: string | null
  theme: string
  language: string
  editor_font_size: number
  auto_save_secs: number
  default_entry_type: string | null
  llm: LlmDefaults
  image: ImageDefaults
  tts: TtsDefaults
}

export interface DefaultPaths {
  db_path: string
  plugins_path: string
}

export const setting_get_settings = () => command<AppSettings>('setting_get_settings')

export const setting_update_settings = (newSettings: AppSettings) =>
  command<void>('setting_update_settings', { newSettings })

export const setting_get_media_dir = () => command<string>('setting_get_media_dir')

export const setting_get_default_paths = () =>
  command<DefaultPaths>('setting_get_default_paths')

export const setting_set_api_key = (pluginId: string, apiKey: string) =>
  command<void>('setting_set_api_key', { pluginId, apiKey })

export const setting_has_api_key = (pluginId: string) =>
  command<boolean>('setting_has_api_key', { pluginId })

export const setting_delete_api_key = (pluginId: string) =>
  command<void>('setting_delete_api_key', { pluginId })
