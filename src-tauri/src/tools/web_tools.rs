use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};
use scraper::{Html, Selector};

/// 注册网络工具（搜索和URL获取）
pub fn register_web_tools(registry: &mut ToolRegistry) -> Result<()> {
    // ⑭ web_search - 搜索引擎搜索
    registry.register_async::<WorldflowToolState, _>(
        "web_search",
        "使用搜索引擎搜索网络信息，返回 JSON 格式结果列表（包含 query、count、results）",
        vec![
            ToolFunctionArg::new("query", "string")
                .required(true)
                .desc("搜索关键词"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回结果数量，默认8")
                .min(1)
                .max(20)
                .default(8),
        ],
        |_state, args| {
            let http_client = _state.http_client.clone();
            let search_engine = _state.search_engine.clone();
            Box::pin(async move {
                let query = arg_str(args, "query")?;
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
                let engine = search_engine.lock().await.clone();

                let results = do_web_search(&http_client, &engine, query, limit)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                let output = serde_json::json!({
                    "query": query,
                    "count": results.len(),
                    "results": results.iter().enumerate().map(|(i, r)| {
                        serde_json::json!({
                            "index": i + 1,
                            "title": r.title,
                            "url": r.url,
                            "snippet": r.snippet,
                        })
                    }).collect::<Vec<_>>()
                });

                Ok(output.to_string())
            })
        },
    );

    // ⑮ open_url - 获取网页内容
    registry.register_async::<WorldflowToolState, _>(
        "open_url",
        "获取指定URL的网页原始内容",
        vec![
            ToolFunctionArg::new("url", "string")
                .required(true)
                .desc("要访问的URL"),
        ],
        |_state, args| {
            let http_client = _state.http_client.clone();
            Box::pin(async move {
                let url = arg_str(args, "url")?;

                let response = http_client
                    .get(url)
                    .send()
                    .await
                    .map_err(|e| anyhow::anyhow!("请求失败: {}", e))?;

                let status = response.status();
                let text = response
                    .text()
                    .await
                    .map_err(|e| anyhow::anyhow!("读取响应失败: {}", e))?;

                const MAX_LEN: usize = 20000;
                let body = if text.len() > MAX_LEN {
                    format!("{}...(内容过长已截断)", &text[..MAX_LEN])
                } else {
                    text
                };

                Ok(format!("HTTP {}\n\n{}", status, body))
            })
        },
    );

    Ok(())
}

// ── 搜索辅助 ──────────────────────────────────────────────────────────────────

struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

async fn do_web_search(
    client: &reqwest::Client,
    engine: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let encoded = urlencoding::encode(query);

    // Bing 优先；若失败或为空则 fallback 到 DuckDuckGo
    if engine != "baidu" {
        match search_bing(client, &encoded, limit).await {
            Ok(results) if !results.is_empty() => return Ok(results),
            Ok(_) => log::warn!("[web_search] bing returned empty, fallback to duckduckgo"),
            Err(e) => log::warn!("[web_search] bing failed: {}, fallback to duckduckgo", e),
        }
        return search_duckduckgo(client, &encoded, limit).await;
    }

    search_baidu(client, &encoded, limit).await
}

async fn search_bing(
    client: &reqwest::Client,
    encoded_query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let url = format!(
        "https://www.bing.com/search?q={}&setlang=zh-hans",
        encoded_query
    );
    log::info!("[web_search] bing url={}", url);

    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let status = resp.status();
    let html = resp.text().await?;
    log::info!(
        "[web_search] bing status={} html_len={}",
        status,
        html.len()
    );
    if !status.is_success() {
        return Err(anyhow::anyhow!("bing returned {}", status));
    }

    let document = Html::parse_document(&html);
    // Bing 结果常见容器：li.b_algo；若未命中尝试更通用的 .b_algo
    let item_sel =
        Selector::parse("li.b_algo").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let title_sel =
        Selector::parse("h2 a").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let snippet_sel =
        Selector::parse(".b_caption p").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;

    let mut results = Vec::new();
    for item in document.select(&item_sel).take(limit) {
        let Some(title_el) = item.select(&title_sel).next() else {
            continue;
        };
        let title = title_el.text().collect::<String>().trim().to_string();
        let url = title_el.attr("href").unwrap_or("").to_string();
        if url.is_empty() {
            continue;
        }
        let snippet = item
            .select(&snippet_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        results.push(SearchResult {
            title,
            url,
            snippet,
        });
    }
    log::info!("[web_search] bing parsed_results={}", results.len());
    Ok(results)
}

async fn search_baidu(
    client: &reqwest::Client,
    encoded_query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let url = format!(
        "https://www.baidu.com/s?wd={}&ie=utf-8&oe=utf-8",
        encoded_query
    );
    log::info!("[web_search] baidu url={}", url);

    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let status = resp.status();
    let html = resp.text().await?;
    log::info!(
        "[web_search] baidu status={} html_len={}",
        status,
        html.len()
    );
    if !status.is_success() {
        return Err(anyhow::anyhow!("baidu returned {}", status));
    }

    let document = Html::parse_document(&html);
    let item_sel =
        Selector::parse("div.result").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let title_sel =
        Selector::parse("h3 a").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let snippet_sel =
        Selector::parse(".c-abstract").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;

    let mut results = Vec::new();
    for item in document.select(&item_sel).take(limit) {
        let Some(title_el) = item.select(&title_sel).next() else {
            continue;
        };
        let title = title_el.text().collect::<String>().trim().to_string();
        // Baidu 链接是跳转链接，open_url 时 reqwest 会自动跟随重定向
        let url = title_el.attr("href").unwrap_or("").to_string();
        if url.is_empty() {
            continue;
        }
        let snippet = item
            .select(&snippet_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        results.push(SearchResult {
            title,
            url,
            snippet,
        });
    }
    log::info!("[web_search] baidu parsed_results={}", results.len());
    Ok(results)
}

async fn search_duckduckgo(
    client: &reqwest::Client,
    encoded_query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let url = format!("https://html.duckduckgo.com/html/?q={}", encoded_query);
    log::info!("[web_search] duckduckgo url={}", url);

    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let status = resp.status();
    let html = resp.text().await?;
    log::info!(
        "[web_search] duckduckgo status={} html_len={}",
        status,
        html.len()
    );
    if !status.is_success() {
        return Err(anyhow::anyhow!("duckduckgo returned {}", status));
    }

    let document = Html::parse_document(&html);
    // 按单个结果块解析，避免标题与摘要错位
    let result_sel =
        Selector::parse(".result").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let title_sel =
        Selector::parse("a.result__a").map_err(|e| anyhow::anyhow!("selector error: {}", e))?;
    let snippet_sel = Selector::parse(".result__snippet")
        .map_err(|e| anyhow::anyhow!("selector error: {}", e))?;

    let mut results = Vec::new();
    for item in document.select(&result_sel).take(limit) {
        let Some(title_el) = item.select(&title_sel).next() else {
            continue;
        };
        let title = title_el.text().collect::<String>().trim().to_string();
        let raw_href = title_el.attr("href").unwrap_or("");
        let url = extract_uddg_url(raw_href).unwrap_or_else(|| raw_href.to_string());
        if url.is_empty() {
            continue;
        }
        let snippet = item
            .select(&snippet_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        results.push(SearchResult {
            title,
            url,
            snippet,
        });
    }
    log::info!("[web_search] duckduckgo parsed_results={}", results.len());
    Ok(results)
}

/// 从 DDG 跳转链接中解析真实 URL
/// href 格式：//duckduckgo.com/l/?uddg=<encoded_url>&...
fn extract_uddg_url(href: &str) -> Option<String> {
    let query = href.split('?').nth(1)?;
    for pair in query.split('&') {
        if let Some(encoded) = pair.strip_prefix("uddg=") {
            return urlencoding::decode(encoded).ok().map(|s| s.into_owned());
        }
    }
    None
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
