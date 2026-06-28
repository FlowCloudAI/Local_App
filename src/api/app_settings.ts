import {command} from './base'
import type {PluginInfo} from './ai_client'

export interface LlmDefaults {
  plugin_id: string | null
  default_model: string | null
  temperature: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  max_tokens: number
  stream: boolean
  show_reasoning: boolean
  app_sense_custom_prompt: string
  writer_mode_enabled: boolean
  auto_compact_enabled: boolean
  auto_compact_threshold_ratio: number
  auto_compact_recent_messages: number
  auto_compact_detail: LlmCompactDetail
}

export type LlmCompactDetail = 'brief' | 'balanced' | 'detailed'

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

export interface SearchSourceSettings {
  wikimedia: boolean
  technical_wiki: boolean
  game_wiki: boolean
  fandom_wiki: boolean
  esports_wiki: boolean
  web: boolean
}

export interface ThemeColorCustomValues {
  primarySeed: string
  primarySurfaceChroma: number
  neutralSeed: string
  neutralChroma: number
  neutralVariantChroma: number
}

export interface ThemeColorTokenValue {
  hex: string
  css: string
}

export interface ThemeColorTokenPair {
  light: ThemeColorTokenValue
  dark: ThemeColorTokenValue
}

export interface ThemeColorConfig {
  version: 3
  recipeId: string
  customValues: ThemeColorCustomValues
  tokenColors: Record<string, ThemeColorTokenPair>
}

export interface AppSettings {
  media_dir: string | null
  db_path: string | null
  plugins_path: string | null
  theme: string
  language: string
  editor_font_size: number
  theme_color_config: ThemeColorConfig | null
  shell_acrylic_enabled: boolean
  auto_save_secs: number
  auto_backup_secs: number
  backup_dir: string | null
  max_backup_count: number
  default_entry_type: string | null
  llm: LlmDefaults
  image: ImageDefaults
  tts: TtsDefaults
  search_engine: string
  search_sources: SearchSourceSettings
}

export interface DefaultPaths {
  db_path: string
  plugins_path: string
  backup_path: string
}

export interface SettingsBootstrap {
    settings: AppSettings
    llmPlugins: PluginInfo[]
    imagePlugins: PluginInfo[]
    ttsPlugins: PluginInfo[]
    apiKeyStatus: Record<string, boolean>
    mediaDir: string
    defaultPaths: DefaultPaths
}

export type BackendStartupPhase = 'initializing' | 'ready' | 'failed'

export interface BackendStartupStatus {
    phase: BackendStartupPhase
    message: string | null
}

export const setting_get_settings = () => command<AppSettings>('setting_get_settings')

export const setting_get_settings_bootstrap = () =>
    command<SettingsBootstrap>('setting_get_settings_bootstrap')

export const setting_update_settings = (newSettings: AppSettings) =>
  command<string>('setting_update_settings', { newSettings })

export const setting_get_media_dir = () => command<string>('setting_get_media_dir')

export const setting_get_default_paths = () =>
  command<DefaultPaths>('setting_get_default_paths')

export const setting_open_backup_dir = (path: string) =>
  command<void>('setting_open_backup_dir', { path })

export const setting_export_theme_config = (path: string, content: string) =>
  command<void>('setting_export_theme_config', { path, content })

export const setting_is_backend_ready = () =>
    command<boolean>('setting_is_backend_ready')

export const setting_get_backend_status = () =>
    command<BackendStartupStatus>('setting_get_backend_status')

export const setting_set_api_key = (pluginId: string, apiKey: string) =>
  command<void>('setting_set_api_key', { pluginId, apiKey })

export const setting_has_api_key = (pluginId: string) =>
  command<boolean>('setting_has_api_key', { pluginId })

export const setting_delete_api_key = (pluginId: string) =>
  command<void>('setting_delete_api_key', { pluginId })
