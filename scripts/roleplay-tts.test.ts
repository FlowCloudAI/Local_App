/**
 * 角色对话即时语音触发的最小回归检查。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    createCompletedAssistantTurn,
    toRoleplayTtsText,
} from '../src/features/ai-chat/model/conversationState.ts'

test('发送语音前删除中英文括号及其嵌套内容', () => {
    assert.equal(
        toRoleplayTtsText('你好（笑着说（悄悄话））！(pause (slowly))继续。'),
        '你好！继续。',
    )
    assert.equal(toRoleplayTtsText('（只有动作）'), '')
})

test('只把当前会话成功完成的助手正文标记为前台即时回复', () => {
    assert.deepEqual(createCompletedAssistantTurn(
        {role: 'assistant', content: '新增台词', turnStatus: 'ok'},
        'character-1',
        'character-1',
        1,
    ), {
        sequence: 1,
        conversationId: 'character-1',
        text: '新增台词',
        activeAtCompletion: true,
    })

    assert.equal(createCompletedAssistantTurn(
        {role: 'assistant', content: '失败时保留的正文', turnStatus: 'interrupted'},
        'character-1',
        'character-1',
        2,
    ), null)
    assert.equal(createCompletedAssistantTurn(
        {role: 'assistant', content: '   ', turnStatus: 'ok'},
        'character-1',
        'character-1',
        2,
    ), null)
})

test('后台完成会保留新增正文，但不会标记为前台回复', () => {
    const turn = createCompletedAssistantTurn(
        {role: 'assistant', content: '续写新增段', turnStatus: 'ok'},
        'character-1',
        'character-2',
        3,
    )

    assert.equal(turn?.text, '续写新增段')
    assert.equal(turn?.activeAtCompletion, false)
})
