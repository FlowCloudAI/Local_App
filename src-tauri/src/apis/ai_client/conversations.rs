use super::common::*;

/// 列出所有已保存对话的元信息，按 updated_at 降序
#[tauri::command]
pub async fn ai_list_conversations(
    ai_state: State<'_, AiState>,
) -> Result<Vec<ConversationMeta>, String> {
    let client = ai_state.client.lock().await;
    Ok(client.ai_list_conversations())
}

/// 返回完整对话（元信息 + 消息列表）
#[tauri::command]
pub async fn ai_get_conversation(
    ai_state: State<'_, AiState>,
    id: String,
) -> Result<Option<StoredConversation>, String> {
    let client = ai_state.client.lock().await;
    Ok(client.ai_get_conversation(&id))
}

/// 删除指定对话文件
#[tauri::command]
pub async fn ai_delete_conversation(
    ai_state: State<'_, AiState>,
    id: String,
) -> Result<(), String> {
    let client = ai_state.client.lock().await;
    client
        .ai_delete_conversation(&id)
        .map_err(|e| e.to_string())
}

/// 修改对话标题
#[tauri::command]
pub async fn ai_rename_conversation(
    ai_state: State<'_, AiState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let client = ai_state.client.lock().await;
    client
        .ai_rename_conversation(&id, title)
        .map_err(|e| e.to_string())
}

/// 读取特殊对话附加元数据。通用对话存储结构暂不包含这些字段，因此由应用侧单独持久化。
#[tauri::command]
pub fn ai_get_character_conversation_meta(
    paths: State<'_, PathsState>,
) -> Result<HashMap<String, CharacterConversationMeta>, String> {
    let path = character_conversation_meta_path(paths.inner())?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取特殊对话元数据失败 {:?}: {}", path, e))?;
    serde_json::from_str::<HashMap<String, CharacterConversationMeta>>(&content)
        .map_err(|e| format!("解析特殊对话元数据失败 {:?}: {}", path, e))
}

/// 覆盖写入特殊对话附加元数据。
#[tauri::command]
pub fn ai_save_character_conversation_meta(
    paths: State<'_, PathsState>,
    metadata: HashMap<String, CharacterConversationMeta>,
) -> Result<(), String> {
    let path = character_conversation_meta_path(paths.inner())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建特殊对话元数据目录失败 {:?}: {}", parent, e))?;
    }

    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("序列化特殊对话元数据失败: {}", e))?;
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("创建特殊对话元数据临时文件失败 {:?}: {}", temp_path, e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("写入特殊对话元数据失败 {:?}: {}", temp_path, e))?;
        file.flush()
            .map_err(|e| format!("刷新特殊对话元数据失败 {:?}: {}", temp_path, e))?;
    }
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("移除旧特殊对话元数据失败 {:?}: {}", path, e))?;
    }
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("保存特殊对话元数据失败 {:?}: {}", path, e))
}
