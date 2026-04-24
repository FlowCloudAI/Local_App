use super::common::*;

#[derive(Serialize)]
pub struct ImageData {
    pub url: Option<String>,
    pub size: Option<String>,
}

async fn make_image_session(ai_state: &AiState, plugin_id: &str) -> Result<ImageSession, String> {
    let api_key = ApiKeyStore::get(plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;

    let client = ai_state.client.lock().await;
    client
        .create_image_session(plugin_id, &api_key, None)
        .map_err(|e| format!("创建图像会话失败: {}", e))
}

/// 文生图
#[tauri::command]
pub async fn ai_text_to_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    size: Option<String>,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let mut request = ImageRequest::text_to_image(&model, &prompt);
    if let Some(size) = size.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        request = request.size(size);
    }
    let result = session.generate(&request).await.map_err(|e| {
        format!(
            "text_to_image 调用失败 [plugin={} model={}]: {}",
            plugin_id, model, e
        )
    })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

/// 图文编辑
#[tauri::command]
pub async fn ai_edit_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    image_url: String,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .edit_image(&model, &prompt, &image_url)
        .await
        .map_err(|e| {
            format!(
                "edit_image 调用失败 [plugin={} model={}]: {}",
                plugin_id, model, e
            )
        })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

/// 多图融合
#[tauri::command]
pub async fn ai_merge_images(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    image_urls: Vec<String>,
) -> Result<Vec<ImageData>, String> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .merge_images(&model, &prompt, image_urls)
        .await
        .map_err(|e| {
            format!(
                "merge_images 调用失败 [plugin={} model={}]: {}",
                plugin_id, model, e
            )
        })?;

    Ok(result
        .images
        .into_iter()
        .map(|img| ImageData {
            url: img.url,
            size: img.size,
        })
        .collect())
}

// ============ 语音合成 ============

/// 文本转语音；返回 base64 编码的音频字节和格式（如 "mp3"）
#[derive(Serialize)]
pub struct TtsResult {
    pub audio_base64: String,
    pub audio_url: Option<String>,
    pub format: String,
    pub duration_ms: Option<u64>,
}

#[tauri::command]
pub async fn ai_speak(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<TtsResult, String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;
    let client = ai_state.client.lock().await;
    let session = client
        .create_tts_session(&plugin_id, &api_key, None)
        .map_err(|e| e.to_string())?;
    drop(client);

    let result = session
        .speak(&model, &text, &voice_id)
        .await
        .map_err(|e| e.to_string())?;

    use base64::Engine;
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&result.audio);

    Ok(TtsResult {
        audio_base64,
        audio_url: result.url,
        format: result.format,
        duration_ms: result.duration_ms,
    })
}

/// 文本转语音并直接播放（通过系统音频设备，后台播放，立即返回）
#[tauri::command]
pub async fn ai_play_tts(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<(), String> {
    let api_key = ApiKeyStore::get(&plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id))?;
    let client = ai_state.client.lock().await;
    let session = client
        .create_tts_session(&plugin_id, &api_key, None)
        .map_err(|e| e.to_string())?;
    drop(client);

    let result = session
        .speak(&model, &text, &voice_id)
        .await
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        let source = if result.audio.is_empty() {
            match result.url {
                Some(url) if !url.is_empty() => AudioSource::Url(url),
                _ => AudioSource::Raw(result.audio),
            }
        } else {
            AudioSource::Raw(result.audio)
        };
        if let Err(e) = AudioDecoder::play_source(&source, Some(&result.format)).await {
            log::warn!("ai_play_tts 播放失败: {}", e);
        }
    });

    Ok(())
}
