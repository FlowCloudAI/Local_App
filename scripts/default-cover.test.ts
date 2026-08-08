/** 默认封面的身份与首字符规则回归测试。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getDefaultCoverTheme,
    getMeaningfulCoverMark,
} from '../src/shared/lib/defaultCover.ts'

test('同一 ID 始终得到相同默认封面身份', () => {
    assert.deepEqual(getDefaultCoverTheme('project-far-star'), getDefaultCoverTheme('project-far-star'))
    assert.notDeepEqual(getDefaultCoverTheme('project-far-star'), getDefaultCoverTheme('project-mirror-lake'))
})

test('首字符跳过书名号与其他标点', () => {
    assert.equal(getMeaningfulCoverMark('《镜湖编年史》'), '镜')
    assert.equal(getMeaningfulCoverMark('  ·「北境诸王」'), '北')
})

test('首字符支持拉丁字母、数字与空标题降级', () => {
    assert.equal(getMeaningfulCoverMark('aetheria'), 'A')
    assert.equal(getMeaningfulCoverMark('  7号档案'), '7')
    assert.equal(getMeaningfulCoverMark('《》', '词'), '词')
})
