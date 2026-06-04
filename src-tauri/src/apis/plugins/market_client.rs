use super::common::*;
use futures::FutureExt;
use std::panic::AssertUnwindSafe;
use std::time::{Duration, Instant};

// ============ 官方市场 HTTP 客户端函数 ============

const MARKET_LIST_TIMEOUT_SECS: u64 = 12;

fn market_plugin_count(value: &serde_json::Value) -> Option<usize> {
    value.as_array().map(Vec::len).or_else(|| {
        value
            .get("plugins")
            .and_then(|plugins| plugins.as_array())
            .map(Vec::len)
    })
}

fn panic_payload_to_string(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "未知 panic 载荷".to_string()
}

fn market_panic_error(
    stage: &str,
    started_at: Instant,
    panic: Box<dyn std::any::Any + Send>,
) -> anyhow::Error {
    let message = panic_payload_to_string(panic.as_ref());
    let elapsed_ms = started_at.elapsed().as_millis();

    #[cfg(target_os = "android")]
    log::error!(
        "[plugin_market_http] 插件库列表{}时发生 panic elapsed_ms={} panic={} hint=检查 rustls-platform-verifier Android 初始化",
        stage,
        elapsed_ms,
        message
    );

    #[cfg(not(target_os = "android"))]
    log::error!(
        "[plugin_market_http] 插件库列表{}时发生 panic elapsed_ms={} panic={}",
        stage,
        elapsed_ms,
        message
    );

    anyhow::anyhow!("插件库列表请求内部错误: {}", message)
}

pub(super) async fn market_list(client: &reqwest::Client) -> anyhow::Result<serde_json::Value> {
    let started_at = Instant::now();
    log::info!(
        "[plugin_market_http] 开始请求插件库列表 url={MARKET_BASE} timeout_secs={}",
        MARKET_LIST_TIMEOUT_SECS
    );

    let request = client
        .get(MARKET_BASE)
        .timeout(Duration::from_secs(MARKET_LIST_TIMEOUT_SECS))
        .send();

    let response = match tokio::time::timeout(
        Duration::from_secs(MARKET_LIST_TIMEOUT_SECS),
        AssertUnwindSafe(request).catch_unwind(),
    )
    .await
    {
        Ok(Ok(Ok(response))) => response,
        Ok(Ok(Err(error))) => {
            log::error!(
                "[plugin_market_http] 插件库列表请求发送失败 timeout={} elapsed_ms={} error={}",
                error.is_timeout(),
                started_at.elapsed().as_millis(),
                error
            );
            return Err(error.into());
        }
        Ok(Err(panic)) => {
            return Err(market_panic_error("发送请求", started_at, panic));
        }
        Err(_) => {
            log::error!(
                "[plugin_market_http] 插件库列表请求硬超时 timeout_secs={} elapsed_ms={}",
                MARKET_LIST_TIMEOUT_SECS,
                started_at.elapsed().as_millis()
            );
            return Err(anyhow::anyhow!(
                "插件库列表请求超时（{} 秒）",
                MARKET_LIST_TIMEOUT_SECS
            ));
        }
    };

    let status = response.status();
    let content_length = response.content_length();
    log::info!(
        "[plugin_market_http] 插件库列表收到响应 status={} content_length={:?} elapsed_ms={}",
        status,
        content_length,
        started_at.elapsed().as_millis()
    );

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let body_preview = body.chars().take(500).collect::<String>();
        log::error!(
            "[plugin_market_http] 插件库列表响应状态异常 status={} body_preview={} elapsed_ms={}",
            status,
            body_preview,
            started_at.elapsed().as_millis()
        );
        let message = if body.trim().is_empty() {
            format!("HTTP {}", status)
        } else {
            format!("HTTP {}: {}", status, body)
        };
        return Err(anyhow::anyhow!(message));
    }

    let json_request = response.json::<serde_json::Value>();
    let value = match tokio::time::timeout(
        Duration::from_secs(MARKET_LIST_TIMEOUT_SECS),
        AssertUnwindSafe(json_request).catch_unwind(),
    )
    .await
    {
        Ok(Ok(Ok(value))) => value,
        Ok(Ok(Err(error))) => {
            log::error!(
                "[plugin_market_http] 插件库列表 JSON 解析失败 elapsed_ms={} error={}",
                started_at.elapsed().as_millis(),
                error
            );
            return Err(error.into());
        }
        Ok(Err(panic)) => {
            return Err(market_panic_error("解析响应", started_at, panic));
        }
        Err(_) => {
            log::error!(
                "[plugin_market_http] 插件库列表 JSON 解析硬超时 timeout_secs={} elapsed_ms={}",
                MARKET_LIST_TIMEOUT_SECS,
                started_at.elapsed().as_millis()
            );
            return Err(anyhow::anyhow!(
                "插件库列表响应解析超时（{} 秒）",
                MARKET_LIST_TIMEOUT_SECS
            ));
        }
    };

    log::info!(
        "[plugin_market_http] 插件库列表解析完成 count={:?} elapsed_ms={}",
        market_plugin_count(&value),
        started_at.elapsed().as_millis()
    );
    Ok(value)
}

pub(super) async fn market_upload(
    client: &reqwest::Client,
    path: &Path,
    password: &str,
) -> anyhow::Result<serde_json::Value> {
    let bytes = fs::read(path).await?;
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("无效文件名"))?
        .to_string_lossy()
        .to_string();
    let part = multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str("application/octet-stream")?;
    let form = multipart::Form::new()
        .text("password", password.to_string())
        .part("file", part);
    let res = client.post(MARKET_BASE).multipart(form).send().await?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        let msg = if body.trim().is_empty() {
            format!("HTTP {}", status)
        } else {
            format!("HTTP {}: {}", status, body)
        };
        return Err(anyhow::anyhow!(msg));
    }

    Ok(res.json().await?)
}

pub(super) async fn market_update(
    client: &reqwest::Client,
    id: &str,
    path: &Path,
) -> anyhow::Result<serde_json::Value> {
    let bytes = fs::read(path).await?;
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("无效文件名"))?
        .to_string_lossy()
        .to_string();
    let part = multipart::Part::bytes(bytes).file_name(filename);
    let form = multipart::Form::new().part("file", part);
    let res = client
        .put(format!("{}/{}", MARKET_BASE, id))
        .multipart(form)
        .send()
        .await?
        .json()
        .await?;
    Ok(res)
}

pub(super) async fn market_delete(client: &reqwest::Client, id: &str) -> anyhow::Result<()> {
    client
        .delete(format!("{}/{}", MARKET_BASE, id))
        .send()
        .await?;
    Ok(())
}

pub(super) async fn market_download(
    client: &reqwest::Client,
    id: &str,
    dest: &Path,
) -> anyhow::Result<()> {
    let bytes = client
        .get(format!("{}/{}/download", MARKET_BASE, id))
        .send()
        .await?
        .bytes()
        .await?;
    fs::write(dest, bytes).await?;
    Ok(())
}
