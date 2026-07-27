/**
 * 扩展 Markdown 编辑态的语法高亮；这里只识别 FlowCloudAI 双链，不参与正文解析或保存。
 */
import type {Refractor} from "refractor/core";

export function registerWikiLinkSyntax(refractor: Refractor): void {
    const markdown = refractor.languages.markdown;
    if (!markdown || Object.hasOwn(markdown, "wiki-link")) return;

    refractor.languages.insertBefore("markdown", "url", {
        "wiki-link": {
            pattern: /\[\[[^[\]\r\n]+]]/,
            inside: {
                punctuation: /^\[\[|\]\]$/,
            },
        },
    });
}
