use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

// ── 应用设置 ───────────────────────────────────────────────────────────────

/// 存储在 app_config_dir/settings.json，不含任何密钥
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppSettings {
    // ── 存储 ──────────────────────────────
    /// 媒体文件根目录（图片、音频）
    /// None = 使用默认 Documents/FlowCloudAI
    pub media_dir: Option<String>,
    /// 数据库文件目录
    /// None = Windows 使用 Documents/FlowCloudAI，其他平台使用 app_data_dir()
    pub db_path: Option<String>,
    /// 插件目录
    /// None = Windows 使用 Documents/FlowCloudAI/plugins，其他平台使用 app_data_dir()/plugins
    pub plugins_path: Option<String>,

    // ── 外观 ──────────────────────────────
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "zh-CN" | "en-US" | ...
    pub language: String,
    /// 编辑器字体大小（px）
    pub editor_font_size: u8,

    // ── 备份行为 ───────────────────────────
    /// 历史兼容字段：旧版本词条自动保存间隔。当前不再用于编辑器自动保存。
    pub auto_save_secs: u32,
    /// 自动备份间隔（秒），0 = 关闭
    pub auto_backup_secs: u32,
    /// CSV 自动备份目录。None = 数据库目录下的 backup
    pub backup_dir: Option<String>,
    /// 最多保留多少组自动备份
    pub max_backup_count: u32,
    /// 新建词条时的默认类型
    pub default_entry_type: Option<String>,

    // ── AI 默认配置 ────────────────────────
    pub llm: LlmDefaults,
    pub image: ImageDefaults,
    pub tts: TtsDefaults,

    // ── AI 工具配置 ────────────────────────
    /// 网络搜索引擎："bing" | "baidu" | "duckduckgo"
    pub search_engine: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            media_dir: None,
            db_path: None,
            plugins_path: None,
            theme: "system".to_string(),
            language: "zh-CN".to_string(),
            editor_font_size: 14,
            auto_save_secs: 0,
            auto_backup_secs: 300,
            backup_dir: None,
            max_backup_count: 20,
            default_entry_type: None,
            llm: LlmDefaults::default(),
            image: ImageDefaults::default(),
            tts: TtsDefaults::default(),
            search_engine: "bing".to_string(),
        }
    }
}

impl AppSettings {
    /// 从 settings.json 加载；文件不存在时返回默认值
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// 保存到 settings.json
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct LlmDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
    pub temperature: f64,
    pub max_tokens: i64,
    pub stream: bool,
    /// 是否显示思考过程（ReasoningDelta）
    pub show_reasoning: bool,
    /// 是否在上下文接近模型窗口时自动压缩历史
    pub auto_compact_enabled: bool,
    /// 自动压缩触发阈值，取值 0.0 - 1.0
    pub auto_compact_threshold_ratio: f64,
    /// 自动压缩后保留最近多少条可见消息
    pub auto_compact_recent_messages: u32,
    /// 压缩文本详细程度："brief" | "balanced" | "detailed"
    pub auto_compact_detail: String,
}

impl Default for LlmDefaults {
    fn default() -> Self {
        Self {
            plugin_id: None,
            default_model: None,
            temperature: 0.7,
            max_tokens: 2000,
            stream: true,
            show_reasoning: false,
            auto_compact_enabled: false,
            auto_compact_threshold_ratio: 0.75,
            auto_compact_recent_messages: 8,
            auto_compact_detail: "balanced".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ImageDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TtsDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
    pub voice_id: Option<String>,
    /// 合成后自动播放
    pub auto_play: bool,
}

impl Default for TtsDefaults {
    fn default() -> Self {
        Self {
            plugin_id: None,
            default_model: None,
            voice_id: None,
            auto_play: true,
        }
    }
}

// ── API 密钥存储 ───────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "cn.flowcloudai.www";

/// API 密钥存取（系统密钥链，不写入任何文件）
pub struct ApiKeyStore;

impl ApiKeyStore {
    /// 读取插件的 API Key；不存在时返回 None
    pub fn get(plugin_id: &str) -> Option<String> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .ok()
            .and_then(|e| e.get_password().ok())
    }

    /// 写入插件的 API Key
    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .map_err(|e| anyhow::anyhow!("keyring error: {}", e))?
            .set_password(api_key)
            .map_err(|e| anyhow::anyhow!("keyring set error: {}", e))
    }

    /// 删除插件的 API Key
    pub fn delete(plugin_id: &str) -> Result<()> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .map_err(|e| anyhow::anyhow!("keyring error: {}", e))?
            .delete_credential()
            .map_err(|e| anyhow::anyhow!("keyring delete error: {}", e))
    }
}
