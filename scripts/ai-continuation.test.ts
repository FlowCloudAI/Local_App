/**
 * AI 分段续写的最小回归检查，使用 Node 内置测试运行器。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type {Message} from '../src/features/ai-chat/model/AiControllerTypes.ts'
import {
    appendOrMergeContinuation,
    applyLatestTurnOutcome,
    isIncompleteMessage,
} from '../src/features/ai-chat/model/conversationState.ts'

const first: Message = {
    id: 'first',
    role: 'assistant',
    content: '前半',
    reasoning: '思考一',
    blocks: [{type: 'content', content: '前半'}],
    timestamp: 1,
    nodeId: 2,
    turnStatus: 'ok',
    finishReason: 'length',
    error: {code: 'TEST', message: '已截断'},
}

test('多次续写保留气泡并推进尾节点', () => {
    const second = appendOrMergeContinuation([first], {
        id: 'second',
        role: 'assistant',
        content: '中段',
        reasoning: '思考二',
        blocks: [{type: 'content', content: '中段'}],
        timestamp: 2,
        nodeId: 3,
        continuationOfNodeId: 2,
        turnStatus: 'ok',
        finishReason: 'length',
    })
    const final = appendOrMergeContinuation(second, {
        id: 'final',
        role: 'assistant',
        content: '后半',
        timestamp: 3,
        nodeId: 4,
        continuationOfNodeId: 3,
        turnStatus: 'ok',
        finishReason: 'stop',
    })

    assert.equal(final.length, 1)
    assert.equal(final[0]?.id, 'first')
    assert.equal(final[0]?.content, '前半中段后半')
    assert.equal(final[0]?.reasoning, '思考一思考二')
    assert.equal(final[0]?.nodeId, 4)
    assert.equal(final[0]?.finishReason, 'stop')
    assert.equal(final[0]?.error, undefined)
})

test('重载合并由最后节点覆盖结束状态', () => {
    const reloaded = applyLatestTurnOutcome(first, {
        turnStatus: undefined,
        finishReason: undefined,
        continuationOfNodeId: 2,
        error: undefined,
    })

    assert.equal(reloaded.finishReason, undefined)
    assert.equal(reloaded.turnStatus, undefined)
    assert.equal(isIncompleteMessage(reloaded), false)
})

test('找不到续写目标时保留独立消息', () => {
    const messages = appendOrMergeContinuation([first], {
        id: 'orphan',
        role: 'assistant',
        content: '独立段落',
        timestamp: 2,
        nodeId: 3,
        continuationOfNodeId: 999,
    })

    assert.equal(messages.length, 2)
    assert.equal(messages[1]?.id, 'orphan')
})
