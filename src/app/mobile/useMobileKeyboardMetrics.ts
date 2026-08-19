/*
 * 原生键盘指标的 React 适配层。
 *
 * 状态本体收口在 api/mobileUi，页面只消费稳定快照，不直接依赖 iOS/Android 桥实现。
 */

import {useSyncExternalStore} from 'react'
import {
    DEFAULT_MOBILE_KEYBOARD_METRICS,
    getMobileKeyboardMetricsSnapshot,
    subscribeMobileKeyboardMetrics,
    type MobileKeyboardMetrics,
} from '../../api'

/**
 * 返回 Web 层仍需消费的停靠键盘遮挡高度。
 *
 * 该判断必须由页面根和 Portal 浮层共同复用，否则同一份原生指标会被两个布局容器
 * 重复消费，或错误地留在背景页面上。
 */
export function getMobileReservedKeyboardInset(metrics: MobileKeyboardMetrics): number {
    return metrics.source === 'native' && metrics.docked && !metrics.viewportAdjusted
        ? metrics.occludedBottom
        : 0
}

export function useMobileKeyboardMetrics(): MobileKeyboardMetrics {
    return useSyncExternalStore(
        subscribeMobileKeyboardMetrics,
        getMobileKeyboardMetricsSnapshot,
        () => DEFAULT_MOBILE_KEYBOARD_METRICS,
    )
}
