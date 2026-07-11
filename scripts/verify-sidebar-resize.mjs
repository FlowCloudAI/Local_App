import assert from 'node:assert/strict'
import {resolveSidebarDrag} from '../src/shared/ui/layout/sidebarResizeMath.ts'

assert.deepEqual(resolveSidebarDrag(280, 240, 352, 51.2), {
    width: 280,
    shouldCollapse: false,
})
assert.deepEqual(resolveSidebarDrag(100, 240, 352, 51.2), {
    width: 240,
    shouldCollapse: false,
})
assert.deepEqual(resolveSidebarDrag(40, 240, 352, 51.2), {
    width: 240,
    shouldCollapse: true,
})
assert.deepEqual(resolveSidebarDrag(400, 240, 352, 51.2), {
    width: 352,
    shouldCollapse: false,
})
