/**
 * 新对话草稿的最小回归检查，使用 Node 内置测试运行器。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type {Conversation} from '../src/features/ai-chat/model/AiControllerTypes.ts'
import {
    isEmptyDraftConversation,
    isPendingConversationId,
    toConversationHistory,
} from '../src/features/ai-chat/model/conversationState.ts'

const conversation = (
    id: string,
    overrides: Partial<Conversation> = {},
): Conversation => ({
    id,
    title: '测试对话',
    messages: [],
    pluginId: 'test-plugin',
    model: 'test-model',
    sessionId: null,
    runId: null,
    timestamp: 0,
    mode: 'default',
    settings: {
        temperature: 0.7,
        topP: 1,
        frequencyPenaltyEnabled: false,
        frequencyPenalty: 0,
        presencePenaltyEnabled: false,
        presencePenalty: 0,
        systemPrompt: '',
    },
    ...overrides,
})

test('历史列表只排除普通空草稿', () => {
    const draft = conversation('conv_draft')
    const report = conversation('conv_report', {
        mode: 'report',
        messages: [{id: 'report', role: 'assistant', content: '报告', timestamp: 0}],
    })
    const stored = conversation('session_stored')

    assert.equal(isPendingConversationId(report.id), true)
    assert.equal(isEmptyDraftConversation(draft), true)
    assert.equal(isEmptyDraftConversation(report), false)
    assert.deepEqual(toConversationHistory([draft, report, stored]), [report, stored])
})
