/**
 * 桌面端设定检测任务阶段与终止错误去重的最小回归检查。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    appendUniqueWorldCheckError,
    getWorldCheckPhaseStatus,
    type WorldCheckTask,
    type WorldCheckTaskError,
} from '../src/features/project-editor/stores/worldCheckTaskModel.ts'

const task = {
    projectId: 'project-1',
    projectName: '测试世界',
    checkKind: 'contradiction',
    pluginId: 'plugin-1',
    model: 'model-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'failed',
    phase: 'validate',
    startedAt: 1,
    finishedAt: 2,
    monitorOpen: true,
    currentActivity: '报告结构无效',
    outputChars: 100,
    toolCallCount: 2,
    retryCount: 0,
    scopeSummary: '全部设定',
    sourceEntryCount: 3,
    truncated: false,
    reportId: null,
    record: null,
    events: [],
    errors: [],
} satisfies WorldCheckTask

test('失败阶段保留已完成进度并去重同一终止错误', () => {
    assert.equal(getWorldCheckPhaseStatus(task, 'prepare'), 'done')
    assert.equal(getWorldCheckPhaseStatus(task, 'analyze'), 'done')
    assert.equal(getWorldCheckPhaseStatus(task, 'validate'), 'failed')
    assert.equal(getWorldCheckPhaseStatus(task, 'persist'), 'pending')

    const first: WorldCheckTaskError = {
        code: 'VALIDATION_FORMAT_ERROR',
        message: '报告结构无效',
        stage: 'validate',
        at: 2,
    }
    const duplicate = {...first, at: 3}
    const distinct = {...first, message: '报告引用无效', at: 4}
    const errors = appendUniqueWorldCheckError(
        appendUniqueWorldCheckError(appendUniqueWorldCheckError([], first), duplicate),
        distinct,
    )

    assert.deepEqual(errors, [first, distinct])
})
