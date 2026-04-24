use super::common::*;

// ============ 官方市场 HTTP 客户端函数 ============

pub(super) async fn market_list(client: &reqwest::Client) -> anyhow::Result<serde_json::Value> {
    let res = client.get(MARKET_BASE).send().await?.json().await?;
    Ok(res)
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
