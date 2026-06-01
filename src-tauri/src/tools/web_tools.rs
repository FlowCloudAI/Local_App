use anyhow::Result;
use ego_tree::NodeRef;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};
use moka::future::Cache;
use scraper::{Html, Node, Selector};
use serde::Deserialize;
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
    // ⑭ web_search - 分层联网搜索
    registry.register_async::<WorldflowToolState, _>(
        "web_search",
        "查找资料候选链接，不返回完整正文；需要正文时继续调用 open_url。\
         intent 默认 auto，除非用户明确要求词义、原文、语录、旅行、技术、游戏资料、作品设定或 ACG 资料。\
         返回 JSON，status 为 ok/empty/unavailable/error；status=unavailable 时不得推断信息不存在。",
        vec![
            ToolFunctionArg::new("query", "string")
                .required(true)
                .desc("搜索关键词"),
            ToolFunctionArg::new("intent", "string")
                .desc(
                    "搜索意图：auto=自动；encyclopedia=百科/概念；dictionary=词义/语源；source_text=原文/公版文本；quote=语录；travel=地理/城市；technical=技术资料；game=游戏资料；fandom=作品设定；acg=ACG/二次元；esports=电竞资料；web=通用网页兜底",
                )
                .enum_values([
                    "auto",
                    "encyclopedia",
                    "dictionary",
                    "source_text",
                    "quote",
                    "travel",
                    "technical",
                    "game",
                    "fandom",
                    "acg",
                    "esports",
                    "web",
                ])
                .default("auto"),
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
                let intent = args
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("auto");
                let engine = search_engine.lock().await.clone();

                let response = do_web_search(&http_client, &engine, query, limit, intent)
                    .await
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                let mut output = serde_json::json!({
                    "status": response.status.as_str(),
                    "query": query,
                    "count": response.results.len(),
                    "message": response.message,
                    "results": response.results.iter().map(|r| {
                        serde_json::json!({
                            "title": r.title,
                            "url": r.url,
                            "snippet": r.snippet,
                            "source": r.source,
                        })
                    }).collect::<Vec<_>>()
                });
                if response.status != SearchStatus::Ok && !response.providers.is_empty() {
                    output["providers"] = serde_json::json!(
                        response.providers.iter().map(|p| {
                            serde_json::json!({
                                "source": p.name,
                                "status": p.status.as_str(),
                                "message": p.message,
                            })
                        }).collect::<Vec<_>>()
                    );
                }

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SearchStatus {
    Ok,
    Empty,
    Unavailable,
    Error,
}

impl SearchStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Empty => "empty",
            Self::Unavailable => "unavailable",
            Self::Error => "error",
        }
    }
}

struct SearchResult {
    title: String,
    url: String,
    snippet: String,
    source: String,
}

struct ProviderReport {
    name: &'static str,
    status: SearchStatus,
    message: String,
}

struct ProviderOutcome {
    report: ProviderReport,
    results: Vec<SearchResult>,
}

impl ProviderOutcome {
    fn ok(name: &'static str, results: Vec<SearchResult>) -> Self {
        Self {
            report: ProviderReport {
                name,
                status: SearchStatus::Ok,
                message: "检索成功".to_string(),
            },
            results,
        }
    }

    fn empty(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            report: ProviderReport {
                name,
                status: SearchStatus::Empty,
                message: message.into(),
            },
            results: Vec::new(),
        }
    }

    fn unavailable(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            report: ProviderReport {
                name,
                status: SearchStatus::Unavailable,
                message: message.into(),
            },
            results: Vec::new(),
        }
    }

    fn error(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            report: ProviderReport {
                name,
                status: SearchStatus::Error,
                message: message.into(),
            },
            results: Vec::new(),
        }
    }
}

