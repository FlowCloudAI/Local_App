use anyhow::Result;
use ego_tree::NodeRef;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};
use moka::future::Cache;
use scraper::{Html, Node, Selector};
use std::sync::OnceLock;
use std::time::Duration;

fn is_text_content_type(ct: &str) -> bool {
    let ct = ct
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    matches!(
        ct.as_str(),
        "text/html"
            | "text/plain"
            | "text/xml"
            | "application/xhtml+xml"
            | "application/json"
            | "application/xml"
    )
}

// ── URL 内容缓存：15 分钟 TTL，最多 100 条 ───────────────────────────────────
static URL_CACHE: OnceLock<Cache<String, (u16, String)>> = OnceLock::new();

fn url_cache() -> &'static Cache<String, (u16, String)> {
    URL_CACHE.get_or_init(|| {
        Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(15 * 60))
            .build()
    })
}

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

    // ⑮ open_url - 获取网页内容（HTML 转纯文本，剔除 script/style）
    registry.register_async::<WorldflowToolState, _>(
        "open_url",
        "获取指定URL的网页内容并提取纯文本（自动剔除脚本和样式）；\
         返回 HTTP 状态码和可读正文，适合直接喂给后续分析。\
         仅支持公网地址，http 自动升级为 https，禁止内网/本地地址。",
        vec![
            ToolFunctionArg::new("url", "string")
                .required(true)
                .desc("要访问的 URL（http 自动升级为 https，禁止内网地址）")
                .format("uri"),
        ],
        |_state, args| {
            Box::pin(async move {
                let raw_url = arg_str(args, "url")?;

                // Fix 1: 校验凭证/内网/scheme，http 升级为 https
                let url = validate_url(raw_url)?;

                // Fix 3: 缓存命中直接返回
                let cache = url_cache();
                if let Some((status, body)) = cache.get(&url).await {
                    log::info!("[open_url] cache hit: {}", url);
                    return Ok(format!("HTTP {} (cached)\n\n{}", status, body));
                }

                // Fix 2: 自定义重定向策略，禁止跨域跳转，上限 10 次
                let client = reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        if attempt.previous().len() >= 10 {
                            return attempt.error("重定向次数超过上限");
                        }
                        let original = &attempt.previous()[0];
                        if is_permitted_redirect(original, attempt.url()) {
                            attempt.follow()
                        } else {
                            attempt.stop()
                        }
                    }))
                    .timeout(Duration::from_secs(30))
                    .build()
                    .map_err(|e| anyhow::anyhow!("构建 HTTP 客户端失败: {}", e))?;

                let response = client
                    .get(&url)
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    )
                    .send()
                    .await
                    .map_err(|e| anyhow::anyhow!("请求失败: {}", e))?;

                let status = response.status().as_u16();

                // Fix 6: 二进制 Content-Type 检测，提前短路
                let content_type = response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                if !is_text_content_type(&content_type) {
                    let msg = format!(
                        "HTTP {}\n\n[不支持的内容类型: {}，无法提取文本]",
                        status, content_type
                    );
                    log::info!(
                        "[open_url] binary content-type={}, skipping body read",
                        content_type
                    );
                    return Ok(msg);
                }

                let html = response
                    .text()
                    .await
                    .map_err(|e| anyhow::anyhow!("读取响应失败: {}", e))?;

                let text = html_to_text(&html);

                const MAX_CHARS: usize = 8000;
                let body = if text.chars().count() > MAX_CHARS {
                    let truncated: String = text.chars().take(MAX_CHARS).collect();
                    format!("{}\n…（内容过长已截断）", truncated)
                } else {
                    text
                };

                cache.insert(url, (status, body.clone())).await;

                Ok(format!("HTTP {}\n\n{}", status, body))
            })
        },
    );

    Ok(())
}

// ── URL 校验 ──────────────────────────────────────────────────────────────────

fn validate_url(raw: &str) -> Result<String> {
    // http 升级为 https
    let normalized = if raw.starts_with("http://") {
        raw.replacen("http://", "https://", 1)
    } else {
        raw.to_string()
    };

    let parsed =
        reqwest::Url::parse(&normalized).map_err(|e| anyhow::anyhow!("无效 URL: {}", e))?;

    if parsed.scheme() != "https" {
        return Err(anyhow::anyhow!(
            "仅支持 http/https 协议，不支持: {}",
            parsed.scheme()
        ));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow::anyhow!("URL 不允许包含认证凭证"));
    }

    let host = parsed.host_str().unwrap_or("");
    if host.is_empty() {
        return Err(anyhow::anyhow!("URL 缺少主机名"));
    }
    if is_private_host(host) {
        return Err(anyhow::anyhow!("禁止访问内网或本地地址: {}", host));
    }

    Ok(parsed.to_string())
}

fn is_private_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
            }
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
    }
    false
}

// 允许重定向条件：同域名（含 www 差异），且 scheme 只能同级或升级（http→https）
fn is_permitted_redirect(original: &reqwest::Url, next: &reqwest::Url) -> bool {
    fn strip_www(h: &str) -> &str {
        h.strip_prefix("www.").unwrap_or(h)
    }
    let orig_host = original.host_str().unwrap_or("");
    let next_host = next.host_str().unwrap_or("");

    let scheme_ok = original.scheme() == next.scheme()
        || (original.scheme() == "http" && next.scheme() == "https");

    scheme_ok && strip_www(orig_host) == strip_www(next_host)
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

/// 将 HTML 转换为 Markdown（保留链接/标题/列表结构），失败时降级为纯文本
fn html_to_text(html: &str) -> String {
    match htmd::convert(html) {
        Ok(md) => {
            let result = md
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            // 输出到控制台供调试验证
            println!(
                "[open_url][htmd] ===== markdown output ({}chars) =====\n{}\n=====",
                result.len(),
                result
            );
            result
        }
        Err(e) => {
            log::warn!(
                "[open_url][htmd] conversion failed: {}, falling back to plain text",
                e
            );
            let document = Html::parse_document(html);
            let mut buf = String::new();
            collect_text(document.tree.root(), &mut buf);
            buf.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
}

const SKIP_TAGS: &[&str] = &[
    "script", "style", "noscript", "head", "meta", "link", "svg", "canvas",
];

fn collect_text(node: NodeRef<'_, Node>, buf: &mut String) {
    match node.value() {
        Node::Text(t) => {
            buf.push_str(&t.text);
        }
        Node::Element(el) => {
            let tag = el.name();
            if SKIP_TAGS.contains(&tag) {
                return;
            }
            for child in node.children() {
                collect_text(child, buf);
            }
            // 块级元素后加换行，使文本结构更清晰
            if matches!(
                tag,
                "p" | "div"
                    | "br"
                    | "li"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "tr"
                    | "article"
                    | "section"
                    | "blockquote"
                    | "pre"
                    | "header"
                    | "footer"
                    | "nav"
            ) {
                buf.push('\n');
            }
        }
        _ => {
            for child in node.children() {
                collect_text(child, buf);
            }
        }
    }
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
