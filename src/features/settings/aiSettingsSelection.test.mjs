import assert from 'node:assert/strict'
import test from 'node:test'

import {resolveApiKeyPluginId} from './aiSettingsSelection.ts'

test('定向打开 AI 设置时优先选择目标插件', () => {
    const plugins = [{id: 'llm-qwen'}, {id: 'image-qwen'}, {id: 'tts-qwen'}]

    assert.equal(
        resolveApiKeyPluginId('image-qwen', 'llm-qwen', plugins, 'llm-qwen'),
        'image-qwen',
    )
})

test('目标插件无效时保留当前有效选择并最终回退默认插件', () => {
    const plugins = [{id: 'llm-qwen'}, {id: 'image-qwen'}]

    assert.equal(resolveApiKeyPluginId('missing', 'image-qwen', plugins, 'llm-qwen'), 'image-qwen')
    assert.equal(resolveApiKeyPluginId('missing', 'missing', plugins, 'llm-qwen'), 'llm-qwen')
})
