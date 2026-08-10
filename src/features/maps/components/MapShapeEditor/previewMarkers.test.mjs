import assert from 'node:assert/strict'
import test from 'node:test'

import {appendMapPreviewMarkers} from './previewMarkers.ts'

const scene = {
    canvas: {width: 1200, height: 800},
    shapes: [],
    keyLocations: [{
        id: 'saved-location',
        name: '城镇',
        markerClass: 'city',
        position: [240, 180],
        color: [80, 120, 180, 255],
    }],
}

test('临时标记追加到派生场景且不修改原场景', () => {
    const marker = {
        id: 'overlay:character:1',
        name: '角色位置',
        markerClass: 'marker',
        position: [360, 260],
        color: [220, 80, 100, 255],
        ext: {transientMarker: true},
    }

    const result = appendMapPreviewMarkers(scene, [marker])

    assert.notEqual(result, scene)
    assert.deepEqual(result.keyLocations, [...scene.keyLocations, marker])
    assert.equal(scene.keyLocations.length, 1)
})

test('没有临时标记时复用原场景引用', () => {
    assert.equal(appendMapPreviewMarkers(scene), scene)
    assert.equal(appendMapPreviewMarkers(scene, []), scene)
    assert.equal(appendMapPreviewMarkers(null, []), null)
})
