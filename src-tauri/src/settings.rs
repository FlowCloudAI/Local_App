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
    /// 颜色主题配置。None = 使用默认流云配色。
    pub theme_color_config: Option<serde_json::Value>,

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
    /// AI 搜索工具可使用的信源组
    pub search_sources: SearchSourceSettings,
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
            theme_color_config: None,
            auto_save_secs: 0,
            auto_backup_secs: 300,
            backup_dir: None,
            max_backup_count: 20,
            default_entry_type: None,
            llm: LlmDefaults::default(),
            image: ImageDefaults::default(),
            tts: TtsDefaults::default(),
            search_engine: "bing".to_string(),
            search_sources: SearchSourceSettings::default(),
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
    pub top_p: f64,
    /// 重复惩罚，0 = 不惩罚
    pub frequency_penalty: f64,
    /// 存在惩罚，0 = 不惩罚
    pub presence_penalty: f64,
    pub max_tokens: i64,
    pub stream: bool,
    /// 是否显示思考过程（ReasoningDelta）
    pub show_reasoning: bool,
    /// 仅追加到通用 AI 对话默认系统提示词之后
    pub app_sense_custom_prompt: String,
    /// 是否允许在 AI 面板中选择作家模式。作家模式会跳过常规写入确认。
    pub writer_mode_enabled: bool,
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
            top_p: 0.9,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            max_tokens: 8192,
            stream: true,
            show_reasoning: false,
            app_sense_custom_prompt: String::new(),
            writer_mode_enabled: false,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SearchSourceSettings {
    /// 维基媒体项目：维基百科、维基词典、维基文库、维基语录、维基导游
    pub wikimedia: bool,
    /// 技术类 wiki
    pub technical_wiki: bool,
    /// 游戏类 wiki
    pub game_wiki: bool,
    /// 作品设定类 wiki
    pub fandom_wiki: bool,
    /// 电竞资料 wiki
    pub esports_wiki: bool,
    /// 通用网页搜索兜底
    pub web: bool,
}

impl Default for SearchSourceSettings {
    fn default() -> Self {
        Self {
            wikimedia: true,
            technical_wiki: true,
            game_wiki: true,
            fandom_wiki: true,
            esports_wiki: true,
            web: true,
        }
    }
}

// ── API 密钥存储 ───────────────────────────────────────────────────────────

// 桌面（Windows / Linux / macOS）与 iOS：系统密钥链（keyring crate），不落任何文件。
// Android：keyring 无可用后端会退回内存 mock（set 写进随即丢弃的临时对象、get 永远空
// → 表现为"保存成功但切页就没了"），故改存应用私有目录下的明文文件 api_keys.json。
// 该文件在应用沙箱内，未 root 的设备其它应用读不到；存储目录在启动时由
// `init_api_key_storage` 注入（见 lib.rs setup）。如需更强安全可后续接 Android Keystore 加密。

/// API 密钥存取。
pub struct ApiKeyStore;

#[cfg(not(target_os = "android"))]
const KEYRING_SERVICE: &str = "cn.flowcloudai.www";

#[cfg(not(target_os = "android"))]
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

/// 基于应用私有目录明文文件的 API Key 存储（Android 实际使用；目录显式传入，便于宿主侧测试）。
/// 每次操作都直接读/写文件、无内存缓存，因此重新挂载页面重新查询能拿到已保存值。
#[cfg(any(target_os = "android", test))]
mod file_key_store {
    use anyhow::Result;
    use std::collections::BTreeMap;
    use std::path::Path;

    const FILE_NAME: &str = "api_keys.json";

