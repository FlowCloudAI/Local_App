use crate::template::{
    TemplateDocument, TemplateMeta, TemplateSaveResult, get_default_template_content,
    get_template_document, get_template_effective_path, get_template_local_root_dir,
    list_template_meta, save_template_content,
};

/// 返回模板目录所需的全部元数据。
#[tauri::command]
pub fn template_list() -> Result<Vec<TemplateMeta>, String> {
    Ok(list_template_meta())
}

/// 返回当前生效的模板内容和元数据。
#[tauri::command]
pub fn template_get(id: String) -> Result<TemplateDocument, String> {
    get_template_document(&id).map_err(|e| e.to_string())
}

/// 返回内置默认模板内容。
#[tauri::command]
pub fn template_get_default(id: String) -> Result<String, String> {
    get_default_template_content(&id).map_err(|e| e.to_string())
}

/// 返回用户自定义提示词模板目录。
#[tauri::command]
pub fn template_get_local_root_dir() -> Result<String, String> {
    get_template_local_root_dir().map_err(|e| e.to_string())
}

/// 返回当前提示词模板实际生效的本地文件路径。
#[tauri::command]
pub fn template_get_effective_path(id: String) -> Result<String, String> {
    get_template_effective_path(&id).map_err(|e| e.to_string())
}

/// 保存模板内容；保存前会先进行真实 Tera 校验。
#[tauri::command]
pub fn template_save(id: String, content: String) -> TemplateSaveResult {
    save_template_content(&id, content)
}
