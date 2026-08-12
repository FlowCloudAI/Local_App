// 启动更新策略自检：跳过只匹配同一版本，后续新版本仍应提示。

import assert from 'node:assert/strict'
import {mergeUpdateChangelog, shouldOfferStartupUpdate} from '../src/features/about/appUpdate.ts'

assert.equal(shouldOfferStartupUpdate(true, '0.1.5', null), true)
assert.equal(shouldOfferStartupUpdate(true, '0.1.5', '0.1.5'), false)
assert.equal(shouldOfferStartupUpdate(true, '0.1.6', '0.1.5'), true)
assert.equal(shouldOfferStartupUpdate(false, '0.1.6', null), false)
assert.deepEqual(
    mergeUpdateChangelog([{version: '0.1.4'}], {version: '0.1.5'}),
    [{version: '0.1.5'}, {version: '0.1.4'}],
)
assert.deepEqual(
    mergeUpdateChangelog([{version: '0.1.4'}], {version: '0.1.4'}),
    [{version: '0.1.4'}],
)

console.log('启动更新策略检查通过')
