/**
 * 验证正文查找使用普通文本语义，并安全处理替换内容。
 */
import assert from 'node:assert/strict'
import {
    findMarkdownTextMatches,
    replaceMarkdownTextMatch,
    replaceMarkdownTextMatches,
} from '../src/features/entries/components/entryMarkdownSearch.ts'

assert.deepEqual(
    findMarkdownTextMatches('Alpha alpha ALPHA', 'alpha'),
    [
        {start: 0, end: 5},
        {start: 6, end: 11},
        {start: 12, end: 17},
    ],
)

assert.deepEqual(
    findMarkdownTextMatches('a.b a-b', 'a.b'),
    [{start: 0, end: 3}],
)

assert.equal(
    replaceMarkdownTextMatch('前文目标后文', {start: 2, end: 4}, '$&'),
    '前文$&后文',
)

assert.equal(
    replaceMarkdownTextMatches(
        '一处目标，二处目标',
        findMarkdownTextMatches('一处目标，二处目标', '目标'),
        '结果',
    ),
    '一处结果，二处结果',
)
