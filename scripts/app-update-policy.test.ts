// 启动更新策略自检：跳过只匹配同一版本，后续新版本仍应提示。

import assert from 'node:assert/strict'
import {shouldOfferStartupUpdate} from '../src/features/about/appUpdate.ts'
import {mergeUpdateChangelogEntries} from '../src/features/about/updateChangelog.ts'

assert.equal(shouldOfferStartupUpdate(true, '0.1.5', null), true)
assert.equal(shouldOfferStartupUpdate(true, '0.1.5', '0.1.5'), false)
assert.equal(shouldOfferStartupUpdate(true, '0.1.6', '0.1.5'), true)
assert.equal(shouldOfferStartupUpdate(false, '0.1.6', null), false)
assert.deepEqual(
    mergeUpdateChangelogEntries(
        [{version: '0.1.5', date: '', notes: ''}],
        [{version: '0.1.4', date: '2026-07-03', notes: '旧版'}],
        [{version: '0.1.10', date: '2026-08-12', notes: '新版'}],
    ),
    [
        {version: '0.1.10', date: '2026-08-12', notes: '新版'},
        {version: '0.1.5', date: '', notes: '此版本未提供更新说明。'},
        {version: '0.1.4', date: '2026-07-03', notes: '旧版'},
    ],
)
assert.deepEqual(
    mergeUpdateChangelogEntries(
        [{version: '0.1.4', date: '', notes: ''}],
        [{version: '0.1.4', date: '2026-07-03', notes: '本地说明'}],
    ),
    [{version: '0.1.4', date: '2026-07-03', notes: '本地说明'}],
)

console.log('启动更新策略检查通过')
