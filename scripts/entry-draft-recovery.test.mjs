/**
 * 验证词条恢复快照的版本兼容、字段差异与数据库版本冲突。
 */
import assert from 'node:assert/strict'
import {
    buildEntryDraftRecoveryKey,
    getEntryDraftRecoveryFields,
    normalizeEntryDraftRecoveryRecord,
    resolveEntryDraftRecoveryKind,
} from '../src/features/entries/lib/entryDraftRecovery.ts'

const record = {
    key: buildEntryDraftRecoveryKey('项目:A', '词条:B'),
    version: 2,
    projectId: '项目:A',
    entryId: '词条:B',
    baseUpdatedAt: '2026-07-29T12:00:00Z',
    savedAt: 1,
    draft: {
        title: '新标题',
        content: '未保存正文',
        tags: {状态: '草稿'},
    },
}

assert.notEqual(
    buildEntryDraftRecoveryKey('项目:A', '词条:B'),
    buildEntryDraftRecoveryKey('项目', 'A:词条:B'),
)
assert.equal(resolveEntryDraftRecoveryKind(record, record.baseUpdatedAt), 'current')
assert.equal(resolveEntryDraftRecoveryKind(record, '2026-07-29T13:00:00Z'), 'stale')
assert.deepEqual(
    getEntryDraftRecoveryFields(record, {
        title: '旧标题',
        content: '正式正文',
        tags: {状态: '草稿'},
    }),
    ['title', 'content'],
)

const legacyRecord = normalizeEntryDraftRecoveryRecord({
    ...record,
    version: 1,
    content: '旧版正文草稿',
    draft: undefined,
})
assert.equal(legacyRecord?.version, 2)
assert.deepEqual(legacyRecord?.draft, {content: '旧版正文草稿'})
assert.equal(normalizeEntryDraftRecoveryRecord({...record, draft: {images: '无效'}}), null)
