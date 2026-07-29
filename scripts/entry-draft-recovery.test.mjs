/**
 * 验证正文恢复快照按词条隔离，并能识别数据库版本冲突。
 */
import assert from 'node:assert/strict'
import {
    buildEntryDraftRecoveryKey,
    resolveEntryDraftRecoveryKind,
} from '../src/features/entries/lib/entryDraftRecovery.ts'

const record = {
    key: buildEntryDraftRecoveryKey('项目:A', '词条:B'),
    version: 1,
    projectId: '项目:A',
    entryId: '词条:B',
    baseUpdatedAt: '2026-07-29T12:00:00Z',
    savedAt: 1,
    content: '未保存正文',
}

assert.notEqual(
    buildEntryDraftRecoveryKey('项目:A', '词条:B'),
    buildEntryDraftRecoveryKey('项目', 'A:词条:B'),
)
assert.equal(resolveEntryDraftRecoveryKind(record, record.baseUpdatedAt), 'current')
assert.equal(resolveEntryDraftRecoveryKind(record, '2026-07-29T13:00:00Z'), 'stale')
