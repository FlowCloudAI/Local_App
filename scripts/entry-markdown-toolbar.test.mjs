/**
 * 验证正文工具栏切换标题与插入双链时不会破坏选区。
 */
import assert from 'node:assert/strict'
import {
    buildBlockStyleEdit,
    buildWikiLinkEdit,
} from '../src/features/entries/components/entryMarkdownToolbarCommands.ts'

assert.deepEqual(
    buildBlockStyleEdit('前文\n## 标题\n后文', {start: 6, end: 8}, '# '),
    {
        start: 3,
        end: 8,
        replacement: '# 标题',
        selection: {start: 5, end: 7},
    },
)

assert.equal(
    buildBlockStyleEdit('### 标题', {start: 4, end: 6}, '').replacement,
    '标题',
)

assert.deepEqual(
    buildWikiLinkEdit('纪远舟', 6),
    {
        start: 6,
        end: 9,
        replacement: '[[纪远舟]]',
        selection: {start: 8, end: 11},
    },
)
