import assert from 'node:assert/strict'
import test from 'node:test'
import {
    normalizeMobileKeyboardMetrics,
} from '../../api/mobileUi.ts'

test('原生键盘指标统一使用 CSS 像素并过滤非法值', () => {
    assert.deepEqual(normalizeMobileKeyboardMetrics({
        visible: true,
        docked: true,
        viewportAdjusted: false,
        occludedBottom: 312.5,
        frame: {x: -1, y: 500, width: 390, height: Number.NaN},
        animationDurationMs: 250,
        animationCurve: 'ease-out',
    }), {
        source: 'native',
        visible: true,
        docked: true,
        viewportAdjusted: false,
        occludedBottom: 312.5,
        frame: {x: 0, y: 500, width: 390, height: 0},
        animationDurationMs: 250,
        animationCurve: 'ease-out',
    })
})

test('浮动或隐藏键盘不制造底部遮挡区域', () => {
    assert.equal(normalizeMobileKeyboardMetrics({
        visible: true,
        docked: false,
        occludedBottom: 260,
    }).occludedBottom, 0)

    assert.deepEqual(normalizeMobileKeyboardMetrics({
        visible: false,
        docked: true,
        occludedBottom: 260,
        frame: {x: 0, y: 500, width: 390, height: 260},
    }), {
        source: 'native',
        visible: false,
        docked: false,
        viewportAdjusted: false,
        occludedBottom: 0,
        frame: null,
        animationDurationMs: 0,
        animationCurve: 'ease-in-out',
    })
})

test('原生已调整视口时 Web 不重复预留键盘高度', () => {
    assert.equal(normalizeMobileKeyboardMetrics({
        visible: true,
        docked: true,
        viewportAdjusted: true,
        occludedBottom: 312.5,
    }).occludedBottom, 0)
})
