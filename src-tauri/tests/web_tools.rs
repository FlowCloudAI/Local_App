//! web_tools 集成测试：由 src/tools/web_tools.rs 内的单元测试迁移而来。
//!
//! 为什么是集成测试而不是 `#[cfg(test)]` 单元测试：lib 单元测试会编进 `app_lib` 那个
//! 单一测试二进制，而该二进制拿不到 common-controls v6 清单 —— comctl32 绑定到
//! System32 的 v5.82（缺 `TaskDialogIndirect` 等 v6 导出），启动即 STATUS_ENTRYPOINT_NOT_FOUND。
//! `tests/` 下的集成测试可由 `build.rs` 的 `cargo:rustc-link-arg-tests` 注入清单（见
//! `build.rs` 与 `common-controls.manifest`）。被测内部条目经 `app_lib::test_api` 暴露。

use app_lib::test_api::{
    DICTIONARY_SOURCES, ENCYCLOPEDIA_SOURCES, ESPORTS_SOURCES, FANDOM_SOURCES, GAME_SOURCES,
    MediaWikiSource, QUOTE_SOURCES, SOURCE_TEXT_SOURCES, SearchIntent, TECHNICAL_SOURCES,
    TRAVEL_SOURCES, search_mediawiki_source,
};

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
