import assert from 'node:assert/strict'
import test from 'node:test'

import {
    calculateTimelineFitZoom,
    calculateTimelineRowCapacity,
    placeTimelineRows,
} from './timelineGeometry.ts'

test('100% 铺满轨道时可缩小到末端事件完整进入视口', () => {
    const zoom = calculateTimelineFitZoom(
        [{startTime: 0}, {startTime: 100}],
        0,
        100,
        1000,
        900,
    )

    assert.ok(zoom < 1)
    assert.ok(Math.abs(zoom - 740 / 900) < 0.000001)
})

test('全部事件在 100% 已完整显示时不继续缩小', () => {
    const zoom = calculateTimelineFitZoom(
        [{startTime: 0}, {startTime: 70}],
        0,
        100,
        1000,
        900,
    )

    assert.equal(zoom, 1)
})

test('时间线行容量随实际视口高度变化', () => {
    assert.equal(calculateTimelineRowCapacity(160, 160, 76), 1)
    assert.equal(calculateTimelineRowCapacity(312, 160, 76), 3)
})

test('事件排布不超过容量并复用重叠最少的行', () => {
    const placements = placeTimelineRows([
        {layoutStartX: 0, layoutCardWidth: 160},
        {layoutStartX: 10, layoutCardWidth: 160},
        {layoutStartX: 20, layoutCardWidth: 160},
        {layoutStartX: 400, layoutCardWidth: 160},
    ], 2)

    assert.deepEqual(placements, [
        {rowIndex: 0},
        {rowIndex: 1},
        {rowIndex: 0},
        {rowIndex: 0},
    ])
})

test('移动端提供完整行容量时保留所有重叠事件行', () => {
    const placements = placeTimelineRows([
        {layoutStartX: 0, layoutCardWidth: 160},
        {layoutStartX: 10, layoutCardWidth: 160},
        {layoutStartX: 20, layoutCardWidth: 160},
    ], 3)

    assert.deepEqual(placements, [
        {rowIndex: 0},
        {rowIndex: 1},
        {rowIndex: 2},
    ])
})
