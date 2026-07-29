/**
 * 验证正文大纲只提取 H1–H3，并忽略代码围栏内容。
 */
import assert from 'node:assert/strict'
import {buildMarkdownOutline} from '../src/features/entries/components/entryMarkdownOutlineUtils.ts'

const source = [
    '# 总览',
    '正文',
    '```md',
    '## 代码中的标题',
    '```',
    '## 章节',
    '#### 不进入大纲',
    '### 小节 ###',
].join('\n')

assert.deepEqual(
    buildMarkdownOutline(source).map(({level, title}) => ({level, title})),
    [
        {level: 1, title: '总览'},
        {level: 2, title: '章节'},
        {level: 3, title: '小节'},
    ],
)

assert.deepEqual(buildMarkdownOutline('~~~\n# 忽略\n~~~~\n# 保留').map(({title}) => title), ['保留'])
