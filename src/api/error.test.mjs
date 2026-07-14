import assert from 'node:assert/strict'
import test from 'node:test'

import {toApiError} from './error.ts'

test('普通对象错误优先展示 message', () => {
    assert.equal(toApiError({message: '访问密钥未配置'}).message, '访问密钥未配置')
})

test('无 message 的对象错误使用可读 JSON', () => {
    assert.equal(
        toApiError({status: 401, error: 'unauthorized'}).message,
        '{"status":401,"error":"unauthorized"}',
    )
})

test('不可序列化的对象错误不会退化成 Object 文案', () => {
    const circular = {}
    circular.self = circular
    assert.equal(toApiError(circular).message, '未知错误')
})
