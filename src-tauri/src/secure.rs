use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use base64::{Engine as _, engine::general_purpose};

// 加密后的存储结构
#[derive(Serialize, Deserialize)]
pub struct EncryptedStore {
    nonce: String,                    // base64编码的随机数
    ciphertext: String,               // base64编码的密文
}

// 明文存储结构（内存中）
#[derive(Serialize, Deserialize)]
pub struct SecureData {
    pub(crate) data: HashMap<String, String>,
}
impl SecureData {
    fn new() -> Self {
        Self {
            data: HashMap::new(),
        }
    }
}

// 安全存储器
pub struct SecureStore {
    encryption_key: Key<Aes256Gcm>,
    store_path: PathBuf,
}

impl SecureStore {
    // 从环境变量加载加密密钥
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        // 从环境变量获取密钥（必须是32字节）
        let key_hex = match std::env::var("STORAGE_KEY") {
            Ok(key) => key,
            Err(_) => {
                // 生产环境：自动生成并警告
                #[cfg(not(debug_assertions))]
                {
                    let key = generate_and_save_key(app)?;
                    eprintln!("警告：生产环境未设置STORAGE_KEY，已自动生成");
                    eprintln!("请妥善保管以下密钥，用于数据恢复：{}", key);
                    key
                }

                #[cfg(debug_assertions)]
                {
                    // 开发环境：用固定密钥
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string()
                }
            }
        };

        let key_bytes = hex::decode(key_hex)
            .map_err(|e| format!("密钥解码失败: {}", e))?;

        if key_bytes.len() != 32 {
            return Err("密钥必须是32字节（64位hex）".to_string());
        }

        let encryption_key = Key::<Aes256Gcm>::from_slice(&key_bytes);

        let store_path = app.path().app_data_dir()
            .map_err(|e| format!("获取数据目录失败: {}", e))?
            .join("secure_store.enc"); // .enc表示加密文件

        Ok(Self {
            encryption_key: *encryption_key,
            store_path,
        })
    }

    // 私有方法：加密并保存到文件
    pub(crate) fn save_encrypted(&self, data: &SecureData) -> Result<(), String> {
        // 序列化为JSON
        let plaintext = serde_json::to_string(data)
            .map_err(|e| format!("序列化失败: {}", e))?;

        // 生成随机nonce（96位）
        // ✅ 修正：使用OsRng生成随机数
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill(&mut nonce_bytes); // ✅ fill 方法

        // 加密
        let cipher = Aes256Gcm::new(&self.encryption_key);
        let ciphertext = cipher.encrypt(
            Nonce::from_slice(&nonce_bytes),
            plaintext.as_bytes()
        ).map_err(|e| format!("加密失败: {}", e))?;

        // 构建加密存储结构
        let encrypted = EncryptedStore {
            nonce: general_purpose::STANDARD.encode(&nonce_bytes), // ✅ 传引用
            ciphertext: general_purpose::STANDARD.encode(&ciphertext), // ✅ 传引用
        };

        // 写入文件
        let content = serde_json::to_string(&encrypted)
            .map_err(|e| format!("JSON编码失败: {}", e))?;

        fs::write(&self.store_path, content)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        Ok(())
    }

    // 私有方法：从文件读取并解密
    pub(crate) fn load_decrypted(&self) -> Result<SecureData, String> {
        // 文件不存在时返回空数据
        if !self.store_path.exists() {
            return Ok(SecureData::new());
        }

        // 读取加密文件
        let content = fs::read_to_string(&self.store_path)
            .map_err(|e| format!("读取文件失败: {}", e))?;

        let encrypted: EncryptedStore = serde_json::from_str(&content)
            .map_err(|e| format!("JSON解码失败: {}", e))?;

        // base64解码
        let nonce = general_purpose::STANDARD.decode(&encrypted.nonce)
            .map_err(|e| format!("nonce解码失败: {}", e))?;
        let ciphertext = general_purpose::STANDARD.decode(&encrypted.ciphertext)
            .map_err(|e| format!("密文解码失败: {}", e))?;

        // 解密
        let cipher = Aes256Gcm::new(&self.encryption_key);
        let nonce = Nonce::from_slice(&nonce);
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| format!("解密失败: {}", e))?;

        // 反序列化
        let data_str = String::from_utf8(plaintext)
            .map_err(|e| format!("UTF8转换失败: {}", e))?;

        serde_json::from_str(&data_str)
            .map_err(|e| format!("JSON反序列化失败: {}", e))
    }
}

// 生成并保存密钥到用户文档
fn generate_and_save_key(app: &tauri::AppHandle) -> Result<String, String> {
    use rand::RngCore;

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let key_hex = hex::encode(key);

    // 保存到用户文档
    let doc_path = app.path().document_dir()
        .map_err(|e| format!("获取文档目录失败: {}", e))?
        .join("flowcloudai_key.txt");

    fs::write(&doc_path, format!(
        "FlowCloudAI 加密密钥 (保存好，重装系统后需要)\n\n{}\n", key_hex
    )).map_err(|e| format!("保存密钥失败: {}", e))?;

    Ok(key_hex)
}

use std::sync::Mutex;

// 全局安全存储实例
pub struct SecureStoreState(pub Mutex<SecureStore>);