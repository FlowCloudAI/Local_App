use super::common::*;

#[derive(Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub models: Vec<String>,
    pub default_model: Option<String>,
    pub supported_sizes: Vec<String>,
    pub supported_voices: Vec<String>,
}

fn load_string_array_from_fcplug(
    fcplug_path: &Path,
    keys: &[&str],
) -> Vec<String> {
    let file = match File::open(fcplug_path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return Vec::new(),
    };
    let mut manifest = match archive.by_name("manifest.json") {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let mut content = String::new();
    if manifest.read_to_string(&mut content).is_err() {
        return Vec::new();
    }
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(_) => return Vec::new(),
    };

    for key in keys {
        let candidates = [
            json.get(*key),
            json.get("ext").and_then(|ext| ext.get(*key)),
        ];
        for candidate in candidates.into_iter().flatten() {
            let Some(values) = candidate.as_array() else {
                continue;
            };
            let items = values
                .iter()
                .filter_map(|value| value.as_str().map(str::trim))
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if !items.is_empty() {
                return items;
            }
        }
    }

    Vec::new()
}

fn load_voice_array_from_fcplug(
    fcplug_path: &Path,
    keys: &[&str],
) -> Vec<String> {
    let file = match File::open(fcplug_path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return Vec::new(),
    };
    let mut manifest = match archive.by_name("manifest.json") {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let mut content = String::new();
    if manifest.read_to_string(&mut content).is_err() {
        return Vec::new();
    }
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(_) => return Vec::new(),
    };

    for key in keys {
        let candidates = [
            json.get(*key),
            json.get("ext").and_then(|ext| ext.get(*key)),
        ];
        for candidate in candidates.into_iter().flatten() {
            let Some(values) = candidate.as_array() else {
                continue;
            };
            let items = values
                .iter()
                .filter_map(|value| {
                    if let Some(text) = value.as_str() {
                        let trimmed = text.trim();
                        return (!trimmed.is_empty()).then(|| trimmed.to_string());
                    }
                    let object = value.as_object()?;
                    let id = object
                        .get("id")
                        .and_then(|raw| raw.as_str())
                        .map(str::trim)
                        .filter(|raw| !raw.is_empty());
                    if let Some(id) = id {
                        return Some(id.to_string());
                    }
                    object
                        .get("name")
                        .and_then(|raw| raw.as_str())
                        .map(str::trim)
                        .filter(|raw| !raw.is_empty())
                        .map(str::to_string)
                })
                .collect::<Vec<_>>();
            if !items.is_empty() {
                return items;
            }
        }
    }

    Vec::new()
}

fn load_supported_sizes_from_fcplug(fcplug_path: &Path) -> Vec<String> {
    load_string_array_from_fcplug(
        fcplug_path,
        &["supported-sizes", "supported_sizes"],
    )
}

fn load_supported_voices_from_fcplug(fcplug_path: &Path) -> Vec<String> {
    load_voice_array_from_fcplug(
        fcplug_path,
        &["voices", "supported-voices", "supported_voices", "voice_ids", "voice-ids"],
    )
}

/// 列出指定类型的可用插件；kind 为 "llm" / "image" / "tts"
#[tauri::command]
pub async fn ai_list_plugins(
    ai_state: State<'_, AiState>,
    kind: String,
) -> Result<Vec<PluginInfo>, String> {
    let plugin_kind = match kind.to_lowercase().as_str() {
        "llm" => PluginKind::LLM,
        "image" => PluginKind::Image,
        "tts" => PluginKind::TTS,
        other => return Err(format!("未知插件类型: {}", other)),
    };

    let client = ai_state.client.lock().await;
    let list = client
        .list_by_kind(plugin_kind)
        .into_iter()
        .map(|meta| {
            let supported_sizes = meta
                .as_image()
                .map(|info| info.supported_sizes.clone())
                .filter(|sizes| !sizes.is_empty())
                .unwrap_or_else(|| load_supported_sizes_from_fcplug(&meta.fcplug_path));
            let supported_voices = if kind == "tts" {
                load_supported_voices_from_fcplug(&meta.fcplug_path)
            } else {
                Vec::new()
            };

            PluginInfo {
                id: meta.id.clone(),
                name: meta.name.clone(),
                kind: kind.clone(),
                models: meta.models().to_vec(),
                default_model: meta.default_model().map(str::to_string),
                supported_sizes,
                supported_voices,
            }
        })
        .collect();

    Ok(list)
}
