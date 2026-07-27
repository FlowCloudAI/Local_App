/**
 * 验证正文双链会被标色，同时代码片段中的相同文本保持代码语义。
 */
import assert from 'node:assert/strict'
import {refractor} from 'refractor/all'
import {registerWikiLinkSyntax} from '../src/features/entries/components/MarkdownEditor/markdownSyntax.ts'

registerWikiLinkSyntax(refractor)
registerWikiLinkSyntax(refractor)

const output = JSON.stringify(refractor.highlight('正文 [[纪远舟]] 与 `[[代码示例]]`', 'markdown'))
assert.equal(output.match(/wiki-link/g)?.length, 1)
assert.match(output, /code-snippet/)
