/**
 * 桌面端词条标签挂载策略的最小回归检查，使用 Node 内置测试运行器。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {groupEntryIdsByProject, type EntryTabMeta} from '../src/app/desktop/entryTabMounting.ts'

const tabs = Array.from({length: 11}, (_, index) => ({key: `entry-${index + 1}`}))
const entryTabMap = Object.fromEntries(tabs.map((tab, index) => [
    tab.key,
    {projectId: 'project-1', entryId: `entry-id-${index + 1}`} satisfies EntryTabMeta,
]))

test('全部打开词条不受最近页面挂载上限影响', () => {
    const grouped = groupEntryIdsByProject(tabs, entryTabMap)
    assert.equal(grouped['project-1'].length, 11)
    assert.equal(grouped['project-1'][0], 'entry-id-1')
})

test('实际挂载词条按保留的标签集合筛选', () => {
    const mountedKeys = new Set([...tabs.slice(-10).map(tab => tab.key), tabs[0].key])
    const grouped = groupEntryIdsByProject(tabs, entryTabMap, mountedKeys)
    assert.equal(grouped['project-1'].length, 11)
})
