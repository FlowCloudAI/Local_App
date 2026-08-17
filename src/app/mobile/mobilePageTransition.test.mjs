import assert from 'node:assert/strict'
import test from 'node:test'

import {getMobilePageTransitionLayers} from './mobilePageTransition.ts'

test('双层转场在空栈中只保留根页', () => {
    assert.deepEqual(getMobilePageTransitionLayers([], 'home-root'), [
        {key: 'home-root', page: null},
    ])
})

test('双层转场只保留当前页和直接前驱，并保持稳定 key', () => {
    const entries = [
        {key: 'page-1', page: {type: 'projectList'}},
        {key: 'page-2', page: {type: 'projectHome', params: {projectId: 'world-1'}}},
        {key: 'page-3', page: {type: 'entryList', params: {projectId: 'world-1'}}},
    ]
    assert.deepEqual(getMobilePageTransitionLayers(entries, 'home-root'), [
        entries[1],
        entries[2],
    ])
})
