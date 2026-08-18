/*
 * 移动端输入模式的纯判断逻辑。
 *
 * React 壳层和真机 viewport 监听都依赖这里，纯函数单独保留是为了用 Node 测试覆盖
 * iOS/Android 键盘高度差异，避免把平台判断散落到页面组件。
 */

const NON_TEXT_INPUT_TYPES = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
])

export interface MobileVisualViewportMetrics {
    height: number
    offsetTop: number
}

export interface MobileViewportState {
    keyboardInset: number
    keyboardVisible: boolean
}

export interface MobileInputModeSignals {
    textInputFocused: boolean
    keyboardVisible: boolean
    keyboardSeenForFocus: boolean
    editingRegionActive: boolean
}

/**
 * 计算一次输入会话使用的完整视口基准。
 *
 * Android `adjustResize` 可能先缩短 WebView、再派发 `focusin`。因此不能只在
 * focus 事件里读取当前高度，必须保留最近一次无键盘时的完整高度。
 */
export function getMobileFocusReferenceHeight(
    stableViewportHeight: number,
    layoutViewportHeight: number,
    visualViewport?: MobileVisualViewportMetrics | null,
): number {
    return Math.max(
        0,
        stableViewportHeight,
        layoutViewportHeight,
        visualViewport?.height ?? 0,
    )
}

/**
 * 判断当前焦点是否会进入文本编辑。
 * checkbox/range 等虽然也是 input，但不会调起软键盘，不应因此隐藏底部导航。
 */
export function isMobileTextEditingElement(element: Element | null): element is HTMLElement {
    if (!(element instanceof HTMLElement)) return false
    if (element.isContentEditable) return true

    const tagName = element.tagName.toLowerCase()
    if (tagName === 'textarea') return !element.hasAttribute('readonly') && !element.hasAttribute('disabled')
    if (tagName !== 'input') return false

    const input = element as HTMLInputElement
    return !input.readOnly && !input.disabled && !NON_TEXT_INPUT_TYPES.has(input.type.toLowerCase())
}

/**
 * visualViewport 比聚焦前的完整视口明显变小时视为软键盘可见。
 * 80px 阈值排除地址栏/系统栏的微小伸缩；Android resize-content 由调用方传入聚焦前
 * 高度，因此 innerHeight 与 visualViewport 同步缩短时也能得到有效差值。
 */
export function getMobileViewportState(
    layoutViewportHeight: number,
    visualViewport?: MobileVisualViewportMetrics | null,
    referenceViewportHeight = layoutViewportHeight,
): MobileViewportState {
    // Android resize-content 会同时缩短 innerHeight 与 visualViewport.height；使用聚焦前保存的
    // referenceViewportHeight 才能在这类 WebView 中识别键盘，而不依赖 input 的焦点状态。
    const safeLayoutHeight = Math.max(0, layoutViewportHeight, referenceViewportHeight)
    const viewportHeight = Math.max(0, visualViewport?.height ?? safeLayoutHeight)
    const viewportOffsetTop = Math.max(0, visualViewport?.offsetTop ?? 0)
    const keyboardInset = Math.max(0, safeLayoutHeight - viewportHeight - viewportOffsetTop)

    return {
        keyboardInset,
        keyboardVisible: keyboardInset >= 80,
    }
}

/**
 * 决定底部导航是否应隐藏。
 *
 * 聚焦后、键盘动画开始前需要立刻隐藏；但软键盘曾出现后又被系统按钮收起时，输入框通常
 * 仍保持焦点，此时必须以键盘状态为准恢复导航。整页编辑态不受该例外影响。
 */
export function shouldSuppressMobileNavigation({
    textInputFocused,
    keyboardVisible,
    keyboardSeenForFocus,
    editingRegionActive,
}: MobileInputModeSignals): boolean {
    if (editingRegionActive || keyboardVisible) return true
    return textInputFocused && !keyboardSeenForFocus
}
