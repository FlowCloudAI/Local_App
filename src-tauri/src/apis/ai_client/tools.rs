use super::common::*;

/// 启用指定工具
#[tauri::command]
pub async fn ai_enable_tool(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let mut client = ai_state.client.lock().await;
    let registry = client.tool_registry_mut().map_err(|e| e.to_string())?;
    Ok(registry.enable_tool(&name))
}

/// 禁用指定工具
#[tauri::command]
pub async fn ai_disable_tool(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let mut client = ai_state.client.lock().await;
    let registry = client.tool_registry_mut().map_err(|e| e.to_string())?;
    Ok(registry.disable_tool(&name))
}

/// 查询工具是否启用
#[tauri::command]
pub async fn ai_is_enabled(ai_state: State<'_, AiState>, name: String) -> Result<bool, String> {
    let client = ai_state.client.lock().await;
    Ok(client.tool_registry().is_enabled(&name))
}

/// 列出所有已注册工具的状态（名称 + 是否启用）
#[derive(Serialize)]
pub struct ToolStatus {
    pub name: String,
    pub enabled: bool,
}

#[tauri::command]
pub async fn ai_list_tools(ai_state: State<'_, AiState>) -> Result<Vec<ToolStatus>, String> {
    let client = ai_state.client.lock().await;
    let registry = client.tool_registry();
    let list = registry
        .tool_names()
        .into_iter()
        .map(|name| ToolStatus {
            name: name.to_string(),
            enabled: registry.is_enabled(&name),
        })
        .collect();
    Ok(list)
}