struct SearchResponse {
    status: SearchStatus,
    message: String,
    providers: Vec<ProviderReport>,
    results: Vec<SearchResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SearchIntent {
    Auto,
    Encyclopedia,
    Dictionary,
    SourceText,
    Quote,
    Travel,
    Technical,
    Game,
    Fandom,
    Acg,
    Esports,
    Web,
}

impl SearchIntent {
    fn parse(raw: &str) -> Result<Self> {
        match raw {
            "auto" => Ok(Self::Auto),
            "encyclopedia" => Ok(Self::Encyclopedia),
            "dictionary" => Ok(Self::Dictionary),
            "source_text" => Ok(Self::SourceText),
            "quote" => Ok(Self::Quote),
            "travel" => Ok(Self::Travel),
            "technical" => Ok(Self::Technical),
            "game" => Ok(Self::Game),
            "fandom" => Ok(Self::Fandom),
            "acg" => Ok(Self::Acg),
            "esports" => Ok(Self::Esports),
            "web" => Ok(Self::Web),
            other => Err(anyhow::anyhow!(
                "intent 仅支持 auto、encyclopedia、dictionary、source_text、quote、travel、technical、game、fandom、acg、esports 或 web，不支持: {}",
                other
            )),
        }
    }
}

#[derive(Clone, Copy)]
struct MediaWikiSource {
    name: &'static str,
    api_url: &'static str,
    article_base_url: &'static str,
}

const ENCYCLOPEDIA_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "中文维基百科",
        api_url: "https://zh.wikipedia.org/w/api.php",
        article_base_url: "https://zh.wikipedia.org/wiki/",
    },
    MediaWikiSource {
        name: "英文维基百科",
        api_url: "https://en.wikipedia.org/w/api.php",
        article_base_url: "https://en.wikipedia.org/wiki/",
    },
];

const DICTIONARY_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "中文维基词典",
        api_url: "https://zh.wiktionary.org/w/api.php",
        article_base_url: "https://zh.wiktionary.org/wiki/",
    },
    MediaWikiSource {
        name: "英文维基词典",
        api_url: "https://en.wiktionary.org/w/api.php",
        article_base_url: "https://en.wiktionary.org/wiki/",
    },
];

const SOURCE_TEXT_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "中文维基文库",
        api_url: "https://zh.wikisource.org/w/api.php",
        article_base_url: "https://zh.wikisource.org/wiki/",
    },
    MediaWikiSource {
        name: "英文维基文库",
        api_url: "https://en.wikisource.org/w/api.php",
        article_base_url: "https://en.wikisource.org/wiki/",
    },
];

const QUOTE_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "中文维基语录",
        api_url: "https://zh.wikiquote.org/w/api.php",
        article_base_url: "https://zh.wikiquote.org/wiki/",
    },
    MediaWikiSource {
        name: "英文维基语录",
        api_url: "https://en.wikiquote.org/w/api.php",
        article_base_url: "https://en.wikiquote.org/wiki/",
    },
];

const TRAVEL_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "中文维基导游",
        api_url: "https://zh.wikivoyage.org/w/api.php",
        article_base_url: "https://zh.wikivoyage.org/wiki/",
    },
    MediaWikiSource {
        name: "英文维基导游",
        api_url: "https://en.wikivoyage.org/w/api.php",
        article_base_url: "https://en.wikivoyage.org/wiki/",
    },
];

const TECHNICAL_SOURCES: &[MediaWikiSource] = &[MediaWikiSource {
    name: "ArchWiki",
    api_url: "https://wiki.archlinux.org/api.php",
    article_base_url: "https://wiki.archlinux.org/title/",
}];

const GAME_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "PCGamingWiki",
        api_url: "https://www.pcgamingwiki.com/w/api.php",
        article_base_url: "https://www.pcgamingwiki.com/wiki/",
    },
    MediaWikiSource {
        name: "Minecraft Wiki",
        api_url: "https://minecraft.wiki/api.php",
        article_base_url: "https://minecraft.wiki/w/",
    },
    MediaWikiSource {
        name: "UESP",
        api_url: "https://en.uesp.net/w/api.php",
        article_base_url: "https://en.uesp.net/wiki/",
    },
    MediaWikiSource {
        name: "Bulbapedia",
        api_url: "https://bulbapedia.bulbagarden.net/w/api.php",
        article_base_url: "https://bulbapedia.bulbagarden.net/wiki/",
    },
    MediaWikiSource {
        name: "Terraria Wiki",
        api_url: "https://terraria.wiki.gg/api.php",
        article_base_url: "https://terraria.wiki.gg/wiki/",
    },
    MediaWikiSource {
        name: "Satisfactory Wiki",
        api_url: "https://satisfactory.wiki.gg/api.php",
        article_base_url: "https://satisfactory.wiki.gg/wiki/",
    },
];

