import assert from 'node:assert/strict'
import test from 'node:test'

import {resolveMobileBackTarget} from './mobileBackNavigation.ts'

test('返回键先回退页面，再从次级标签回首页，最后才退出', () => {
    assert.equal(resolveMobileBackTarget('settings', true), 'page')
    assert.equal(resolveMobileBackTarget('settings', false), 'home')
    assert.equal(resolveMobileBackTarget('home', false), 'exit')
})
