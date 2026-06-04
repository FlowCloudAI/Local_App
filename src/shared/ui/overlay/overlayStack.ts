/**
 * 浮层返回栈：让安卓物理返回键 / Esc 在触发页面返回之前，先关闭最上层浮层。
 *
 * 模块级单例，按打开顺序维护。Overlay 打开时注册、关闭时移除；
 * 页面的返回处理（如 MobileApp.handleBack）应先调用 closeTopOverlay()，
 * 关掉了就提前返回，避免"返回"既关浮层又退页面。
 */
interface OverlayEntry {
    id: number
    close: () => void
}

const stack: OverlayEntry[] = []
let seq = 0

export function pushOverlay(close: () => void): number {
    const id = ++seq
    stack.push({id, close})
    return id
}

export function removeOverlay(id: number): void {
    const index = stack.findIndex(entry => entry.id === id)
    if (index !== -1) stack.splice(index, 1)
}

/** 关闭最上层浮层；若确实关闭了返回 true。供返回键在导航前调用。 */
export function closeTopOverlay(): boolean {
    const top = stack[stack.length - 1]
    if (!top) return false
    top.close()
    return true
}

/** 当前是否有打开的浮层。 */
export function hasOpenOverlay(): boolean {
    return stack.length > 0
}
