import assert from 'node:assert/strict'
import test from 'node:test'

import {removeEntryImages} from './entryImageCollection.ts'

test('批量删除图片后保留或补齐主图', () => {
    const images = [
        {path: 'cover.webp', is_cover: true},
        {path: 'middle.webp'},
        {path: 'last.webp'},
    ]

    assert.deepEqual(removeEntryImages(images, [1]), [images[0], images[2]])
    assert.deepEqual(removeEntryImages(images, [0, 2]), [{path: 'middle.webp', is_cover: true}])
    assert.deepEqual(removeEntryImages(images, [0, 1, 2]), [])
})
