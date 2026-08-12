import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CHARACTER_VOICE_ID_TAG_ID,
    CHARACTER_VOICE_PLUGIN_ID_TAG,
    CHARACTER_VOICE_PLUGIN_ID_TAG_ID,
    areCharacterVoiceDraftTagsEqual,
    readCharacterVoiceConfigFromDraftTags,
    readCharacterVoiceConfigFromTags,
    writeCharacterVoiceDraftTag,
} from './characterVoice.ts'

test('角色语音兼容旧标签，写入时迁移到稳定标签 ID', () => {
    assert.deepEqual(readCharacterVoiceConfigFromTags([
        {schema_id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID, value: 'minimax-tts'},
        {schema_id: CHARACTER_VOICE_ID_TAG_ID, value: 'male-qn-qingse'},
    ]), {
        pluginId: 'minimax-tts',
        model: null,
        voiceId: 'male-qn-qingse',
        autoPlay: null,
    })

    const legacySchemas = [{id: 'legacy-plugin-schema', name: CHARACTER_VOICE_PLUGIN_ID_TAG}]
    const legacyDraft = {'legacy-plugin-schema': 'qwen-tts'}
    assert.equal(readCharacterVoiceConfigFromDraftTags(legacyDraft, legacySchemas).pluginId, 'qwen-tts')
    assert.deepEqual(
        writeCharacterVoiceDraftTag(
            legacyDraft,
            legacySchemas,
            {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
            'minimax-tts',
        ),
        {[CHARACTER_VOICE_PLUGIN_ID_TAG_ID]: 'minimax-tts'},
    )
    assert.deepEqual(
        writeCharacterVoiceDraftTag(
            {},
            [],
            {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
            'minimax-tts',
        ),
        {[CHARACTER_VOICE_PLUGIN_ID_TAG_ID]: 'minimax-tts'},
    )
})

test('角色语音变化会被词条保存判断识别', () => {
    assert.equal(areCharacterVoiceDraftTagsEqual(
        {},
        {[CHARACTER_VOICE_PLUGIN_ID_TAG_ID]: 'minimax-tts'},
        [],
    ), false)
})