    fn read_all(dir: &Path) -> BTreeMap<String, String> {
        std::fs::read(dir.join(FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write_all(dir: &Path, map: &BTreeMap<String, String>) -> Result<()> {
        std::fs::create_dir_all(dir).map_err(|e| anyhow::anyhow!("创建密钥目录失败: {}", e))?;
        let json =
            serde_json::to_vec_pretty(map).map_err(|e| anyhow::anyhow!("序列化密钥失败: {}", e))?;
        std::fs::write(dir.join(FILE_NAME), json)
            .map_err(|e| anyhow::anyhow!("写入密钥文件失败: {}", e))
    }

    pub fn get(dir: &Path, plugin_id: &str) -> Option<String> {
        read_all(dir).get(plugin_id).cloned()
    }

    pub fn set(dir: &Path, plugin_id: &str, api_key: &str) -> Result<()> {
        let mut map = read_all(dir);
        map.insert(plugin_id.to_string(), api_key.to_string());
        write_all(dir, &map)
    }

    pub fn delete(dir: &Path, plugin_id: &str) -> Result<()> {
        let mut map = read_all(dir);
        map.remove(plugin_id);
        write_all(dir, &map)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn roundtrip_persists_through_file() {
            let dir = std::env::temp_dir().join(format!("fc_apikey_test_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);

            // 复现 bug 场景：保存后"重新读取"（每次都读文件，模拟切页重挂载）应拿到值。
            assert_eq!(get(&dir, "deepseek-llm"), None);
            set(&dir, "deepseek-llm", "sk-abc").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), Some("sk-abc".to_string()));

            // 覆盖 + 多插件互不影响
            set(&dir, "deepseek-llm", "sk-xyz").unwrap();
            set(&dir, "qwen-llm", "sk-q").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), Some("sk-xyz".to_string()));
            assert_eq!(get(&dir, "qwen-llm"), Some("sk-q".to_string()));

            // 删除只影响目标
            delete(&dir, "deepseek-llm").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), None);
            assert_eq!(get(&dir, "qwen-llm"), Some("sk-q".to_string()));

            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(target_os = "android")]
mod android_key_store {
    use anyhow::Result;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    static STORAGE_DIR: OnceLock<PathBuf> = OnceLock::new();
    /// 串行化文件读改写，避免并发覆盖。
    static FILE_LOCK: Mutex<()> = Mutex::new(());

    pub fn init_storage_dir(dir: PathBuf) {
        let _ = STORAGE_DIR.set(dir);
    }

    fn dir() -> Result<&'static PathBuf> {
        STORAGE_DIR
            .get()
            .ok_or_else(|| anyhow::anyhow!("API Key 存储目录未初始化"))
    }

    pub fn get(plugin_id: &str) -> Option<String> {
        let _guard = FILE_LOCK.lock().ok()?;
        super::file_key_store::get(dir().ok()?, plugin_id)
    }

    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        let _guard = FILE_LOCK
            .lock()
            .map_err(|_| anyhow::anyhow!("密钥文件锁异常"))?;
        super::file_key_store::set(dir()?, plugin_id, api_key)
    }

    pub fn delete(plugin_id: &str) -> Result<()> {
        let _guard = FILE_LOCK
            .lock()
            .map_err(|_| anyhow::anyhow!("密钥文件锁异常"))?;
        super::file_key_store::delete(dir()?, plugin_id)
    }
}

#[cfg(target_os = "android")]
impl ApiKeyStore {
    /// 读取插件的 API Key；不存在时返回 None
    pub fn get(plugin_id: &str) -> Option<String> {
        android_key_store::get(plugin_id)
    }

    /// 写入插件的 API Key
    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        android_key_store::set(plugin_id, api_key)
    }

    /// 删除插件的 API Key
    pub fn delete(plugin_id: &str) -> Result<()> {
        android_key_store::delete(plugin_id)
    }
}

/// 注入 Android 的 API Key 明文存储目录（应用私有目录）。仅 Android 需要；
/// 桌面 / iOS 走系统密钥链，不调用。
#[cfg(target_os = "android")]
pub fn init_api_key_storage(dir: std::path::PathBuf) {
    android_key_store::init_storage_dir(dir);
}
