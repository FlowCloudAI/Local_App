// 验证拖拽安装只接受单个 .fcplug 文件路径。

import assert from 'node:assert/strict'
import {resolveDroppedPluginPath} from './pluginFileDrop.ts'

assert.deepEqual(resolveDroppedPluginPath(['C:\\插件\\demo.FCPLUG']), {ok: true, path: 'C:\\插件\\demo.FCPLUG'})
assert.equal(resolveDroppedPluginPath([]).error, '请一次拖入一个 .fcplug 插件包。')
assert.equal(resolveDroppedPluginPath(['a.fcplug', 'b.fcplug']).error, '请一次拖入一个 .fcplug 插件包。')
assert.equal(resolveDroppedPluginPath(['demo.zip']).error, '只能安装 .fcplug 插件包。')
