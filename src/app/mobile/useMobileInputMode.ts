/*
 * 移动端输入/编辑模式协调器。
 *
 * 统一监听文本焦点、原生键盘指标与页面声明的整页编辑态；壳层据此安排返回键和
 * 预测式返回手势。visualViewport 只在原生桥尚不可用时兜底，且绝不回写页面布局。
 */

import {type RefObject, useCallback, useEffect, useState} from 'react'
import {getMobileKeyboardMetricsSnapshot, subscribeMobileKeyboardMetrics} from '../../api'
import {
    getMobileFocusReferenceHeight,
    getMobileViewportState,
    isMobileTextEditingElement,
    isMobileInputModeActive,
} from './mobileInputMode'

function isActiveEditingRegion(element: Element): boolean {
    if (element.closest('[hidden]')) return false

    const transitionLayer = element.closest('.mobile-page-transition-host__layer')
    if (transitionLayer && !transitionLayer.classList.contains('is-top')) return false

    const tabView = element.closest('.mobile-app__tab-view')
    return !tabView || tabView.classList.contains('is-active')
}

function hasActiveEditingRegion(root: HTMLElement): boolean {
    return Array.from(root.querySelectorAll('[data-mobile-editing="true"]'))
        .some(isActiveEditingRegion)
}

export interface MobileInputModeController {
    active: boolean
    dismissFocusedInput: () => boolean
}

export function useMobileInputMode(rootRef: RefObject<HTMLDivElement | null>): MobileInputModeController {
    const [active, setActive] = useState(false)

    const dismissFocusedInput = useCallback(() => {
        const focused = document.activeElement
        if (!isMobileTextEditingElement(focused)) return false
        focused.blur()
        return true
    }, [])

    useEffect(() => {
        let frame = 0
        let restoreTimer = 0
        let viewportPollTimer = 0
        let focusedInput: HTMLElement | null = null
        let focusViewportHeight = 0
        let keyboardSeenForFocus = false
        let stableViewportHeight = Math.max(
            window.innerHeight,
            window.visualViewport?.height ?? 0,
        )
        let stableViewportWidth = window.innerWidth

        const getVisibleViewportHeight = () => Math.max(
            0,
            window.visualViewport?.height ?? window.innerHeight,
        )
        const usesVisualViewportFallback = () => (
            getMobileKeyboardMetricsSnapshot().source !== 'native'
        )
        const beginFocusSession = (element: Element | null) => {
            if (!isMobileTextEditingElement(element) || element === focusedInput) return

            // 键盘已打开时在多个输入框之间切换仍属于同一会话，保留聚焦前的完整高度。
            // Android 可能先 resize 再派发 focus，因此还要合并最近一次无键盘的稳定高度。
            if (!focusedInput || !keyboardSeenForFocus) {
                focusViewportHeight = getMobileFocusReferenceHeight(
                    stableViewportHeight,
                    window.innerHeight,
                    window.visualViewport,
                )
                keyboardSeenForFocus = false
            }
            focusedInput = element
            setActive(true)
        }
        const update = () => {
            frame = 0
            const root = rootRef.current
            if (!root) return

            const activeElement = document.activeElement
            const textInputFocused = isMobileTextEditingElement(activeElement)
            if (textInputFocused) beginFocusSession(activeElement)

            const nativeKeyboard = getMobileKeyboardMetricsSnapshot()
            const keyboardVisible = nativeKeyboard.source === 'native'
                ? nativeKeyboard.visible
                : getMobileViewportState(
                    window.innerHeight,
                    window.visualViewport,
                    focusViewportHeight || stableViewportHeight || window.innerHeight,
                ).keyboardVisible
            if (textInputFocused && keyboardVisible) keyboardSeenForFocus = true

            const nextActive = isMobileInputModeActive({
                textInputFocused,
                keyboardVisible,
                keyboardSeenForFocus,
                editingRegionActive: hasActiveEditingRegion(root),
            })
            if (nextActive) {
                if (restoreTimer) {
                    window.clearTimeout(restoreTimer)
                    restoreTimer = 0
                }
                setActive(true)
            } else if (!restoreTimer) {
                // 软键盘收起会连续改变 visualViewport；最后一次变化稳定后再退出输入态，
                // 避免 Android resize-content 或 iOS 动画尾帧误启用预测式返回。
                restoreTimer = window.setTimeout(() => {
                    restoreTimer = 0
                    setActive(false)
                }, 180)
            }

            if (!textInputFocused && !keyboardVisible) {
                focusedInput = null
                focusViewportHeight = 0
                keyboardSeenForFocus = false

                const currentViewportHeight = Math.max(window.innerHeight, getVisibleViewportHeight())
                const currentViewportWidth = window.innerWidth
                // 软键盘通常不改变宽度；宽度显著变化视为旋转/分屏，允许完整高度向下更新。
                stableViewportHeight = Math.abs(currentViewportWidth - stableViewportWidth) >= 48
                    ? currentViewportHeight
                    : Math.max(stableViewportHeight, currentViewportHeight)
                stableViewportWidth = currentViewportWidth
            }
        }
        const scheduleUpdate = () => {
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(update)
        }
        const handleFocusIn = (event: FocusEvent) => {
            beginFocusSession(event.target as Element | null)
            // 仅浏览器预览或旧壳层缺少原生桥时，才低频补采 visualViewport。
            if (usesVisualViewportFallback() && !viewportPollTimer) {
                viewportPollTimer = window.setInterval(scheduleUpdate, 250)
            }
            scheduleUpdate()
        }
        const handleFocusOut = () => {
            scheduleUpdate()
            window.setTimeout(() => {
                if (isMobileTextEditingElement(document.activeElement)) return
                if (viewportPollTimer) window.clearInterval(viewportPollTimer)
                viewportPollTimer = 0
            }, 0)
        }

        const observer = new MutationObserver(scheduleUpdate)
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'data-mobile-editing'],
        })

        document.addEventListener('focusin', handleFocusIn, true)
        document.addEventListener('focusout', handleFocusOut, true)
        const handleViewportChange = () => {
            if (usesVisualViewportFallback()) scheduleUpdate()
        }
        window.addEventListener('resize', handleViewportChange)
        window.visualViewport?.addEventListener('resize', handleViewportChange)
        window.visualViewport?.addEventListener('scroll', handleViewportChange)
        const unsubscribeKeyboardMetrics = subscribeMobileKeyboardMetrics(() => {
            if (!usesVisualViewportFallback() && viewportPollTimer) {
                window.clearInterval(viewportPollTimer)
                viewportPollTimer = 0
            }
            scheduleUpdate()
        })
        update()

        return () => {
            if (frame) cancelAnimationFrame(frame)
            if (restoreTimer) window.clearTimeout(restoreTimer)
            if (viewportPollTimer) window.clearInterval(viewportPollTimer)
            observer.disconnect()
            unsubscribeKeyboardMetrics()
            document.removeEventListener('focusin', handleFocusIn, true)
            document.removeEventListener('focusout', handleFocusOut, true)
            window.removeEventListener('resize', handleViewportChange)
            window.visualViewport?.removeEventListener('resize', handleViewportChange)
            window.visualViewport?.removeEventListener('scroll', handleViewportChange)
        }
    }, [rootRef])

    return {active, dismissFocusedInput}
}
