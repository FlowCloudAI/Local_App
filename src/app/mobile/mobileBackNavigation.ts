type MobileBackTab = 'home' | 'ai' | 'ideas' | 'settings'

export type MobileBackTarget = 'page' | 'home' | 'exit'

/**
 * 离开当前页的意图，决定页面能不能拦下这次跳转。
 * - `back`：返回键 / 边缘返回手势。页面可以拦下它去关闭自己的子层（沉浸编辑、筛选菜单），
 *   把这一次返回“吃掉”而留在原地。
 * - `leave`：切 Tab 等跨页跳转。页面一定会被卸载，只应该用来确认未保存内容；
 *   吃掉这次跳转去关子层是错的——用户点的是别的 Tab，不是返回。
 */
export type MobileNavigationIntent = 'back' | 'leave'

/** 返回 false 表示阻止本次离开，页面保持不动。 */
export type MobileBeforeLeave = (intent: MobileNavigationIntent) => boolean | Promise<boolean>

export function resolveMobileBackTarget(activeTab: MobileBackTab, canGoBack: boolean): MobileBackTarget {
    if (canGoBack) return 'page'
    return activeTab === 'home' ? 'exit' : 'home'
}
