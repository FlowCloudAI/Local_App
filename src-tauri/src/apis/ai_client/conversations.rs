use super::common::*;

/// 列出所有已保存对话的元信息，按 updated_at 降序
#[tauri::command]
pub async fn ai_list_conversations(
    paths: State<'_, PathsState>,
) -> Result<Vec<ConversationMeta>, String> {
    chat_store_list_conversations(paths.inner())
}

/// 返回完整对话（元信息 + 消息列表）
#[tauri::command]
pub async fn ai_get_conversation(
    paths: State<'_, PathsState>,
    id: String,
) -> Result<Option<StoredConversation>, String> {
    chat_store_get_conversation(paths.inner(), &id)
}

/// 导出指定对话到用户选择的文件路径。
#[tauri::command]
pub async fn ai_export_conversation(
    paths: State<'_, PathsState>,
    id: String,
    path: String,
    format: String,
) -> Result<(), String> {
    let conversation =
        chat_store_get_conversation(paths.inner(), &id)?.ok_or_else(|| format!("未找到会话：{}", id))?;

    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&conversation)
            .map_err(|e| format!("序列化会话 JSON 失败: {}", e))?,
        "markdown" | "md" => render_conversation_markdown(&conversation)?,
        other => return Err(format!("不支持的导出格式：{}", other)),
    };

    std::fs::write(&path, content)
        .map_err(|e| format!("写入导出文件失败 {:?}: {}", path, e))
}

/// 删除指定对话文件
#[tauri::command]
pub async fn ai_delete_conversation(
    paths: State<'_, PathsState>,
    id: String,
) -> Result<(), String> {
    chat_store_delete_conversation(paths.inner(), &id)
}

/// 修改对话标题
#[tauri::command]
pub async fn ai_rename_conversation(
    paths: State<'_, PathsState>,
    id: String,
    title: String,
) -> Result<(), String> {
    chat_store_rename_conversation(paths.inner(), &id, title)
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

/// 读取通用会话 UI 状态。顶置、归档等展示状态独立于对话历史文件保存。
#[tauri::command]
pub fn ai_get_conversation_ui_state(
    paths: State<'_, PathsState>,
) -> Result<HashMap<String, ConversationUiState>, String> {
    let path = conversation_ui_state_path(paths.inner())?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取会话 UI 状态失败 {:?}: {}", path, e))?;
    serde_json::from_str::<HashMap<String, ConversationUiState>>(&content)
        .map_err(|e| format!("解析会话 UI 状态失败 {:?}: {}", path, e))
}

/// 覆盖写入通用会话 UI 状态。
#[tauri::command]
pub fn ai_save_conversation_ui_state(
    paths: State<'_, PathsState>,
    state: HashMap<String, ConversationUiState>,
) -> Result<(), String> {
    let path = conversation_ui_state_path(paths.inner())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建会话 UI 状态目录失败 {:?}: {}", parent, e))?;
    }

    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("序列化会话 UI 状态失败: {}", e))?;
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("创建会话 UI 状态临时文件失败 {:?}: {}", temp_path, e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("写入会话 UI 状态失败 {:?}: {}", temp_path, e))?;
        file.flush()
            .map_err(|e| format!("刷新会话 UI 状态失败 {:?}: {}", temp_path, e))?;
    }
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("移除旧会话 UI 状态失败 {:?}: {}", path, e))?;
    }
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("保存会话 UI 状态失败 {:?}: {}", path, e))
}

fn render_conversation_markdown(conversation: &StoredConversation) -> Result<String, String> {
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", conversation.meta.title));
    output.push_str(&format!("- 会话 ID：{}\n", conversation.meta.id));
    output.push_str(&format!("- 插件：{}\n", conversation.meta.plugin_id));
    output.push_str(&format!("- 模型：{}\n", conversation.meta.model));
    output.push_str(&format!("- 创建时间：{}\n", conversation.meta.created_at));
    output.push_str(&format!("- 更新时间：{}\n\n", conversation.meta.updated_at));
    output.push_str("## 消息\n\n");

    for (index, message) in conversation.messages.iter().enumerate() {
        output.push_str(&format!(
            "### {}. {}\n\n",
            index + 1,
            message_role_label(&message.role)
        ));
        output.push_str(&format!("- 时间：{}\n", message.timestamp));
        if let Some(node_id) = message.node_id {
            output.push_str(&format!("- 节点：{}\n", node_id));
        }
        if let Some(turn_id) = message.turn_id {
            output.push_str(&format!("- 轮次：{}\n", turn_id));
        }
        output.push('\n');

        if let Some(content) = message.content.as_deref().filter(|content| !content.is_empty()) {
            output.push_str(content);
            output.push_str("\n\n");
        } else {
            output.push_str("（无正文）\n\n");
        }

        if let Some(reasoning) = message.reasoning.as_deref().filter(|reasoning| !reasoning.is_empty()) {
            output.push_str("#### 推理过程\n\n");
            output.push_str(reasoning);
            output.push_str("\n\n");
        }

        if let Some(tool_call_id) = message.tool_call_id.as_deref().filter(|tool_call_id| !tool_call_id.is_empty()) {
            output.push_str(&format!("#### 工具调用 ID\n\n{}\n\n", tool_call_id));
        }

        if let Some(tool_calls) = message.tool_calls.as_ref().filter(|tool_calls| !tool_calls.is_empty()) {
            let json = serde_json::to_string_pretty(tool_calls)
                .map_err(|e| format!("序列化工具调用失败: {}", e))?;
            output.push_str("#### 工具调用\n\n```json\n");
            output.push_str(&json);
            output.push_str("\n```\n\n");
        }
    }

    Ok(output)
}

fn message_role_label(role: &str) -> &str {
    match role {
        "user" => "用户",
        "assistant" => "助手",
        "system" => "系统",
        "tool" => "工具",
        _ => role,
    }
}