const FANDOM_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "Wookieepedia",
        api_url: "https://starwars.fandom.com/api.php",
        article_base_url: "https://starwars.fandom.com/wiki/",
    },
    MediaWikiSource {
        name: "Harry Potter Wiki",
        api_url: "https://harrypotter.fandom.com/api.php",
        article_base_url: "https://harrypotter.fandom.com/wiki/",
    },
    MediaWikiSource {
        name: "All The Tropes",
        api_url: "https://allthetropes.org/w/api.php",
        article_base_url: "https://allthetropes.org/wiki/",
    },
];

const ESPORTS_SOURCES: &[MediaWikiSource] = &[
    MediaWikiSource {
        name: "Liquipedia StarCraft II",
        api_url: "https://liquipedia.net/starcraft2/api.php",
        article_base_url: "https://liquipedia.net/starcraft2/",
    },
    MediaWikiSource {
        name: "Liquipedia Dota 2",
        api_url: "https://liquipedia.net/dota2/api.php",
        article_base_url: "https://liquipedia.net/dota2/",
    },
];

async fn do_web_search(
    client: &reqwest::Client,
    engine: &str,
    query: &str,
    limit: usize,
    intent: &str,
) -> Result<SearchResponse> {
    let limit = limit.clamp(1, 20);
    let intent = SearchIntent::parse(intent)?;

    let mut reports = Vec::new();
    let mut saw_empty = false;
    let mut saw_unavailable = false;
    let mut saw_error = false;

    for provider in providers_for_intent(intent, engine) {
        let outcome = run_provider(client, query, limit, provider).await;
        match outcome.report.status {
            SearchStatus::Ok => {
                let status = outcome.report.status;
                let message = format!(
                    "{} 找到 {} 条结果",
                    outcome.report.name,
                    outcome.results.len()
                );
                reports.push(outcome.report);
                return Ok(SearchResponse {
                    status,
                    message,
                    providers: reports,
                    results: outcome.results,
                });
            }
            SearchStatus::Empty => saw_empty = true,
            SearchStatus::Unavailable => saw_unavailable = true,
            SearchStatus::Error => saw_error = true,
        }
        reports.push(outcome.report);
    }

    let (status, message) = final_empty_status(saw_empty, saw_unavailable, saw_error);
    Ok(SearchResponse {
        status,
        message,
        providers: reports,
        results: Vec::new(),
    })
}

#[derive(Clone, Copy)]
enum ProviderPlan<'a> {
    MediaWiki {
        name: &'static str,
        sources: &'a [MediaWikiSource],
    },
    MoegirlOpenSearch,
    Serp {
        engine: &'a str,
    },
}

fn providers_for_intent<'a>(intent: SearchIntent, engine: &'a str) -> Vec<ProviderPlan<'a>> {
    match intent {
        SearchIntent::Auto => vec![
            ProviderPlan::MediaWiki {
                name: "维基百科",
                sources: ENCYCLOPEDIA_SOURCES,
            },
            ProviderPlan::MoegirlOpenSearch,
            ProviderPlan::Serp { engine },
        ],
        SearchIntent::Encyclopedia => vec![ProviderPlan::MediaWiki {
            name: "维基百科",
            sources: ENCYCLOPEDIA_SOURCES,
        }],
        SearchIntent::Dictionary => vec![ProviderPlan::MediaWiki {
            name: "维基词典",
            sources: DICTIONARY_SOURCES,
        }],
        SearchIntent::SourceText => vec![ProviderPlan::MediaWiki {
            name: "维基文库",
            sources: SOURCE_TEXT_SOURCES,
        }],
        SearchIntent::Quote => vec![ProviderPlan::MediaWiki {
            name: "维基语录",
            sources: QUOTE_SOURCES,
        }],
        SearchIntent::Travel => vec![ProviderPlan::MediaWiki {
            name: "维基导游",
            sources: TRAVEL_SOURCES,
        }],
        SearchIntent::Technical => vec![ProviderPlan::MediaWiki {
            name: "技术 wiki",
            sources: TECHNICAL_SOURCES,
        }],
        SearchIntent::Game => vec![ProviderPlan::MediaWiki {
            name: "游戏 wiki",
            sources: GAME_SOURCES,
        }],
        SearchIntent::Fandom => vec![ProviderPlan::MediaWiki {
            name: "作品设定 wiki",
            sources: FANDOM_SOURCES,
        }],
        SearchIntent::Acg => vec![
            ProviderPlan::MoegirlOpenSearch,
            ProviderPlan::MediaWiki {
                name: "维基百科",
                sources: ENCYCLOPEDIA_SOURCES,
            },
        ],
        SearchIntent::Esports => vec![ProviderPlan::MediaWiki {
            name: "电竞 wiki",
            sources: ESPORTS_SOURCES,
        }],
        SearchIntent::Web => vec![ProviderPlan::Serp { engine }],
    }
}

