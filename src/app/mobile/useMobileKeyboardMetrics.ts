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

export function useMobileKeyboardMetrics(): MobileKeyboardMetrics {
    return useSyncExternalStore(
        subscribeMobileKeyboardMetrics,
        getMobileKeyboardMetricsSnapshot,
        () => DEFAULT_MOBILE_KEYBOARD_METRICS,
    )
}
