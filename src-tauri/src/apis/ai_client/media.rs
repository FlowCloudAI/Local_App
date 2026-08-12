use super::common::*;
use flowcloudai_client::ErrorCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// 全应用只保留最新的一次即时语音请求；取消后不支持恢复。
#[derive(Default)]
pub(crate) struct TtsPlaybackState {
    current: Mutex<Option<Arc<AtomicBool>>>,
}

impl TtsPlaybackState {
    fn lock(&self) -> MutexGuard<'_, Option<Arc<AtomicBool>>> {
        self.current
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn begin(&self) -> Arc<AtomicBool> {
        let mut current = self.lock();
        if let Some(previous) = current.replace(Arc::new(AtomicBool::new(false))) {
            previous.store(true, Ordering::Release);
        }
        Arc::clone(current.as_ref().expect("刚写入的语音令牌必须存在"))
    }

    fn cancel_current(&self) {
        if let Some(current) = self.lock().take() {
            current.store(true, Ordering::Release);
        }
    }

    fn finish(&self, token: &Arc<AtomicBool>) {
        let mut current = self.lock();
        if current
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, token))
        {
            current.take();
        }
    }
}

fn api_key_missing(plugin_id: &str) -> ApiError {
    ApiError::new(
        ErrorCode::AuthApiKeyMissing,
        format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id),
    )
    .with_kv("plugin_id", plugin_id.to_string())
}

#[derive(Serialize)]
pub struct ImageData {
    pub url: Option<String>,
    pub size: Option<String>,
}

async fn make_image_session(ai_state: &AiState, plugin_id: &str) -> Result<ImageSession, ApiError> {
    let api_key = ApiKeyStore::get(plugin_id).ok_or_else(|| api_key_missing(plugin_id))?;

    let client = ai_state.client.lock().await;
    client
        .create_image_session(plugin_id, &api_key, None)
        .map_err(ApiError::from)
}

/// 文生图
#[tauri::command]
pub async fn ai_text_to_image(
    ai_state: State<'_, AiState>,
    plugin_id: String,
    model: String,
    prompt: String,
    size: Option<String>,
) -> Result<Vec<ImageData>, ApiError> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let mut request = ImageRequest::text_to_image(&model, &prompt);
    if let Some(size) = size
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.size(size);
    }
    let result = session.generate(&request).await.map_err(|e| {
        ApiError::from(e)
            .with_kv("plugin_id", plugin_id.clone())
            .with_kv("model", model.clone())
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
) -> Result<Vec<ImageData>, ApiError> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .edit_image(&model, &prompt, &image_url)
        .await
        .map_err(|e| {
            ApiError::from(e)
                .with_kv("plugin_id", plugin_id.clone())
                .with_kv("model", model.clone())
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
) -> Result<Vec<ImageData>, ApiError> {
    let session = make_image_session(&ai_state, &plugin_id).await?;
    let result = session
        .merge_images(&model, &prompt, image_urls)
        .await
        .map_err(|e| {
            ApiError::from(e)
                .with_kv("plugin_id", plugin_id.clone())
                .with_kv("model", model.clone())
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
) -> Result<TtsResult, ApiError> {
    let api_key = ApiKeyStore::get(&plugin_id).ok_or_else(|| api_key_missing(&plugin_id))?;
    let client = ai_state.client.lock().await;
    let session = client.create_tts_session(&plugin_id, &api_key, None)?;
    drop(client);

    let result = session.speak(&model, &text, &voice_id).await?;

    use base64::Engine;
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&result.audio);

    Ok(TtsResult {
        audio_base64,
        audio_url: result.url,
        format: result.format,
        duration_ms: result.duration_ms,
    })
}

/// 文本转语音并直接播放；新请求会作废旧请求，命令等待实际播放结束。
#[tauri::command]
pub async fn ai_play_tts(
    ai_state: State<'_, AiState>,
    playback_state: State<'_, TtsPlaybackState>,
    plugin_id: String,
    model: String,
    text: String,
    voice_id: String,
) -> Result<(), ApiError> {
    let token = playback_state.begin();
    let outcome = async {
        let api_key = ApiKeyStore::get(&plugin_id).ok_or_else(|| api_key_missing(&plugin_id))?;
        let client = ai_state.client.lock().await;
        let session = client.create_tts_session(&plugin_id, &api_key, None)?;
        drop(client);

        let result = session.speak(&model, &text, &voice_id).await?;
        if token.load(Ordering::Acquire) {
            return Ok(());
        }
        let source = if result.audio.is_empty() {
            match result.url {
                Some(url) if !url.is_empty() => AudioSource::Url(url),
                _ => AudioSource::Raw(result.audio),
            }
        } else if result.format.eq_ignore_ascii_case("pcm") {
            let sample_rate = result.sample_rate.ok_or_else(|| {
                ApiError::new(ErrorCode::AudioDecodeFailed, "PCM 音频响应缺少采样率")
            })?;
            AudioSource::Pcm {
                data: result.audio,
                sample_rate,
                channels: result.channels.unwrap_or(1),
            }
        } else {
            AudioSource::Raw(result.audio)
        };
        AudioDecoder::play_source_cancelable(&source, Some(&result.format), Arc::clone(&token))
            .await
            .map_err(ApiError::from)
    }
    .await;

    let outcome = if token.load(Ordering::Acquire) {
        Ok(())
    } else {
        outcome
    };
    playback_state.finish(&token);
    outcome
}

/// 作废当前即时语音；取消是生命周期清理，不保留恢复位置。
#[tauri::command]
pub fn ai_cancel_tts(playback_state: State<'_, TtsPlaybackState>) -> Result<(), ApiError> {
    playback_state.cancel_current();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::TtsPlaybackState;
    use std::sync::atomic::Ordering;

    #[test]
    fn 新请求覆盖旧请求且旧任务不能清除新令牌() {
        let state = TtsPlaybackState::default();
        let first = state.begin();
        let second = state.begin();
        assert!(first.load(Ordering::Acquire));
        assert!(!second.load(Ordering::Acquire));

        state.finish(&first);
        assert!(state.lock().is_some());

        state.cancel_current();
        assert!(second.load(Ordering::Acquire));
        assert!(state.lock().is_none());
    }
}
