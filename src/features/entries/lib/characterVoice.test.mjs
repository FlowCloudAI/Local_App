import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CHARACTER_VOICE_ID_TAG_ID,
    CHARACTER_VOICE_PLUGIN_ID_TAG,
    CHARACTER_VOICE_PLUGIN_ID_TAG_ID,
    readCharacterVoiceConfigFromDraftTags,
    readCharacterVoiceConfigFromTags,
    writeCharacterVoiceDraftTag,
} from './characterVoice.ts'

test('角色语音兼容旧标签，并在新项目使用稳定标签 ID', () => {
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
        {'legacy-plugin-schema': 'minimax-tts'},
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
