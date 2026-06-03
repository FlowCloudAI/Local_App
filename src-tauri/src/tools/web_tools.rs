use crate::settings::SearchSourceSettings;
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
         intent 默认 auto，除非用户明确要求词义、原文、语录、旅行、技术、游戏资料或作品设定。\
         返回 JSON，status 为 ok/empty/unavailable/error；status=unavailable 时不得推断信息不存在。",
        vec![
            ToolFunctionArg::new("query", "string")
                .required(true)
                .desc("搜索关键词"),
            ToolFunctionArg::new("intent", "string")
                .desc(
                    "搜索意图：auto=自动；encyclopedia=百科/概念；dictionary=词义/语源；source_text=原文/公版文本；quote=语录；travel=地理/城市；technical=技术资料；game=游戏资料；fandom=作品设定；esports=电竞资料；web=通用网页兜底",
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
            let search_sources = _state.search_sources.clone();
            Box::pin(async move {
                let query = arg_str(args, "query")?;
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
                let intent = args
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("auto");
                let engine = search_engine.lock().await.clone();
                let source_settings = search_sources.lock().await.clone();

                let response =
                    do_web_search(&http_client, &engine, &source_settings, query, limit, intent)
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

pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
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
pub enum SearchIntent {
    Auto,
    Encyclopedia,
    Dictionary,
    SourceText,
    Quote,
    Travel,
    Technical,
    Game,
    Fandom,
    Esports,
    Web,
}

impl SearchIntent {
    pub fn parse(raw: &str) -> Result<Self> {
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
            "esports" => Ok(Self::Esports),
            "web" => Ok(Self::Web),
            other => Err(anyhow::anyhow!(
                "intent 仅支持 auto、encyclopedia、dictionary、source_text、quote、travel、technical、game、fandom、esports 或 web，不支持: {}",
                other
            )),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Auto => "自动搜索",
            Self::Encyclopedia => "百科搜索",
            Self::Dictionary => "词典搜索",
            Self::SourceText => "原文搜索",
            Self::Quote => "语录搜索",
            Self::Travel => "旅行搜索",
            Self::Technical => "技术资料搜索",
            Self::Game => "游戏资料搜索",
            Self::Fandom => "作品设定搜索",
            Self::Esports => "电竞资料搜索",
            Self::Web => "通用网页搜索",
        }
    }
}

#[derive(Clone, Copy)]
pub struct MediaWikiSource {
    pub name: &'static str,
    api_url: &'static str,
    pub article_base_url: &'static str,
}

pub const ENCYCLOPEDIA_SOURCES: &[MediaWikiSource] = &[
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

pub const DICTIONARY_SOURCES: &[MediaWikiSource] = &[
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

pub const SOURCE_TEXT_SOURCES: &[MediaWikiSource] = &[
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

pub const QUOTE_SOURCES: &[MediaWikiSource] = &[
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

pub const TRAVEL_SOURCES: &[MediaWikiSource] = &[
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

pub const TECHNICAL_SOURCES: &[MediaWikiSource] = &[MediaWikiSource {
    name: "ArchWiki",
    api_url: "https://wiki.archlinux.org/api.php",
    article_base_url: "https://wiki.archlinux.org/title/",
}];

pub const GAME_SOURCES: &[MediaWikiSource] = &[
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

pub const FANDOM_SOURCES: &[MediaWikiSource] = &[
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

pub const ESPORTS_SOURCES: &[MediaWikiSource] = &[
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
    source_settings: &SearchSourceSettings,
    query: &str,
    limit: usize,
    intent: &str,
) -> Result<SearchResponse> {
    let limit = limit.clamp(1, 20);
    let intent = SearchIntent::parse(intent)?;
    let providers = providers_for_intent(intent, engine, source_settings);
    if providers.is_empty() {
        return Ok(SearchResponse {
            status: SearchStatus::Unavailable,
            message: format!(
                "{} 没有启用可用信源；请在设置中启用对应搜索信源",
                intent.label()
            ),
            providers: Vec::new(),
            results: Vec::new(),
        });
    }

    let mut reports = Vec::new();
    let mut saw_empty = false;
    let mut saw_unavailable = false;
    let mut saw_error = false;

    for provider in providers {
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
    Serp {
        engine: &'a str,
    },
}

fn providers_for_intent<'a>(
    intent: SearchIntent,
    engine: &'a str,
    source_settings: &SearchSourceSettings,
) -> Vec<ProviderPlan<'a>> {
    match intent {
        SearchIntent::Auto => {
            let mut providers = Vec::new();
            if source_settings.wikimedia {
                providers.push(ProviderPlan::MediaWiki {
                    name: "维基百科",
                    sources: ENCYCLOPEDIA_SOURCES,
                });
            }
            if source_settings.web {
                providers.push(ProviderPlan::Serp { engine });
            }
            providers
        }
        SearchIntent::Encyclopedia if source_settings.wikimedia => vec![ProviderPlan::MediaWiki {
            name: "维基百科",
            sources: ENCYCLOPEDIA_SOURCES,
        }],
        SearchIntent::Dictionary if source_settings.wikimedia => vec![ProviderPlan::MediaWiki {
            name: "维基词典",
            sources: DICTIONARY_SOURCES,
        }],
        SearchIntent::SourceText if source_settings.wikimedia => vec![ProviderPlan::MediaWiki {
            name: "维基文库",
            sources: SOURCE_TEXT_SOURCES,
        }],
        SearchIntent::Quote if source_settings.wikimedia => vec![ProviderPlan::MediaWiki {
            name: "维基语录",
            sources: QUOTE_SOURCES,
        }],
        SearchIntent::Travel if source_settings.wikimedia => vec![ProviderPlan::MediaWiki {
            name: "维基导游",
            sources: TRAVEL_SOURCES,
        }],
        SearchIntent::Technical if source_settings.technical_wiki => {
            vec![ProviderPlan::MediaWiki {
                name: "技术 wiki",
                sources: TECHNICAL_SOURCES,
            }]
        }
        SearchIntent::Game if source_settings.game_wiki => vec![ProviderPlan::MediaWiki {
            name: "游戏 wiki",
            sources: GAME_SOURCES,
        }],
        SearchIntent::Fandom if source_settings.fandom_wiki => vec![ProviderPlan::MediaWiki {
            name: "作品设定 wiki",
            sources: FANDOM_SOURCES,
        }],
        SearchIntent::Esports if source_settings.esports_wiki => vec![ProviderPlan::MediaWiki {
            name: "电竞 wiki",
            sources: ESPORTS_SOURCES,
        }],
        SearchIntent::Web if source_settings.web => vec![ProviderPlan::Serp { engine }],
        _ => Vec::new(),
    }
}

#[doc(hidden)]
pub fn provider_count_for_test(
    intent: SearchIntent,
    engine: &str,
    source_settings: &SearchSourceSettings,
) -> usize {
    providers_for_intent(intent, engine, source_settings).len()
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
            }
            Err(e) => {
                log::warn!("[web_search][mediawiki] {} failed: {}", source.name, e);
                unavailable_sources.push(source.name);
            }
        }
    }

    if !results.is_empty() {
        let results = finalize_results(results, query, limit);
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

pub async fn search_mediawiki_source(
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

fn finalize_results(
    mut results: Vec<SearchResult>,
    query: &str,
    limit: usize,
) -> Vec<SearchResult> {
    results.retain(|result| !result.title.trim().is_empty() && !result.url.trim().is_empty());
    rank_results(&mut results, query);
    dedup_results(results).into_iter().take(limit).collect()
}

fn rank_results(results: &mut [SearchResult], query: &str) {
    let normalized_query = query.trim().to_lowercase();
    results.sort_by_key(|result| {
        let title = result.title.trim().to_lowercase();
        let title_rank = if title == normalized_query {
            0
        } else if title.starts_with(&normalized_query) {
            1
        } else if title.contains(&normalized_query) {
            2
        } else {
            3
        };
        let disambiguation_rank = if is_disambiguation_title(&title) {
            1
        } else {
            0
        };
        let snippet_rank = if result.snippet.trim().is_empty() {
            1
        } else {
            0
        };
        (
            title_rank,
            disambiguation_rank,
            snippet_rank,
            title.len(),
            result.source.clone(),
        )
    });
}

fn dedup_results(results: Vec<SearchResult>) -> Vec<SearchResult> {
    let mut seen_urls = std::collections::HashSet::new();
    let mut seen_titles = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for result in results {
        let url_key = normalize_url_for_dedup(&result.url);
        let title_key = normalize_title_for_dedup(&result.title);
        if url_key.is_empty() || title_key.is_empty() {
            continue;
        }
        if seen_urls.contains(&url_key) || seen_titles.contains(&title_key) {
            continue;
        }
        seen_urls.insert(url_key);
        seen_titles.insert(title_key);
        deduped.push(result);
    }

    deduped
}

fn normalize_url_for_dedup(url: &str) -> String {
    let trimmed = url.trim();
    if let Ok(mut parsed) = reqwest::Url::parse(trimmed) {
        parsed.set_fragment(None);
        parsed.set_query(None);
        let mut normalized = parsed.to_string();
        while normalized.ends_with('/') {
            normalized.pop();
        }
        return normalized.to_lowercase();
    }

    trimmed
        .trim_end_matches('/')
        .split('#')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

fn normalize_title_for_dedup(title: &str) -> String {
    title
        .trim()
        .to_lowercase()
        .replace(['_', ' ', '　', '-', '—', ':', '：'], "")
}

fn is_disambiguation_title(title: &str) -> bool {
    title.contains("disambiguation") || title.contains("消歧义") || title.contains("消歧義")
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
            Ok(results) if !results.is_empty() => {
                return ProviderOutcome::ok("web", finalize_results(results, query, limit));
            }
            Ok(_) => log::warn!("[web_search] bing returned empty, fallback to duckduckgo"),
            Err(e) => log::warn!("[web_search] bing failed: {}, fallback to duckduckgo", e),
        };

        search_duckduckgo(client, &encoded, limit).await
    };

    match search_result {
        Ok(results) if !results.is_empty() => {
            ProviderOutcome::ok("web", finalize_results(results, query, limit))
        }
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

/// 仅供集成测试访问 `web_tools` 内部实现的桥接模块（`#[doc(hidden)]`，非稳定公开 API）。
/// 这些条目本身保持私有，只经此公开路径再导出，供 `tests/web_tools.rs` 调用——
/// 因为外部 test crate 无法访问 crate 私有项。为何测试必须放在 `tests/` 下而非
/// `#[cfg(test)]` 单元测试：见 `build.rs` 与 `common-controls.manifest`（lib 单元测试
/// 二进制拿不到 common-controls v6 清单，加载期会 STATUS_ENTRYPOINT_NOT_FOUND）。
#[doc(hidden)]
pub mod __test_api {
    pub use super::{
        DICTIONARY_SOURCES, ENCYCLOPEDIA_SOURCES, ESPORTS_SOURCES, FANDOM_SOURCES, GAME_SOURCES,
        MediaWikiSource, QUOTE_SOURCES, SOURCE_TEXT_SOURCES, SearchIntent, SearchResult,
        TECHNICAL_SOURCES, TRAVEL_SOURCES, provider_count_for_test, search_mediawiki_source,
    };
}

// 需要引用 state 模块中的 WorldflowToolState
use super::state::WorldflowToolState;