async fn run_provider(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    provider: ProviderPlan<'_>,
) -> ProviderOutcome {
    match provider {
        ProviderPlan::MediaWiki { name, sources } => {
            search_mediawiki_sources(client, name, sources, query, limit).await
        }
        ProviderPlan::MoegirlOpenSearch => search_moegirl_opensearch(client, query, limit).await,
        ProviderPlan::Serp { engine } => search_serp(client, engine, query, limit).await,
    }
}

fn final_empty_status(
    saw_empty: bool,
    saw_unavailable: bool,
    saw_error: bool,
) -> (SearchStatus, String) {
    if saw_unavailable || saw_error {
        return (
            if saw_error {
                SearchStatus::Error
            } else {
                SearchStatus::Unavailable
            },
            if saw_empty {
                "部分来源没有找到匹配结果，另有检索通道不可用；不得据此判断全网没有相关信息"
                    .to_string()
            } else {
                "检索通道不可用；不得据此判断信息不存在".to_string()
            },
        );
    }

    (
        SearchStatus::Empty,
        "检索通道正常，但没有找到匹配结果".to_string(),
    )
}

#[derive(Debug, Deserialize)]
struct MediaWikiApiResponse {
    #[serde(default)]
    error: Option<MediaWikiApiError>,
    #[serde(default)]
    query: Option<MediaWikiQuery>,
}

#[derive(Debug, Deserialize)]
struct MediaWikiApiError {
    code: String,
    info: String,
}

#[derive(Debug, Deserialize)]
struct MediaWikiQuery {
    #[serde(default)]
    search: Vec<MediaWikiSearchItem>,
}

#[derive(Debug, Deserialize)]
struct MediaWikiSearchItem {
    title: String,
    #[serde(default)]
    snippet: String,
}

async fn search_mediawiki_sources(
    client: &reqwest::Client,
    provider_name: &'static str,
    sources: &[MediaWikiSource],
    query: &str,
    limit: usize,
) -> ProviderOutcome {
    let per_source_limit = limit.min(10).max(1);
    let mut results = Vec::new();
    let mut unavailable_sources = Vec::new();
    let mut reachable_sources = 0usize;

    for source in sources {
        match search_mediawiki_source(client, *source, query, per_source_limit).await {
            Ok(mut items) => {
                reachable_sources += 1;
                results.append(&mut items);
                if results.len() >= limit {
                    results.truncate(limit);
                    break;
                }
            }
            Err(e) => {
                log::warn!("[web_search][mediawiki] {} failed: {}", source.name, e);
                unavailable_sources.push(source.name);
            }
        }
    }

    if !results.is_empty() {
        rank_results(&mut results, query);
        results.truncate(limit);
        return ProviderOutcome::ok(provider_name, results);
    }

    if reachable_sources > 0 {
        ProviderOutcome::empty(provider_name, "来源可用，但没有找到匹配结果")
    } else if unavailable_sources.is_empty() {
        ProviderOutcome::error(provider_name, "未配置可用来源")
    } else {
        ProviderOutcome::unavailable(
            provider_name,
            format!("来源均不可用: {}", unavailable_sources.join("、")),
        )
    }
}

async fn search_mediawiki_source(
    client: &reqwest::Client,
    source: MediaWikiSource,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let mut url = reqwest::Url::parse(source.api_url)?;
    url.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("list", "search")
        .append_pair("format", "json")
        .append_pair("utf8", "1")
        .append_pair("srsearch", query)
        .append_pair("srlimit", &limit.to_string());

    log::info!("[web_search][mediawiki] {} url={}", source.name, url);

    let response = client
        .get(url)
        .header(
            "User-Agent",
            "FlowCloudAI/0.1 (+https://github.com/FlowCloudAI/Local_App)",
        )
        .header("Accept", "application/json")
        .header("Accept-Encoding", "gzip")
        .timeout(Duration::from_secs(15))
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        return Err(anyhow::anyhow!("{} returned {}", source.name, status));
    }

    let data: MediaWikiApiResponse = response.json().await?;
    if let Some(error) = data.error {
        return Err(anyhow::anyhow!(
            "{} API error {}: {}",
            source.name,
            error.code,
            error.info
        ));
    }

    let items = data.query.map(|q| q.search).unwrap_or_default();
    let results = items
        .into_iter()
        .filter(|item| !item.title.trim().is_empty())
        .take(limit)
        .map(|item| SearchResult {
            title: item.title.clone(),
            url: mediawiki_article_url(source.article_base_url, &item.title),
            snippet: html_fragment_to_text(&item.snippet),
            source: source.name.to_string(),
        })
        .collect::<Vec<_>>();

    log::info!(
        "[web_search][mediawiki] {} parsed_results={}",
        source.name,
        results.len()
    );
    Ok(results)
}

