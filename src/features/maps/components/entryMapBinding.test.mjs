import assert from 'node:assert/strict'
import test from 'node:test'

import {findEntryMapBinding} from './entryMapBinding.ts'

const mapBase = {
    sceneJson: null,
    coastlineParamsJson: null,
    style: 'flat',
    renderer: 'deck',
    backgroundImageUrl: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
}

test('跳过损坏地图并从草稿反查词条地点', () => {
    const binding = findEntryMapBinding([
        {...mapBase, id: 'broken', name: '损坏地图', draftJson: '{'},
        {
            ...mapBase,
            id: 'world',
            name: '世界地图',
            canvas: {width: 1600, height: 1000},
            sceneJson: JSON.stringify({
                canvas: {width: 1600, height: 1000},
                shapes: [{id: 'land', name: '大陆', polygon: [], fillColor: [1, 2, 3, 255], lineColor: [1, 2, 3, 255]}],
                keyLocations: [{id: 'old-location'}],
            }),
            draftJson: JSON.stringify({
                shapes: [],
                terrainStrokes: [],
                keyLocations: [{
                    id: 'red-canyon',
                    name: '赤岩峡谷',
                    type: '峡谷',
                    x: 819.8,
                    y: 487.3,
                    ext: {linkedEntryId: 'entry-1'},
                }],
            }),
        },
    ], 'entry-1')

    assert.equal(binding?.mapId, 'world')
    assert.equal(binding?.locationName, '赤岩峡谷')
    assert.deepEqual(binding?.marker.position, [819.8, 487.3])
    assert.equal(binding?.scene.shapes[0]?.id, 'land')
    assert.deepEqual(binding?.scene.keyLocations, [])
    assert.equal(findEntryMapBinding([], 'entry-1'), null)
})
