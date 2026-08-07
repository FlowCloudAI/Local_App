import assert from 'node:assert/strict'
import {
    buildProjectHomeAttentionItems,
    formatProjectStatCount,
    getProjectHomeNudge,
} from '../src/pages/projectListHomeModel.ts'
import {findHomeContinueTarget} from '../src/features/home/homeContinueTarget.ts'

const stats = {
    entryCount: 12,
    wordCount: 124000,
    emptyContentEntryCount: 2,
    uncategorizedEntryCount: 3,
    isolatedEntryCount: 4,
}
const projects = [{id: 'world-1', name: '远星大陆'}]
const items = buildProjectHomeAttentionItems(projects, new Map([['world-1', stats]]))

assert.match(formatProjectStatCount(stats.wordCount), /12.*万/)
assert.deepEqual(getProjectHomeNudge(stats), {key: 'empty', label: '2 个词条内容为空'})
assert.equal(items[0]?.key, 'world-1:empty')
assert.match(items[0]?.title ?? '', /远星大陆/)
assert.equal(findHomeContinueTarget([{type: 'tool'}, {type: 'entry'}])?.type, 'entry')
assert.equal(findHomeContinueTarget([{type: 'tool'}]), null)