async fn search_moegirl_opensearch(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> ProviderOutcome {
    match search_moegirl_opensearch_inner(client, query, limit).await {
        Ok(results) if !results.is_empty() => ProviderOutcome::ok("萌娘百科", results),
        Ok(_) => ProviderOutcome::empty("萌娘百科", "萌娘百科可用，但没有找到匹配结果"),
        Err(e) => ProviderOutcome::unavailable("萌娘百科", format!("萌娘百科搜索不可用: {}", e)),
    }
}

async fn search_moegirl_opensearch_inner(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let mut url = reqwest::Url::parse("https://zh.moegirl.org.cn/api.php")?;
    url.query_pairs_mut()
        .append_pair("action", "opensearch")
        .append_pair("format", "json")
        .append_pair("search", query)
        .append_pair("limit", &limit.to_string());

    log::info!("[web_search][moegirl] url={}", url);

    let response = client
        .get(url)
        .header(
            "User-Agent",
            "FlowCloudAI/0.1 (+https://github.com/FlowCloudAI/Local_App)",
        )
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(15))
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        return Err(anyhow::anyhow!("萌娘百科返回 {}", status));
    }

    let (_, titles, snippets, urls): (String, Vec<String>, Vec<String>, Vec<String>) =
        response.json().await?;
    let results = titles
        .into_iter()
        .enumerate()
        .filter(|(_, title)| !title.trim().is_empty())
        .filter_map(|(i, title)| {
            let url = urls.get(i)?.clone();
            if url.trim().is_empty() {
                return None;
            }
            Some(SearchResult {
                title,
                url,
                snippet: snippets.get(i).cloned().unwrap_or_default(),
                source: "萌娘百科".to_string(),
            })
        })
        .take(limit)
        .collect::<Vec<_>>();

    log::info!("[web_search][moegirl] parsed_results={}", results.len());
    Ok(results)
}

fn rank_results(results: &mut [SearchResult], query: &str) {
    let normalized_query = query.trim().to_lowercase();
    results.sort_by_key(|result| {
        let title = result.title.trim().to_lowercase();
        let rank = if title == normalized_query {
            0
        } else if title.starts_with(&normalized_query) {
            1
        } else if title.contains(&normalized_query) {
            2
        } else {
            3
        };
        (rank, title.len())
    });
}

async fn search_serp(
    client: &reqwest::Client,
    engine: &str,
    query: &str,
    limit: usize,
) -> ProviderOutcome {
    let encoded = urlencoding::encode(query);

    let search_result = if engine == "baidu" {
        search_baidu(client, &encoded, limit).await
    } else {
        match search_bing(client, &encoded, limit).await {
            Ok(results) if !results.is_empty() => return ProviderOutcome::ok("web", results),
            Ok(_) => log::warn!("[web_search] bing returned empty, fallback to duckduckgo"),
            Err(e) => log::warn!("[web_search] bing failed: {}, fallback to duckduckgo", e),
        };

        search_duckduckgo(client, &encoded, limit).await
    };

    match search_result {
        Ok(results) if !results.is_empty() => ProviderOutcome::ok("web", results),
        Ok(_) => ProviderOutcome::unavailable(
            "web",
            "通用网页搜索返回了页面但无法解析结果，可能是反爬或页面结构变化",
        ),
        Err(e) => ProviderOutcome::unavailable("web", format!("通用网页搜索请求失败: {}", e)),
    }
}

fn mediawiki_article_url(base_url: &str, title: &str) -> String {
    format!("{}{}", base_url, urlencoding::encode(title))
}

fn html_fragment_to_text(html: &str) -> String {
    let document = Html::parse_fragment(html);
    let mut buf = String::new();
    collect_text(document.tree.root(), &mut buf);
    normalize_inline_text(&buf)
}

fn normalize_inline_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
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
            source: "Bing".to_string(),
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
            source: "百度".to_string(),
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
            source: "DuckDuckGo".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "需要访问公网 MediaWiki API，手动验证 wiki 搜索链路时运行"]
    fn mediawiki_search_smoke() {
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio runtime 失败");

        rt.block_on(async {
            let client = reqwest::Client::builder()
                .user_agent("FlowCloudAI/0.1 (+https://github.com/FlowCloudAI/Local_App)")
                .build()
                .expect("构建 HTTP 客户端失败");

            for (source, query) in mediawiki_smoke_cases() {
                let results = search_mediawiki_source(&client, source, query, 3)
                    .await
                    .unwrap_or_else(|e| panic!("{} 搜索失败: {}", source.name, e));

                println!("[{}] query={} count={}", source.name, query, results.len());
                for result in &results {
                    println!(
                        "[{}] {} -> {} | {}",
                        result.source, result.title, result.url, result.snippet
                    );
                }

                assert!(!results.is_empty(), "{} 搜索结果不应为空", source.name);
                assert!(
                    results
                        .iter()
                        .all(|result| result.url.starts_with(source.article_base_url)),
                    "{} 搜索结果应使用对应站点文章链接",
                    source.name
                );
            }
        });
    }

    #[test]
    #[ignore = "需要访问公网萌娘百科 OpenSearch API，手动验证 ACG 搜索链路时运行"]
    fn moegirl_opensearch_smoke() {
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio runtime 失败");

        rt.block_on(async {
            let client = reqwest::Client::builder()
                .user_agent("FlowCloudAI/0.1 (+https://github.com/FlowCloudAI/Local_App)")
                .build()
                .expect("构建 HTTP 客户端失败");

            let results = search_moegirl_opensearch_inner(&client, "初音未来", 3)
                .await
                .expect("萌娘百科 OpenSearch 应可用");

            for result in &results {
                println!("[{}] {} -> {}", result.source, result.title, result.url);
            }

            assert!(!results.is_empty(), "萌娘百科搜索结果不应为空");
            assert!(
                results
                    .iter()
                    .all(|result| result.url.starts_with("https://zh.moegirl.org.cn/")),
                "萌娘百科结果应使用萌娘百科文章链接"
            );
        });
    }

    fn mediawiki_smoke_cases() -> Vec<(MediaWikiSource, &'static str)> {
        vec![
            (ENCYCLOPEDIA_SOURCES[0], "三国演义"),
            (ENCYCLOPEDIA_SOURCES[1], "Romance of the Three Kingdoms"),
            (DICTIONARY_SOURCES[0], "天空"),
            (DICTIONARY_SOURCES[1], "sky"),
            (SOURCE_TEXT_SOURCES[0], "三国演义"),
            (SOURCE_TEXT_SOURCES[1], "Hamlet"),
            (QUOTE_SOURCES[0], "孔子"),
            (QUOTE_SOURCES[1], "Shakespeare"),
            (TRAVEL_SOURCES[0], "北京"),
            (TRAVEL_SOURCES[1], "Paris"),
            (TECHNICAL_SOURCES[0], "systemd"),
            (GAME_SOURCES[0], "Elden Ring"),
            (GAME_SOURCES[1], "Creeper"),
            (GAME_SOURCES[2], "Skyrim"),
            (GAME_SOURCES[3], "Pikachu"),
            (GAME_SOURCES[4], "Zenith"),
            (GAME_SOURCES[5], "Iron Ore"),
            (FANDOM_SOURCES[0], "Darth Vader"),
            (FANDOM_SOURCES[1], "Hogwarts"),
            (FANDOM_SOURCES[2], "Hero"),
            (ESPORTS_SOURCES[0], "Serral"),
            (ESPORTS_SOURCES[1], "The International"),
        ]
    }

    #[test]
    fn parses_supported_search_intents() {
        for intent in [
            "auto",
            "encyclopedia",
            "dictionary",
            "source_text",
            "quote",
            "travel",
            "technical",
            "game",
            "fandom",
            "acg",
            "esports",
            "web",
        ] {
            assert!(
                SearchIntent::parse(intent).is_ok(),
                "{} 应该是合法 intent",
                intent
            );
        }
    }
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
